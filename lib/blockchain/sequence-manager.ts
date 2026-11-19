/**
 * Sequence Management Utility
 *
 * Manages Stellar account sequence numbers for safe transaction construction.
 * Provides fetch, caching, stale-sequence detection, and conflict recovery.
 *
 * Key design decisions:
 * - Cache TTL is intentionally short (10s) to prevent stale sequences while
 *   still reducing redundant Horizon calls within a single request.
 * - Cache is never used as the sole source of truth when force-refresh is requested.
 * - All errors are returned as values (not thrown) so callers can pattern-match.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { logBlockchainOperation, generateCorrelationId } from "./logger";
import { SequenceError, SequenceErrorCode } from "@/types/transaction-states";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum age of a cached sequence before it must be re-fetched. */
export const SEQUENCE_CACHE_TTL_MS = 10_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SequenceInfo {
  /** The Stellar public key (G…) of the account. */
  accountId: string;
  /** Current on-chain sequence number as a bigint. */
  sequence: bigint;
  /** ISO timestamp when this value was fetched from Horizon. */
  fetchedAt: string;
  /** Ledger number at which this sequence was observed, if available. */
  ledger?: number;
}

export type AccountSequenceResult =
  | { success: true; info: SequenceInfo }
  | { success: false; error: SequenceError };

// ── In-process cache ──────────────────────────────────────────────────────────

const sequenceCache = new Map<string, SequenceInfo>();

/** Clears the in-process cache. Intended for use in tests. */
export function clearSequenceCache(): void {
  sequenceCache.clear();
}

/** Returns a snapshot of the cache (copy). Intended for use in tests. */
export function getSequenceCacheSnapshot(): ReadonlyMap<string, SequenceInfo> {
  return new Map(sequenceCache);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isCacheStale(info: SequenceInfo): boolean {
  return Date.now() - Date.parse(info.fetchedAt) >= SEQUENCE_CACHE_TTL_MS;
}

// ── Core fetch ────────────────────────────────────────────────────────────────

/**
 * Fetches the latest account sequence number directly from Horizon.
 * Always bypasses cache. Updates the cache on success.
 */
export async function fetchAccountSequence(
  accountId: string,
  horizonUrl: string,
  correlationId?: string,
): Promise<AccountSequenceResult> {
  const corrId = correlationId ?? generateCorrelationId();

  try {
    const server = new StellarSdk.Horizon.Server(horizonUrl);
    const account = await server.loadAccount(accountId);

    const info: SequenceInfo = {
      accountId,
      sequence: BigInt(account.sequence),
      fetchedAt: new Date().toISOString(),
    };

    sequenceCache.set(accountId, info);

    logBlockchainOperation(
      "info",
      "Account sequence fetched",
      { accountId, sequence: info.sequence.toString() },
      corrId,
    );

    return { success: true, info };
  } catch (err: unknown) {
    const error = err as any;

    // Horizon 404 — account does not exist on this network
    if (error?.response?.status === 404) {
      const seqErr = new SequenceError(
        SequenceErrorCode.ACCOUNT_NOT_FOUND,
        accountId,
        `Account ${accountId} not found on Horizon at ${horizonUrl}`,
      );
      logBlockchainOperation(
        "error",
        "Account not found when fetching sequence",
        {
          accountId,
          horizonUrl,
          error: { type: seqErr.name, message: seqErr.message },
        },
        corrId,
      );
      return { success: false, error: seqErr };
    }

    // Any other error (network, timeout, etc.)
    const seqErr = new SequenceError(
      SequenceErrorCode.SEQUENCE_FETCH_FAILED,
      accountId,
      `Failed to fetch sequence for ${accountId}: ${(err as Error)?.message ?? "unknown error"}`,
    );
    logBlockchainOperation(
      "error",
      "Failed to fetch account sequence",
      {
        accountId,
        horizonUrl,
        error: { type: seqErr.name, message: seqErr.message },
      },
      corrId,
    );
    return { success: false, error: seqErr };
  }
}

/**
 * Returns the account sequence number, using the cache when fresh enough.
 * Pass `options.forceRefresh = true` to bypass the cache unconditionally.
 */
export async function getAccountSequence(
  accountId: string,
  horizonUrl: string,
  options?: { forceRefresh?: boolean },
  correlationId?: string,
): Promise<AccountSequenceResult> {
  if (!options?.forceRefresh) {
    const cached = sequenceCache.get(accountId);
    if (cached && !isCacheStale(cached)) {
      logBlockchainOperation(
        "info",
        "Account sequence served from cache",
        { accountId, sequence: cached.sequence.toString(), fetchedAt: cached.fetchedAt },
        correlationId,
      );
      return { success: true, info: cached };
    }
  }

  return fetchAccountSequence(accountId, horizonUrl, correlationId);
}

// ── Error detection ───────────────────────────────────────────────────────────

/**
 * Inspects a submission error and returns a `SequenceError` when the error is
 * sequence-related, or `null` when it is not.
 *
 * Checks both the Horizon `result_codes` envelope and free-text error messages.
 */
export function detectSequenceError(
  error: unknown,
  accountId: string,
  usedSequence?: bigint,
): SequenceError | null {
  if (!error) return null;

  const e = error as any;
  const message = (e?.message ?? "").toLowerCase();
  const name = (e?.name ?? "").toLowerCase();

  // Inspect Horizon result_codes
  const resultCodes = e?.response?.data?.extras?.result_codes;
  const txCode: string = (resultCodes?.transaction ?? "").toLowerCase();
  const opCodes: string[] = (resultCodes?.operations ?? []).map((c: string) =>
    c.toLowerCase(),
  );

  const isBadSeq =
    txCode === "tx_bad_seq" ||
    opCodes.some((c) => c === "tx_bad_seq") ||
    message.includes("tx_bad_seq") ||
    message.includes("bad_seq");

  if (isBadSeq) {
    return new SequenceError(
      SequenceErrorCode.STALE_SEQUENCE,
      accountId,
      `Stale sequence number detected for account ${accountId}: the sequence used (${usedSequence ?? "unknown"}) is behind the current account sequence`,
      { usedSequence },
    );
  }

  // Broader sequence-related strings that may indicate a conflict
  const isSequenceRelated =
    message.includes("sequence") || name.includes("sequence");

  if (isSequenceRelated) {
    return new SequenceError(
      SequenceErrorCode.SEQUENCE_CONFLICT,
      accountId,
      `Sequence conflict detected for account ${accountId}: ${(error as Error)?.message ?? "unknown"}`,
      { usedSequence },
    );
  }

  return null;
}

/**
 * Force-refreshes the account sequence after a sequence conflict.
 * Always bypasses the cache and logs the conflict.
 */
export async function refreshSequenceAfterConflict(
  accountId: string,
  horizonUrl: string,
  correlationId?: string,
): Promise<AccountSequenceResult> {
  const corrId = correlationId ?? generateCorrelationId();

  logBlockchainOperation(
    "warn",
    "Sequence conflict — forcing cache refresh",
    { accountId },
    corrId,
  );

  // Evict stale entry before fetching
  sequenceCache.delete(accountId);

  return fetchAccountSequence(accountId, horizonUrl, corrId);
}

/**
 * Type guard: returns `true` when `error` is a `SequenceError`.
 */
export function isSequenceError(error: unknown): error is SequenceError {
  return error instanceof SequenceError;
}
