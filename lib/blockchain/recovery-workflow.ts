/**
 * Recovery Workflow
 *
 * Handles the safe recovery path after ambiguous Stellar transaction outcomes.
 * When a network response is lost mid-flight (status: 'unknown'), this utility
 * queries the Horizon API to determine whether the transaction was accepted,
 * then recommends the correct next action.
 *
 * Design principles:
 * - Never blindly resubmit after an ambiguous failure.
 * - Prioritize correctness over automatic retries.
 * - Use the account sequence number as a secondary signal when the transaction
 *   hash is not found (a consumed sequence means something went through).
 * - Keep recovery state serialisable so it can survive process restarts.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { logBlockchainOperation, generateCorrelationId } from "./logger";
import { getAccountSequence } from "./sequence-manager";
import type { RecoveryAction } from "@/types/transaction-states";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum number of Horizon polls before giving up. */
export const MAX_RECOVERY_CHECKS = 10;

/** Default delay between recovery checks (ms). */
export const RECOVERY_CHECK_INTERVAL_MS = 5_000;

/**
 * If a transaction was submitted more than this many milliseconds ago and is
 * still not found on Horizon, the sequence has very likely expired and it is
 * safe to resubmit.
 */
export const SEQUENCE_CONFIRMATION_WINDOW_MS = 60_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransactionStatusQuery {
  /** The transaction hash we submitted (or think we submitted). */
  transactionHash: string;
  /** The Stellar public key (G…) of the source account. */
  sourceAccountId: string;
  /** The sequence number used in the transaction. */
  submittedSequence: bigint;
  /** Horizon base URL to query. */
  horizonUrl: string;
  /** ISO timestamp of when the submission was attempted. */
  submittedAt: string;
}

export interface RecoveryContext {
  query: TransactionStatusQuery;
  correlationId: string;
  checkCount: number;
  lastCheckedAt: string | null;
}

export type TransactionCheckResult =
  | {
      found: true;
      successful: boolean;
      ledger: number;
      transactionHash: string;
    }
  | {
      found: false;
      reason: "not_found" | "horizon_error";
      error?: string;
    };

// ── Transaction status check ──────────────────────────────────────────────────

/**
 * Queries Horizon for the given transaction hash.
 *
 * Returns `found: true` with outcome details when the transaction exists, or
 * `found: false` with a reason when it cannot be located (not yet included,
 * expired, or Horizon itself is unavailable).
 */
export async function checkTransactionStatus(
  query: TransactionStatusQuery,
  correlationId?: string,
): Promise<TransactionCheckResult> {
  const corrId = correlationId ?? generateCorrelationId();

  logBlockchainOperation(
    "info",
    "Checking transaction status during recovery",
    { transactionHash: query.transactionHash, sourceAccountId: query.sourceAccountId },
    corrId,
  );

  try {
    const server = new StellarSdk.Horizon.Server(query.horizonUrl);
    const tx = await (server as any)
      .transactions()
      .transaction(query.transactionHash)
      .call();

    const result: TransactionCheckResult = {
      found: true,
      successful: tx.successful,
      ledger: tx.ledger,
      transactionHash: tx.hash,
    };

    logBlockchainOperation(
      tx.successful ? "info" : "warn",
      `Transaction found on Horizon (successful=${tx.successful})`,
      { transactionHash: tx.hash, ledger: tx.ledger },
      corrId,
    );

    return result;
  } catch (err: unknown) {
    const e = err as any;
    const status: number | undefined = e?.response?.status;

    if (status === 404) {
      logBlockchainOperation(
        "info",
        "Transaction not found on Horizon (404)",
        { transactionHash: query.transactionHash },
        corrId,
      );
      return { found: false, reason: "not_found" };
    }

    const message = e?.message ?? "Unknown Horizon error";
    logBlockchainOperation(
      "warn",
      "Horizon error during recovery check",
      {
        transactionHash: query.transactionHash,
        httpStatus: status,
        error: { type: e?.name ?? "HorizonError", message },
      },
      corrId,
    );
    return { found: false, reason: "horizon_error", error: message };
  }
}

// ── Recovery decision ─────────────────────────────────────────────────────────

/**
 * Determines the recommended recovery action for an ambiguous transaction.
 *
 * Logic:
 * 1. Query Horizon for the transaction hash.
 * 2. If found and successful → `confirm_success`.
 * 3. If found but failed → `give_up` (the network definitively rejected it).
 * 4. If not found:
 *    a. If submission was recent → check the account sequence.
 *       - Sequence consumed → `give_up` (another tx used this sequence slot).
 *       - Sequence not consumed → `retry` (transaction never went through).
 *    b. If submission is stale (outside window) → `retry` (sequence expired).
 * 5. If Horizon itself is unreachable → `give_up` with explanation.
 */
export async function determineRecoveryAction(
  query: TransactionStatusQuery,
  correlationId?: string,
): Promise<RecoveryAction> {
  const corrId = correlationId ?? generateCorrelationId();

  const checkResult = await checkTransactionStatus(query, corrId);

  // ── Transaction found ──────────────────────────────────────────────────────
  if (checkResult.found) {
    if (checkResult.successful) {
      return {
        action: "confirm_success",
        transactionHash: checkResult.transactionHash,
        ledger: checkResult.ledger,
      };
    }
    return {
      action: "give_up",
      reason:
        "Transaction was included in a ledger but failed. Resubmitting would waste fees.",
    };
  }

  // ── Horizon error ──────────────────────────────────────────────────────────
  if (checkResult.reason === "horizon_error") {
    return {
      action: "give_up",
      reason: `Could not query the network to determine the transaction status: ${checkResult.error ?? "unknown Horizon error"}`,
    };
  }

  // ── Transaction not found ──────────────────────────────────────────────────
  const withinWindow = isRecoverable(query.submittedAt, SEQUENCE_CONFIRMATION_WINDOW_MS);

  if (withinWindow) {
    // Check whether the account sequence has advanced past the used sequence.
    const seqResult = await getAccountSequence(
      query.sourceAccountId,
      query.horizonUrl,
      { forceRefresh: true },
      corrId,
    );

    if (!seqResult.success) {
      return {
        action: "give_up",
        reason: `Could not verify account sequence during recovery: ${seqResult.error.message}`,
      };
    }

    const currentSequence = seqResult.info.sequence;

    if (currentSequence > query.submittedSequence) {
      // The sequence slot was consumed — something else used it, or the tx
      // went through but the hash doesn't match (shouldn't happen, but be safe).
      return {
        action: "give_up",
        reason:
          "Account sequence has advanced past the submitted sequence. The sequence slot was consumed but the transaction was not found — it may have been replaced or used by another transaction.",
      };
    }

    // Sequence still available — transaction was never processed.
    return {
      action: "retry",
      reason: "Transaction was not found on Horizon and the account sequence is still available. It is safe to resubmit.",
    };
  }

  // Outside the confirmation window — the sequence has definitely expired.
  return {
    action: "retry",
    reason:
      "Transaction was not found on Horizon and the submission window has expired. The sequence is safe to reuse.",
  };
}

// ── Recovery workflow runner ──────────────────────────────────────────────────

/**
 * Runs the recovery workflow for an ambiguous transaction.
 *
 * Polls Horizon up to `maxChecks` times with `checkIntervalMs` between attempts.
 * Stops early when a definitive action is reached (`confirm_success` or
 * `give_up`). Returns immediately after the first `retry` recommendation to
 * prevent cascading requests.
 */
export async function runRecoveryWorkflow(
  query: TransactionStatusQuery,
  options?: {
    maxChecks?: number;
    checkIntervalMs?: number;
  },
  correlationId?: string,
): Promise<{ action: RecoveryAction; checksPerformed: number }> {
  const corrId = correlationId ?? generateCorrelationId();
  const maxChecks = options?.maxChecks ?? MAX_RECOVERY_CHECKS;
  const checkIntervalMs = options?.checkIntervalMs ?? RECOVERY_CHECK_INTERVAL_MS;

  logBlockchainOperation(
    "info",
    "Recovery workflow started",
    {
      transactionHash: query.transactionHash,
      sourceAccountId: query.sourceAccountId,
      maxChecks,
    },
    corrId,
  );

  let checksPerformed = 0;
  let lastAction: RecoveryAction = {
    action: "give_up",
    reason: "Recovery workflow exhausted all checks without a definitive result",
  };

  for (let i = 0; i < maxChecks; i++) {
    if (i > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, checkIntervalMs));
    }

    checksPerformed++;
    const action = await determineRecoveryAction(query, corrId);
    lastAction = action;

    logBlockchainOperation(
      "info",
      `Recovery check ${checksPerformed}/${maxChecks}: action=${action.action}`,
      {
        transactionHash: query.transactionHash,
        action: action.action,
        reason: action.action !== "confirm_success" ? action.reason : undefined,
      },
      corrId,
    );

    // Stop on any definitive result
    if (action.action === "confirm_success" || action.action === "give_up" || action.action === "retry") {
      break;
    }
  }

  logBlockchainOperation(
    lastAction.action === "confirm_success" ? "info" : "warn",
    "Recovery workflow completed",
    {
      transactionHash: query.transactionHash,
      action: lastAction.action,
      checksPerformed,
    },
    corrId,
  );

  return { action: lastAction, checksPerformed };
}

// ── Context helpers ───────────────────────────────────────────────────────────

/**
 * Creates a serialisable `RecoveryContext` for tracking recovery state across
 * service restarts or async boundaries.
 */
export function createRecoveryContext(
  query: TransactionStatusQuery,
  correlationId?: string,
): RecoveryContext {
  return {
    query,
    correlationId: correlationId ?? generateCorrelationId(),
    checkCount: 0,
    lastCheckedAt: null,
  };
}

/**
 * Returns `true` when a transaction submitted at `submittedAt` was submitted
 * recently enough to still be in the network's candidate set.
 *
 * Pure function (no I/O) — safe to call without network access.
 */
export function isRecoverable(
  submittedAt: string,
  windowMs: number = SEQUENCE_CONFIRMATION_WINDOW_MS,
): boolean {
  const ageMs = Date.now() - Date.parse(submittedAt);
  return ageMs <= windowMs;
}
