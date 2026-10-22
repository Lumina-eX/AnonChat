/**
 * Transaction Recovery Workflow
 *
 * Handles the "ambiguous outcome" problem: when a transaction submission
 * returns an unknown result (timeout, 5xx, connection error), the
 * transaction may or may not have been accepted by the network. This module
 * provides a structured recovery workflow that:
 *
 *  1. **Queries the network** for the transaction by hash to determine
 *     whether it was included in a ledger.
 *  2. **Validates acceptance** — confirms the transaction is on-chain and
 *     successful before reporting success to the caller.
 *  3. **Prevents duplicate execution** — if the transaction is found on-chain
 *     and successful, returns a "duplicate" result so callers do NOT resubmit.
 *  4. **Allows controlled retries** — only when the transaction is confirmed
 *     NOT on-chain (definitively absent) AND the operation is idempotent (or
 *     the caller explicitly accepts the risk for non-idempotent operations).
 *
 * All network access is dependency-injected for full testability.
 */

import { logBlockchainOperation, generateCorrelationId } from "./logger";
import {
  createLifecycleContext,
  applyLifecycleAction,
  isRetrySafe,
  isAmbiguousState,
  type TransactionLifecycleContext,
} from "./transaction-lifecycle";
import {
  isSequenceConflictError,
  SequenceError,
  type AccountLike,
} from "./sequence-manager";
import { classifySubmissionError, type TransactionBuilderFn, type TransactionLike } from "./transaction-submission";

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * The result of looking up a transaction on the network.
 */
export type TransactionLookupResult =
  | { found: true; hash: string; ledger: number; successful: boolean; memo: string | null; createdAt: string }
  | { found: false; hash: string };

/**
 * Dependencies injected into the recovery workflow.
 */
export interface RecoveryDeps {
  /** Looks up a transaction by hash on the network. */
  getTransaction: (hash: string) => Promise<TransactionLookupResult>;
  /** Loads an account (for sequence refresh before retry). */
  loadAccount: (publicKey: string) => Promise<AccountLike>;
  /** Submits a transaction to the network. */
  submitTransaction: (transaction: TransactionLike) => Promise<unknown>;
  /** Optional sleep for polling backoff. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RecoveryConfig {
  /** Max poll attempts when querying for an unknown transaction. */
  maxPollAttempts?: number;
  /** Base delay (ms) between poll attempts. */
  pollBaseDelayMs?: number;
  /** Max delay (ms) between poll attempts. */
  pollMaxDelayMs?: number;
  /** Whether operations are idempotent (safe to retry). */
  idempotent?: boolean;
  /** Max retries in the lifecycle model. */
  maxRetries?: number;
}

const DEFAULT_RECOVERY_CONFIG: Required<RecoveryConfig> = {
  maxPollAttempts: 5,
  pollBaseDelayMs: 2000,
  pollMaxDelayMs: 15000,
  idempotent: false,
  maxRetries: 3,
};

/**
 * The outcome of a recovery attempt.
 */
export type RecoveryResult =
  | {
      outcome: "confirmed";
      transactionHash: string;
      ledger: number;
      isDuplicate: boolean;
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
      lifecycle: TransactionLifecycleContext;
    }
  | {
      outcome: "retry_eligible";
      transactionHash: string | null;
      lifecycle: TransactionLifecycleContext;
    }
  | {
      outcome: "retry_blocked";
      transactionHash: string | null;
      reason: string;
      lifecycle: TransactionLifecycleContext;
    };

// ── Recovery Workflow ───────────────────────────────────────────────────────

/**
 * The recovery workflow for transactions with ambiguous outcomes.
 *
 * Given a transaction hash from a previous submission that returned an
 * unknown result, this workflow:
 *
 *  1. Polls the network to determine if the transaction was included.
 *  2. If found and successful → returns `confirmed` (duplicate detection).
 *  3. If found and failed → returns `failed`.
 *  4. If not found after max attempts → evaluates retry eligibility:
 *     - Idempotent operations → `retry_eligible` (safe to rebuild & resubmit).
 *     - Non-idempotent operations → `retry_blocked` (manual intervention).
 */
export class TransactionRecoveryWorkflow {
  private deps: RecoveryDeps;
  private config: Required<RecoveryConfig>;

  constructor(deps: RecoveryDeps, config?: RecoveryConfig) {
    this.deps = deps;
    this.config = { ...DEFAULT_RECOVERY_CONFIG, ...config };
  }

  /**
   * Recovers a transaction with an unknown outcome by querying the network.
   *
   * @param transactionHash - The hash of the submitted-but-unconfirmed transaction
   * @param lifecycle       - The lifecycle context from the original submission
   * @param correlationId   - Optional correlation ID for tracing
   */
  async recoverUnknownTransaction(
    transactionHash: string,
    lifecycle: TransactionLifecycleContext,
    correlationId?: string,
  ): Promise<RecoveryResult> {
    const cid = correlationId ?? lifecycle.correlationId ?? generateCorrelationId();

    logBlockchainOperation(
      "info",
      "Starting transaction recovery for unknown outcome",
      {
        transactionHash,
        lifecycleId: lifecycle.id,
        currentState: lifecycle.state,
      },
      cid,
    );

    // Poll the network for the transaction
    const lookup = await this.pollForTransaction(transactionHash, cid);

    if (lookup.found) {
      if (lookup.successful) {
        // Transaction was accepted and is successful — do NOT resubmit
        logBlockchainOperation(
          "info",
          "Recovered transaction confirmed on network (duplicate detected)",
          {
            transactionHash,
            ledger: lookup.ledger,
            isDuplicate: true,
          },
          cid,
        );

        const { context: confirmedCtx } = applyLifecycleAction(lifecycle, {
          type: "MARK_CONFIRMED",
          ledger: lookup.ledger,
        });

        return {
          outcome: "confirmed",
          transactionHash,
          ledger: lookup.ledger,
          isDuplicate: true,
          lifecycle: confirmedCtx,
        };
      }

      // Transaction was included but failed — definitive failure
      logBlockchainOperation(
        "warn",
        "Recovered transaction found on network but failed",
        {
          transactionHash,
          ledger: lookup.ledger,
        },
        cid,
      );

      const { context: failedCtx } = applyLifecycleAction(lifecycle, {
        type: "MARK_FAILED",
        errorMessage: "Transaction found on network but operations failed",
        errorCode: "TX_ON_CHAIN_FAILED",
      });

      return {
        outcome: "failed",
        transactionHash,
        errorMessage: "Transaction found on network but operations failed",
        errorCode: "TX_ON_CHAIN_FAILED",
        lifecycle: failedCtx,
      };
    }

    // Transaction not found after max poll attempts — outcome still unknown
    logBlockchainOperation(
      "warn",
      "Transaction not found on network after polling — evaluating retry eligibility",
      {
        transactionHash,
        maxPollAttempts: this.config.maxPollAttempts,
      },
      cid,
    );

    // Evaluate whether a retry is safe
    const { context: evaluatedCtx } = applyLifecycleAction(lifecycle, {
      type: "EVALUATE_RETRY",
    });

    if (isRetrySafe(evaluatedCtx)) {
      return {
        outcome: "retry_eligible",
        transactionHash: null,
        lifecycle: evaluatedCtx,
      };
    }

    return {
      outcome: "retry_blocked",
      transactionHash,
      reason: "Transaction outcome could not be verified and retry is not safe (non-idempotent or max retries exceeded)",
      lifecycle: evaluatedCtx,
    };
  }

  /**
   * Attempts a safe retry: rebuilds and resubmits a transaction only when
   * the recovery workflow has confirmed it is safe to do so.
   *
   * @param publicKey     - Source account public key
   * @param buildFn       - Transaction builder (receives fresh account)
   * @param signFn        - Signing function
   * @param lifecycle     - The lifecycle context (must be in retry_eligible)
   * @param correlationId - Optional correlation ID
   */
  async safeRetry(
    publicKey: string,
    buildFn: TransactionBuilderFn,
    signFn: (transaction: TransactionLike) => void | Promise<void>,
    lifecycle: TransactionLifecycleContext,
    correlationId?: string,
  ): Promise<RecoveryResult> {
    const cid = correlationId ?? lifecycle.correlationId ?? generateCorrelationId();

    // Guard: only retry from retry_eligible state
    if (!isRetrySafe(lifecycle)) {
      logBlockchainOperation(
        "warn",
        "Safe retry blocked — lifecycle is not retry-eligible",
        {
          lifecycleId: lifecycle.id,
          currentState: lifecycle.state,
        },
        cid,
      );
      return {
        outcome: "retry_blocked",
        transactionHash: lifecycle.transactionHash,
        reason: "Lifecycle state is not retry-eligible",
        lifecycle,
      };
    }

    // Begin retry
    const { context: retryCtx } = applyLifecycleAction(lifecycle, {
      type: "BEGIN_RETRY",
    });

    logBlockchainOperation(
      "info",
      "Starting safe retry",
      {
        lifecycleId: lifecycle.id,
        retryCount: retryCtx.retryCount,
      },
      cid,
    );

    // Load fresh account for sequence
    let account: AccountLike;
    try {
      account = await this.deps.loadAccount(publicKey);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Failed to load account for retry";
      const { context: failedCtx } = applyLifecycleAction(retryCtx, {
        type: "MARK_FAILED",
        errorMessage: errMsg,
        errorCode: "ACCOUNT_LOAD_FAILED",
      });
      return {
        outcome: "failed",
        transactionHash: null,
        errorMessage: errMsg,
        errorCode: "ACCOUNT_LOAD_FAILED",
        lifecycle: failedCtx,
      };
    }

    // Build and sign
    let transaction: TransactionLike;
    try {
      transaction = await buildFn(account);
      await signFn(transaction);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Failed to build/sign transaction for retry";
      const { context: failedCtx } = applyLifecycleAction(retryCtx, {
        type: "MARK_FAILED",
        errorMessage: errMsg,
        errorCode: "BUILD_SIGN_FAILED",
      });
      return {
        outcome: "failed",
        transactionHash: null,
        errorMessage: errMsg,
        errorCode: "BUILD_SIGN_FAILED",
        lifecycle: failedCtx,
      };
    }

    // Submit
    const txHash = transaction.hash();
    const { context: submittedCtx } = applyLifecycleAction(retryCtx, {
      type: "MARK_SUBMITTED",
      transactionHash: txHash,
    });

    try {
      const response = await this.deps.submitTransaction(transaction) as {
        hash: string;
        ledger: number;
        fee_charged?: string;
        successful?: boolean;
        extras?: { result_codes?: { transaction?: string } };
      };

      if (response.successful === false) {
        const { context: failedCtx } = applyLifecycleAction(submittedCtx, {
          type: "MARK_FAILED",
          errorMessage: "Retry transaction operations failed",
          errorCode: "TX_OPERATIONS_FAILED",
        });
        return {
          outcome: "failed",
          transactionHash: response.hash,
          errorMessage: "Retry transaction operations failed",
          errorCode: "TX_OPERATIONS_FAILED",
          lifecycle: failedCtx,
        };
      }

      const { context: confirmedCtx } = applyLifecycleAction(submittedCtx, {
        type: "MARK_CONFIRMED",
        ledger: response.ledger,
      });

      return {
        outcome: "confirmed",
        transactionHash: response.hash,
        ledger: response.ledger,
        isDuplicate: false,
        lifecycle: confirmedCtx,
      };
    } catch (error: unknown) {
      // Handle sequence conflict specially
      if (isSequenceConflictError(error)) {
        const { context: failedCtx } = applyLifecycleAction(submittedCtx, {
          type: "MARK_FAILED",
          errorMessage: "Sequence conflict during retry",
          errorCode: "tx_bad_seq",
        });
        return {
          outcome: "failed",
          transactionHash: txHash,
          errorMessage: "Sequence conflict during retry",
          errorCode: "tx_bad_seq",
          lifecycle: failedCtx,
        };
      }

      const classification = classifySubmissionError(error);

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

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Polls the network for a transaction with exponential backoff.
   * Returns the lookup result after finding the transaction or exhausting
   * the configured max poll attempts.
   */
  private async pollForTransaction(
    hash: string,
    correlationId: string,
  ): Promise<TransactionLookupResult> {
    const sleep = this.deps.sleep ?? defaultSleep;
    let lastResult: TransactionLookupResult = { found: false, hash };

    for (let attempt = 1; attempt <= this.config.maxPollAttempts; attempt++) {
      logBlockchainOperation(
        "info",
        `Polling for transaction (attempt ${attempt}/${this.config.maxPollAttempts})`,
        { transactionHash: hash, attempt },
        correlationId,
      );

      try {
        const result = await this.deps.getTransaction(hash);
        if (result.found) {
          return result;
        }
        lastResult = result;
      } catch (error) {
        logBlockchainOperation(
          "warn",
          `Transaction lookup failed (attempt ${attempt}/${this.config.maxPollAttempts})`,
          {
            transactionHash: hash,
            error: {
              type: error instanceof Error ? error.name : "UnknownError",
              message: error instanceof Error ? error.message : "Unknown error",
            },
          },
          correlationId,
        );
      }

      if (attempt < this.config.maxPollAttempts) {
        const delay = this.pollDelay(attempt);
        await sleep(delay);
      }
    }

    return lastResult;
  }

  private pollDelay(attempt: number): number {
    const exp = this.config.pollBaseDelayMs * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 500;
    return Math.min(exp + jitter, this.config.pollMaxDelayMs);
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Convenience factory that creates a `TransactionRecoveryWorkflow` wired to
 * the real Stellar SDK and existing `getTransaction` helper.
 */
export function createRecoveryWorkflow(
  config: {
    horizonUrl: string;
    transactionTimeout: number;
  },
  extraConfig?: RecoveryConfig,
): TransactionRecoveryWorkflow {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const StellarSdk = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");

  return new TransactionRecoveryWorkflow(
    {
      getTransaction: async (hash: string): Promise<TransactionLookupResult> => {
        const server = new StellarSdk.Horizon.Server(config.horizonUrl);
        try {
          const tx = await server.transactions().transaction(hash).call();
          return {
            found: true,
            hash: tx.hash,
            ledger: (tx as { ledger_attr?: number }).ledger_attr ?? 0,
            successful: Boolean(tx.successful),
            memo: tx.memo ?? null,
            createdAt: tx.created_at,
          };
        } catch (error) {
          const status = (error as { response?: { status?: number } })?.response?.status;
          if (status === 404) {
            return { found: false, hash };
          }
          throw error;
        }
      },
      loadAccount: async (publicKey: string): Promise<AccountLike> => {
        const server = new StellarSdk.Horizon.Server(config.horizonUrl);
        const account = await server.loadAccount(publicKey);
        return {
          accountId: () => account.accountId(),
          sequenceNumber: () => account.sequenceNumber(),
        };
      },
      submitTransaction: async (transaction: TransactionLike): Promise<unknown> => {
        const server = new StellarSdk.Horizon.Server(config.horizonUrl);
        return server.submitTransaction(
          transaction as unknown as InstanceType<typeof StellarSdk.Transaction>,
        );
      },
    },
    extraConfig,
  );
}

// ── Internal ────────────────────────────────────────────────────────────────

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
