/**
 * Transaction Submission Service
 *
 * Centralizes the preparation, submission, and outcome tracking of Stellar
 * transactions into a single reusable service. Key design decisions:
 *
 *  1. **Distinguish failure from ambiguity.** A network timeout or 5xx error
 *     does NOT mean the transaction was rejected — it may have been accepted
 *     by the network. The service classifies these as "unknown" outcomes and
 *     refuses to auto-retry non-idempotent operations.
 *
 *  2. **Sequence safety.** Uses `SequenceManager` to fetch the latest
 *     account sequence before transaction construction and to refresh on
 *     conflicts, preventing `tx_bad_seq` failures caused by stale sequence
 *     numbers.
 *
 *  3. **Lifecycle tracking.** Every submission is tracked through the
 *     `TransactionLifecycle` state model, so callers (and the recovery
 *     workflow) can inspect the current status after a restart.
 *
 *  4. **Dependency injection.** All network access (account loading, tx
 *     submission, transaction lookup) is injected so the service is fully
 *     testable without a live Horizon server.
 */

import type { StellarConfig } from "./stellar-config";
import { logBlockchainOperation, generateCorrelationId } from "./logger";
import {
  SequenceManager,
  isSequenceConflictError,
  SequenceError,
  type AccountLike,
  type SequenceManagerDeps,
  type SequenceManagerConfig,
} from "./sequence-manager";
import {
  createLifecycleContext,
  applyLifecycleAction,
  isRetrySafe,
  type TransactionLifecycleContext,
  type TransactionLifecycleAction,
} from "./transaction-lifecycle";

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Minimal transaction interface (mirrors StellarSdk.Transaction but
 * interface-based for mocking).
 */
export interface TransactionLike {
  /** Returns the hex-encoded transaction hash. */
  hash: () => string;
  /** Signs the transaction with the given keypair. */
  sign: (...keypairs: unknown[]) => void;
}

/**
 * Builder options for transaction construction. Callers provide a function
 * that receives the account (with a valid sequence) and returns the built
 * transaction.
 */
export type TransactionBuilderFn = (account: AccountLike) => TransactionLike | Promise<TransactionLike>;

/**
 * Result of a transaction submission, classified by outcome.
 */
export type SubmissionResult =
  | {
      outcome: "confirmed";
      transactionHash: string;
      ledger: number;
      feeCharged: string;
      lifecycle: TransactionLifecycleContext;
    }
  | {
      outcome: "failed";
      transactionHash: string | null;
      errorMessage: string;
      errorCode: string;
      lifecycle: TransactionLifecycleContext;
    }
  | {
      outcome: "unknown";
      transactionHash: string | null;
      errorMessage: string;
      errorCode: string;
      lifecycle: TransactionLifecycleContext;
    };

/**
 * Dependencies injected into the submission service. All network access goes
 * through these functions.
 */
export interface SubmissionServiceDeps extends SequenceManagerDeps {
  /** Submits a signed transaction to the network. */
  submitTransaction: (transaction: TransactionLike) => Promise<HorizonSubmitResponse>;
}

/**
 * The response shape returned by `server.submitTransaction()`.
 */
export interface HorizonSubmitResponse {
  hash: string;
  ledger: number;
  fee_charged?: string;
  successful?: boolean;
  /** Horizon result codes when the transaction is rejected. */
  extras?: {
    result_codes?: {
      transaction?: string;
      operations?: string[];
    };
  };
}

export interface SubmissionServiceConfig extends SequenceManagerConfig {
  /** Whether submitted operations are idempotent (safe to retry). */
  idempotent?: boolean;
  /** Max retries for the lifecycle model. */
  maxRetries?: number;
}

// ── Error Classification ────────────────────────────────────────────────────

/**
 * Classifies a submission error as either a definitive failure or an
 * ambiguous (unknown) outcome.
 *
 * - **Failed**: The network explicitly rejected the transaction (e.g.
 *   `tx_bad_seq`, `op_underfunded`, 400 status with result codes).
 * - **Unknown**: A network timeout, 5xx, or connection error where the
 *   transaction may or may not have been accepted.
 */
export function classifySubmissionError(error: unknown): {
  outcome: "failed" | "unknown";
  errorMessage: string;
  errorCode: string;
} {
  const err = error as {
    message?: string;
    name?: string;
    response?: { status?: number };
    extras?: { result_codes?: { transaction?: string; operations?: string[] } };
  };

  const message = err.message ?? "Unknown error";
  const name = err.name ?? "";
  const status = err.response?.status;
  const txResultCode = err.extras?.result_codes?.transaction ?? "";
  const opResultCodes = err.extras?.result_codes?.operations ?? [];

  // Build a composite error code
  const errorCode = txResultCode || opResultCodes.join(",") || name || String(status ?? "UNKNOWN");

  // Horizon returns 4xx for rejected transactions — these are definitive failures
  if (status !== undefined && status >= 400 && status < 500) {
    return { outcome: "failed", errorMessage: message, errorCode };
  }

  // If we have result codes, it's a definitive failure (the network processed
  // and rejected the transaction)
  if (txResultCode || opResultCodes.length > 0) {
    return { outcome: "failed", errorMessage: message, errorCode };
  }

  // Timeout, connection errors, 5xx — outcome is unknown
  const lowerMsg = message.toLowerCase();
  if (
    lowerMsg.includes("timeout") ||
    lowerMsg.includes("timed out") ||
    lowerMsg.includes("econnreset") ||
    lowerMsg.includes("econnrefused") ||
    lowerMsg.includes("enotfound") ||
    lowerMsg.includes("socket hang up") ||
    lowerMsg.includes("network") ||
    (status !== undefined && status >= 500)
  ) {
    return { outcome: "unknown", errorMessage: message, errorCode };
  }

  // Default: treat as unknown to be safe (never assume failure for ambiguous errors)
  return { outcome: "unknown", errorMessage: message, errorCode };
}

// ── Submission Service ─────────────────────────────────────────────────────

/**
 * Centralized transaction submission service.
 *
 * Orchestrates sequence management, transaction building, submission, and
 * lifecycle tracking. Designed to be reused across wallet, escrow, payment,
 * and dispute workflows.
 */
export class TransactionSubmissionService {
  private deps: SubmissionServiceDeps;
  private config: Required<SubmissionServiceConfig>;
  private sequenceManager: SequenceManager;

  constructor(deps: SubmissionServiceDeps, config?: SubmissionServiceConfig) {
    this.deps = deps;
    this.config = {
      maxRefreshAttempts: 3,
      baseRetryDelayMs: 500,
      maxRetryDelayMs: 5000,
      idempotent: false,
      maxRetries: 3,
      ...config,
    };
    this.sequenceManager = new SequenceManager(deps, {
      maxRefreshAttempts: this.config.maxRefreshAttempts,
      baseRetryDelayMs: this.config.baseRetryDelayMs,
      maxRetryDelayMs: this.config.maxRetryDelayMs,
    });
  }

  /**
   * Prepares a transaction by loading the latest account state, computing
   * the correct sequence number, and invoking the builder function.
   *
   * @returns The prepared (unsigned) transaction and the account that was
   *   used.
   */
  async prepareTransaction(
    publicKey: string,
    buildFn: TransactionBuilderFn,
    correlationId?: string,
  ): Promise<{ transaction: TransactionLike; account: AccountLike; sequence: string }> {
    logBlockchainOperation(
      "info",
      "Preparing transaction",
      { accountPublicKey: publicKey },
      correlationId,
    );

    // Fetch the latest account to get a valid sequence
    const account = await this.loadAccountFresh(publicKey, correlationId);
    const sequence = account.sequenceNumber();

    logBlockchainOperation(
      "info",
      "Account loaded for transaction preparation",
      {
        accountPublicKey: publicKey,
        sequence,
      },
      correlationId,
    );

    // Build the transaction using the fresh account
    const transaction = await buildFn(account);

    return { transaction, account, sequence };
  }

  /**
   * Submits a signed transaction to the network and classifies the outcome.
   *
   * Does NOT auto-retry — callers should use `submitTransactionSafely` for
   * the full lifecycle-managed flow, or the recovery workflow for retries.
   */
  async submitTransaction(
    transaction: TransactionLike,
    lifecycle: TransactionLifecycleContext,
    correlationId?: string,
  ): Promise<SubmissionResult> {
    const txHash = transaction.hash();
    logBlockchainOperation(
      "info",
      "Submitting transaction to network",
      { transactionHash: txHash },
      correlationId,
    );

    // Mark as submitted in the lifecycle
    const { context: submittedCtx } = applyLifecycleAction(lifecycle, {
      type: "MARK_SUBMITTED",
      transactionHash: txHash,
    });

    try {
      const response = await this.deps.submitTransaction(transaction);

      logBlockchainOperation(
        "info",
        "Transaction submitted successfully",
        {
          transactionHash: response.hash,
          ledger: response.ledger,
          feeCharged: response.fee_charged,
        },
        correlationId,
      );

      // Verify success — Horizon returns the response even for failed txs
      // (successful: false means the tx was included but operations failed)
      if (response.successful === false) {
        const { context: failedCtx } = applyLifecycleAction(submittedCtx, {
          type: "MARK_FAILED",
          errorMessage: "Transaction included in ledger but operations failed",
          errorCode: "TX_OPERATIONS_FAILED",
        });
        return {
          outcome: "failed",
          transactionHash: response.hash,
          errorMessage: "Transaction included in ledger but operations failed",
          errorCode: "TX_OPERATIONS_FAILED",
          lifecycle: failedCtx,
        };
      }

      const feeCharged = response.fee_charged ?? "0";
      const { context: confirmedCtx } = applyLifecycleAction(submittedCtx, {
        type: "MARK_CONFIRMED",
        ledger: response.ledger,
      });

      return {
        outcome: "confirmed",
        transactionHash: response.hash,
        ledger: response.ledger,
        feeCharged,
        lifecycle: confirmedCtx,
      };
    } catch (error: unknown) {
      // Check for sequence conflict — may be able to refresh and retry
      if (isSequenceConflictError(error)) {
        logBlockchainOperation(
          "warn",
          "Sequence conflict detected during submission",
          {
            transactionHash: txHash,
            error: {
              type: (error as { name?: string })?.name ?? "SequenceConflict",
              message: (error as { message?: string })?.message ?? "tx_bad_seq",
            },
          },
          correlationId,
        );

        const { context: failedCtx } = applyLifecycleAction(submittedCtx, {
          type: "MARK_FAILED",
          errorMessage: "Sequence conflict: transaction sequence is stale",
          errorCode: "tx_bad_seq",
        });
        return {
          outcome: "failed",
          transactionHash: txHash,
          errorMessage: "Sequence conflict: transaction sequence is stale",
          errorCode: "tx_bad_seq",
          lifecycle: failedCtx,
        };
      }

      // Classify the error as failed or unknown
      const classification = classifySubmissionError(error);

      logBlockchainOperation(
        classification.outcome === "unknown" ? "warn" : "error",
        `Transaction submission ${classification.outcome === "unknown" ? "outcome unknown" : "failed"}`,
        {
          transactionHash: txHash,
          outcome: classification.outcome,
          errorCode: classification.errorCode,
          error: { type: classification.errorCode, message: classification.errorMessage },
        },
        correlationId,
      );

      if (classification.outcome === "unknown") {
        const { context: unknownCtx } = applyLifecycleAction(submittedCtx, {
          type: "MARK_UNKNOWN",
          errorMessage: classification.errorMessage,
          errorCode: classification.errorCode,
        });
        return {
          outcome: "unknown",
          transactionHash: txHash,
          errorMessage: classification.errorMessage,
          errorCode: classification.errorCode,
          lifecycle: unknownCtx,
        };
      }

      const { context: failedCtx } = applyLifecycleAction(submittedCtx, {
        type: "MARK_FAILED",
        errorMessage: classification.errorMessage,
        errorCode: classification.errorCode,
      });
      return {
        outcome: "failed",
        transactionHash: txHash,
        errorMessage: classification.errorMessage,
        errorCode: classification.errorCode,
        lifecycle: failedCtx,
      };
    }
  }

  /**
   * Full lifecycle-managed submission: prepare → (optionally sign) → submit.
   *
   * If a sequence conflict occurs during submission, automatically refreshes
   * the sequence and retries up to `maxRefreshAttempts`. The retry only
   * rebuilds and resubmits if the operation is idempotent or if the failure
   * was a definitive rejection (not an ambiguous/unknown outcome).
   *
   * @param publicKey  - The source account public key
   * @param buildFn    - Builder that receives a fresh account and returns a tx
   * @param signFn     - Optional signing function; receives the prepared tx
   * @returns The submission result with full lifecycle context
   */
  async submitTransactionSafely(
    publicKey: string,
    buildFn: TransactionBuilderFn,
    signFn: (transaction: TransactionLike) => void | Promise<void>,
    options?: {
      correlationId?: string;
      operationLabel?: string;
    },
  ): Promise<SubmissionResult> {
    const correlationId = options?.correlationId ?? generateCorrelationId();
    const lifecycle = createLifecycleContext({
      idempotent: this.config.idempotent,
      maxRetries: this.config.maxRetries,
      operationLabel: options?.operationLabel ?? undefined,
      correlationId,
    });

    let currentLifecycle = lifecycle;
    let lastResult: SubmissionResult | null = null;

    for (let attempt = 0; attempt <= this.config.maxRefreshAttempts; attempt++) {
      // Prepare
      const { transaction } = await this.prepareTransaction(
        publicKey,
        buildFn,
        correlationId,
      );

      // Sign
      await signFn(transaction);

      // Submit
      const result = await this.submitTransaction(transaction, currentLifecycle, correlationId);
      currentLifecycle = result.lifecycle;
      lastResult = result;

      // If confirmed or unknown, return immediately
      if (result.outcome === "confirmed" || result.outcome === "unknown") {
        return result;
      }

      // If failed due to sequence conflict, refresh and retry
      if (result.outcome === "failed" && result.errorCode === "tx_bad_seq") {
        if (attempt < this.config.maxRefreshAttempts) {
          logBlockchainOperation(
            "info",
            `Refreshing sequence after conflict (attempt ${attempt + 1}/${this.config.maxRefreshAttempts})`,
            { accountPublicKey: publicKey },
            correlationId,
          );

          try {
            // Invalidate the sequence cache so the next prepareTransaction
            // fetches a fresh account
            this.sequenceManager.invalidateCache();
            continue;
          } catch {
            // If refresh fails, return the failed result
            return result;
          }
        }
      }

      // For other failures, evaluate retry eligibility
      if (result.outcome === "failed") {
        const { context: evaluatedCtx } = applyLifecycleAction(currentLifecycle, {
          type: "EVALUATE_RETRY",
        });
        currentLifecycle = evaluatedCtx;

        if (!isRetrySafe(evaluatedCtx)) {
          return { ...result, lifecycle: evaluatedCtx };
        }

        // Safe to retry — begin retry
        const { context: retryCtx } = applyLifecycleAction(currentLifecycle, {
          type: "BEGIN_RETRY",
        });
        currentLifecycle = retryCtx;
        continue;
      }
    }

    // Exhausted retries
    return (
      lastResult ?? {
        outcome: "failed",
        transactionHash: null,
        errorMessage: "Exhausted all submission attempts",
        errorCode: "MAX_ATTEMPTS_EXCEEDED",
        lifecycle: currentLifecycle,
      }
    );
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async loadAccountFresh(
    publicKey: string,
    _correlationId?: string,
  ): Promise<AccountLike> {
    try {
      return await this.deps.loadAccount(publicKey);
    } catch (error) {
      if (error instanceof SequenceError) {
        throw error;
      }
      throw new SequenceError(
        "UNKNOWN_ERROR",
        `Failed to load account: ${(error as { message?: string })?.message ?? "unknown"}`,
        { accountPublicKey: publicKey },
      );
    }
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Convenience factory that creates a `TransactionSubmissionService` wired to
 * the real Stellar SDK. In tests, construct the service directly with mock
 * deps.
 */
export function createSubmissionService(
  config: StellarConfig,
  extraConfig?: SubmissionServiceConfig,
): TransactionSubmissionService {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const StellarSdk = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");

  return new TransactionSubmissionService(
    {
      loadAccount: async (publicKey: string): Promise<AccountLike> => {
        const server = new StellarSdk.Horizon.Server(config.horizonUrl);
        const account = await server.loadAccount(publicKey);
        return {
          accountId: () => account.accountId(),
          sequenceNumber: () => account.sequenceNumber(),
        };
      },
      submitTransaction: async (transaction: TransactionLike): Promise<HorizonSubmitResponse> => {
        const server = new StellarSdk.Horizon.Server(config.horizonUrl);
        // Cast because TransactionLike is structurally compatible with
        // the SDK's Transaction type but TS doesn't know that.
        return (await server.submitTransaction(
          transaction as unknown as InstanceType<typeof StellarSdk.Transaction>,
        )) as unknown as HorizonSubmitResponse;
      },
    },
    extraConfig,
  );
}
