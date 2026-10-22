/**
 * Sequence Management Utility
 *
 * Provides safe, reusable account sequence-number management for Stellar
 * transactions. Responsibilities:
 *
 *  - Fetch the latest account sequence from the network before transaction
 *    construction.
 *  - Detect stale sequence values (the local copy is behind the network).
 *  - Detect sequence conflicts (another transaction has already advanced the
 *    account's sequence on the network).
 *  - Refresh account state automatically when a sequence conflict occurs.
 *  - Expose standardized error types so callers can branch on sequence-related
 *    failures without parsing error messages.
 *
 * All network access is dependency-injected so the module is fully testable
 * without a live Horizon server.
 */

import type { StellarConfig } from "./stellar-config";
import { logBlockchainOperation, generateCorrelationId } from "./logger";

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Minimal account shape returned by the loadAccount dependency.
 * Mirrors `StellarSdk.Account` but is interface-based for easy mocking.
 */
export interface AccountLike {
  accountId: () => string;
  sequenceNumber: () => string;
}

/**
 * Dependency-injected functions for loading accounts and submitting
 * transactions. Tests supply fakes; production code passes the real
 * Stellar SDK wrappers.
 */
export interface SequenceManagerDeps {
  /** Loads the current account from Horizon, returning the latest sequence. */
  loadAccount: (publicKey: string) => Promise<AccountLike>;
  /** Optional sleep used for retry backoff (defaults to setTimeout). */
  sleep?: (ms: number) => Promise<void>;
}

export interface SequenceManagerConfig {
  /** Max attempts to retry on sequence conflict before giving up. */
  maxRefreshAttempts?: number;
  /** Base delay (ms) for exponential backoff between refresh attempts. */
  baseRetryDelayMs?: number;
  /** Upper cap for backoff delay (ms). */
  maxRetryDelayMs?: number;
}

const DEFAULTS: Required<SequenceManagerConfig> = {
  maxRefreshAttempts: 3,
  baseRetryDelayMs: 500,
  maxRetryDelayMs: 5000,
};

// ── Error Classes ───────────────────────────────────────────────────────────

/** Base class for all sequence-management errors. */
export class SequenceError extends Error {
  /** The account public key the error relates to. */
  readonly accountPublicKey: string;
  /** The local sequence number that was stale / conflicting, if known. */
  readonly localSequence: string | null;
  /** The network sequence number at the time of the error, if known. */
  readonly networkSequence: string | null;
  /** Machine-readable error code for programmatic branching. */
  readonly code: SequenceErrorCode;

  constructor(
    code: SequenceErrorCode,
    message: string,
    details: {
      accountPublicKey: string;
      localSequence?: string | null;
      networkSequence?: string | null;
    },
  ) {
    super(message);
    this.name = "SequenceError";
    this.code = code;
    this.accountPublicKey = details.accountPublicKey;
    this.localSequence = details.localSequence ?? null;
    this.networkSequence = details.networkSequence ?? null;
  }
}

export type SequenceErrorCode =
  | "STALE_SEQUENCE"
  | "SEQUENCE_CONFLICT"
  | "ACCOUNT_NOT_FOUND"
  | "NETWORK_TIMEOUT"
  | "UNKNOWN_ERROR";

// ── Sequence Detection Helpers ──────────────────────────────────────────────

/**
 * Regex patterns for detecting sequence-related errors from Stellar SDK /
 * Horizon responses. Horizon returns `tx_bad_seq` when the submitted
 * transaction's sequence doesn't match the account's current sequence.
 */
const BAD_SEQ_PATTERNS = [
  /tx_bad_seq/i,
  /bad[_\s-]?seq/i,
  /sequence[_\s]?mismatch/i,
  /account[_\s]?sequence/i,
];

/**
 * Classifies an arbitrary error as a sequence conflict.
 *
 * Returns `true` when the error message or Horizon result codes indicate
 * that the transaction's sequence number is out of sync with the network.
 */
export function isSequenceConflictError(error: unknown): boolean {
  if (!error) return false;
  const err = error as { message?: string; name?: string; extras?: { result_codes?: { transaction?: string } } };
  const message = err.message ?? "";
  const name = err.name ?? "";
  const txResultCode = err.extras?.result_codes?.transaction ?? "";

  if (BAD_SEQ_PATTERNS.some((p) => p.test(message) || p.test(txResultCode))) return true;
  if (BAD_SEQ_PATTERNS.some((p) => p.test(name))) return true;
  return false;
}

/**
 * Detects whether a local sequence number is stale relative to the
 * network's current sequence.
 *
 * A sequence is stale when the network sequence is strictly greater than
 * the local value (i.e. another transaction has already advanced it).
 */
export function isStaleSequence(localSequence: string, networkSequence: string): boolean {
  const local = BigInt(localSequence);
  const network = BigInt(networkSequence);
  return network > local;
}

/**
 * Compares a candidate sequence number against the network's current
 * sequence and returns the expected value for a new transaction.
 *
 * Stellar expects `account.sequence + 1` as the sequence for the next
 * transaction.
 */
export function nextSequenceNumber(currentSequence: string): string {
  return (BigInt(currentSequence) + BigInt(1)).toString();
}

// ── Sequence Manager ────────────────────────────────────────────────────────

/**
 * The SequenceManager encapsulates account-sequence retrieval, staleness
 * detection, and conflict-driven refresh. It is the single source of truth
 * for sequence numbers used in transaction construction.
 */
export class SequenceManager {
  private deps: SequenceManagerDeps;
  private config: Required<SequenceManagerConfig>;
  /** Cached account (may become stale). */
  private cachedAccount: AccountLike | null = null;
  /** Monotonic timestamp of the last successful loadAccount call. */
  private lastFetchTime: number = 0;
  /** Maximum age (ms) before a cached account is considered stale. */
  private cacheTtlMs: number;

  constructor(
    deps: SequenceManagerDeps,
    config?: SequenceManagerConfig & { cacheTtlMs?: number },
  ) {
    this.deps = deps;
    this.config = { ...DEFAULTS, ...config };
    this.cacheTtlMs = config?.cacheTtlMs ?? 10_000;
  }

  /**
   * Fetches the latest account from Horizon and returns the sequence number
   * that should be used for the next transaction (i.e. current + 1).
   *
   * Caches the account locally but always returns the fresh sequence from
   * the network — caching is only used for staleness comparison.
   */
  async fetchCurrentSequence(
    publicKey: string,
    correlationId?: string,
  ): Promise<string> {
    const account = await this.loadAccountSafe(publicKey, correlationId);
    this.cachedAccount = account;
    this.lastFetchTime = Date.now();
    return account.sequenceNumber();
  }

  /**
   * Returns the sequence number to use for the next transaction, computed
   * from the latest network state.
   *
   * Always performs a network fetch unless `cachedSequence` is provided AND
   * the cache is still fresh (within `cacheTtlMs`). Even when using the
   * cache, the returned value is `currentSequence + 1`.
   */
  async getSequenceForTransaction(
    publicKey: string,
    correlationId?: string,
  ): Promise<string> {
    const currentSeq = await this.fetchCurrentSequence(publicKey, correlationId);
    return nextSequenceNumber(currentSeq);
  }

  /**
   * Validates that a local sequence is not stale before a transaction is
   * signed and submitted.
   *
   * @throws {SequenceError} with code `STALE_SEQUENCE` when the local
   *   sequence is behind the network.
   */
  async validateSequence(
    publicKey: string,
    localSequence: string,
    correlationId?: string,
  ): Promise<void> {
    const networkSeq = await this.fetchCurrentSequence(publicKey, correlationId);

    if (isStaleSequence(localSequence, networkSeq)) {
      logBlockchainOperation(
        "warn",
        "Stale sequence detected",
        {
          accountPublicKey: publicKey,
          localSequence,
          networkSequence: networkSeq,
        },
        correlationId,
      );
      throw new SequenceError("STALE_SEQUENCE", "Account sequence is stale; refresh required.", {
        accountPublicKey: publicKey,
        localSequence,
        networkSequence: networkSeq,
      });
    }
  }

  /**
   * Handles a sequence conflict by refreshing the account and returning the
   * new sequence number to use for a retry.
   *
   * Retries with exponential backoff up to `maxRefreshAttempts`.
   *
   * @throws {SequenceError} with code `SEQUENCE_CONFLICT` if the account
   *   cannot be refreshed within the configured attempt budget.
   */
  async refreshOnConflict(
    publicKey: string,
    knownStaleSequence: string,
    correlationId?: string,
  ): Promise<string> {
    const sleep = this.deps.sleep ?? defaultSleep;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.config.maxRefreshAttempts; attempt++) {
      try {
        const freshAccount = await this.loadAccountSafe(publicKey, correlationId);
        const freshSeq = freshAccount.sequenceNumber();

        logBlockchainOperation(
          "info",
          `Sequence refreshed on conflict (attempt ${attempt}/${this.config.maxRefreshAttempts})`,
          {
            accountPublicKey: publicKey,
            previousSequence: knownStaleSequence,
            refreshedSequence: freshSeq,
          },
          correlationId,
        );

        this.cachedAccount = freshAccount;
        this.lastFetchTime = Date.now();
        return nextSequenceNumber(freshSeq);
      } catch (err) {
        lastError = err;
        if (attempt < this.config.maxRefreshAttempts) {
          const delay = this.backoffDelay(attempt);
          await sleep(delay);
        }
      }
    }

    throw new SequenceError(
      "SEQUENCE_CONFLICT",
      "Failed to refresh account sequence after repeated conflicts.",
      {
        accountPublicKey: publicKey,
        localSequence: knownStaleSequence,
      },
    );
  }

  /**
   * Invalidates the locally cached account so the next call to
   * `fetchCurrentSequence` always hits the network.
   */
  invalidateCache(): void {
    this.cachedAccount = null;
    this.lastFetchTime = 0;
  }

  /**
   * Returns the locally cached account if still fresh, or `null`.
   * Primarily used for diagnostics and testing.
   */
  getCachedAccount(): AccountLike | null {
    if (this.cachedAccount && Date.now() - this.lastFetchTime < this.cacheTtlMs) {
      return this.cachedAccount;
    }
    return null;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private backoffDelay(attempt: number): number {
    const exp = this.config.baseRetryDelayMs * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 200;
    return Math.min(exp + jitter, this.config.maxRetryDelayMs);
  }

  private async loadAccountSafe(
    publicKey: string,
    correlationId?: string,
  ): Promise<AccountLike> {
    try {
      return await this.deps.loadAccount(publicKey);
    } catch (error: unknown) {
      const err = error as { message?: string; response?: { status?: number } };
      const status = err.response?.status;

      if (status === 404) {
        throw new SequenceError(
          "ACCOUNT_NOT_FOUND",
          `Stellar account not found: ${publicKey}`,
          { accountPublicKey: publicKey },
        );
      }

      const msg = err.message ?? "";
      if (msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("timed out")) {
        throw new SequenceError(
          "NETWORK_TIMEOUT",
          `Timeout loading account ${publicKey}: ${msg}`,
          { accountPublicKey: publicKey },
        );
      }

      logBlockchainOperation(
        "error",
        "Unexpected error loading account",
        {
          accountPublicKey: publicKey,
          error: { type: "LoadAccountError", message: msg },
        },
        correlationId,
      );

      throw new SequenceError(
        "UNKNOWN_ERROR",
        `Failed to load account ${publicKey}: ${msg}`,
        { accountPublicKey: publicKey },
      );
    }
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Convenience factory that creates a `SequenceManager` wired to the real
 * Stellar SDK `Horizon.Server.loadAccount`.
 *
 * In production code, prefer this factory. In tests, construct
 * `SequenceManager` directly with mock deps.
 */
export function createSequenceManager(
  config: StellarConfig,
  extraConfig?: SequenceManagerConfig,
): SequenceManager {
  // Lazy import to keep this module testable without bundling the SDK
  // at import time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const StellarSdk = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");

  return new SequenceManager(
    {
      loadAccount: async (publicKey: string): Promise<AccountLike> => {
        const server = new StellarSdk.Horizon.Server(config.horizonUrl);
        const account = await server.loadAccount(publicKey);
        return {
          accountId: () => account.accountId(),
          sequenceNumber: () => account.sequenceNumber(),
        };
      },
    },
    extraConfig,
  );
}

// ── Internal ────────────────────────────────────────────────────────────────

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-export for convenience
export { generateCorrelationId };
