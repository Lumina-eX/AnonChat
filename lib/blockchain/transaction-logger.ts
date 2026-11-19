/**
 * Transaction Logger
 *
 * Records structured transaction lifecycle events for auditing and
 * troubleshooting. Wraps the low-level `logBlockchainOperation` from
 * `./logger` and adds transaction-specific event types with an in-memory
 * ring buffer for short-lived correlation across a single request lifecycle.
 *
 * The in-memory buffer is intentionally ephemeral — it is not a replacement
 * for a persistent audit log. For durable records, use the Supabase-backed
 * `upsertTransactionReceipt` from `./transaction-receipts`.
 */

import { randomUUID } from "crypto";
import { logBlockchainOperation } from "./logger";
import type { SubmissionOutcome } from "@/types/transaction-states";

// ── Event types ───────────────────────────────────────────────────────────────

export type TransactionEventType =
  | "sequence_fetched"
  | "sequence_refreshed"
  | "sequence_error"
  | "transaction_prepared"
  | "transaction_signed"
  | "transaction_submitted"
  | "transaction_confirmed"
  | "transaction_failed"
  | "transaction_unknown_outcome"
  | "recovery_started"
  | "recovery_check_performed"
  | "recovery_action_determined"
  | "retry_scheduled"
  | "retry_blocked"
  | "duplicate_submission_detected";

export interface TransactionLifecycleEvent {
  /** Unique ID for this specific event. */
  eventId: string;
  /** Links all events that belong to the same transaction flow. */
  correlationId: string;
  eventType: TransactionEventType;
  /** ISO timestamp when the event was recorded. */
  timestamp: string;
  transactionHash?: string | null;
  sourceAccountId?: string | null;
  /** The sequence number at the time of this event, serialised as a string. */
  sequenceNumber?: string | null;
  ledger?: number | null;
  /** The extended or standard transaction state at the time of this event. */
  state?: string | null;
  errorMessage?: string | null;
  retryCount?: number | null;
  /** Milliseconds elapsed since the start of the flow, if tracked. */
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
}

// ── In-memory ring buffer ─────────────────────────────────────────────────────

const MAX_BUFFER_SIZE = 1_000;
const eventBuffer: TransactionLifecycleEvent[] = [];

/** Returns all events in the buffer, optionally filtered by correlationId. */
export function getRecentEvents(
  correlationId?: string,
): TransactionLifecycleEvent[] {
  if (correlationId === undefined) {
    return [...eventBuffer];
  }
  return eventBuffer.filter((e) => e.correlationId === correlationId);
}

/** Clears the in-memory buffer. Intended for use in tests. */
export function clearEventBuffer(): void {
  eventBuffer.length = 0;
}

// ── Core recorder ─────────────────────────────────────────────────────────────

/**
 * Stamps an event with a UUID and ISO timestamp, appends it to the ring buffer
 * (dropping the oldest when full), and forwards it to the low-level logger.
 */
export function recordTransactionEvent(
  event: Omit<TransactionLifecycleEvent, "eventId" | "timestamp">,
): TransactionLifecycleEvent {
  const completed: TransactionLifecycleEvent = {
    ...event,
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
  };

  if (eventBuffer.length >= MAX_BUFFER_SIZE) {
    eventBuffer.shift(); // drop oldest
  }
  eventBuffer.push(completed);

  // Choose log level based on event type
  const isError =
    completed.eventType === "transaction_failed" ||
    completed.eventType === "sequence_error" ||
    completed.eventType === "retry_blocked";

  const isWarn =
    completed.eventType === "transaction_unknown_outcome" ||
    completed.eventType === "sequence_refreshed";

  const level: "info" | "warn" | "error" = isError
    ? "error"
    : isWarn
      ? "warn"
      : "info";

  logBlockchainOperation(
    level,
    `Transaction lifecycle event: ${completed.eventType}`,
    {
      eventId: completed.eventId,
      correlationId: completed.correlationId,
      eventType: completed.eventType,
      transactionHash: completed.transactionHash ?? undefined,
      sourceAccountId: completed.sourceAccountId ?? undefined,
      sequenceNumber: completed.sequenceNumber ?? undefined,
      ledger: completed.ledger ?? undefined,
      state: completed.state ?? undefined,
      error: completed.errorMessage
        ? { type: completed.eventType, message: completed.errorMessage }
        : undefined,
      retryCount: completed.retryCount ?? undefined,
      durationMs: completed.durationMs ?? undefined,
      ...completed.metadata,
    },
    completed.correlationId,
  );

  return completed;
}

// ── Convenience loggers ───────────────────────────────────────────────────────

export function logSequenceFetched(
  accountId: string,
  sequence: bigint,
  correlationId: string,
): TransactionLifecycleEvent {
  return recordTransactionEvent({
    correlationId,
    eventType: "sequence_fetched",
    sourceAccountId: accountId,
    sequenceNumber: sequence.toString(),
  });
}

export function logSequenceRefreshed(
  accountId: string,
  sequence: bigint,
  correlationId: string,
): TransactionLifecycleEvent {
  return recordTransactionEvent({
    correlationId,
    eventType: "sequence_refreshed",
    sourceAccountId: accountId,
    sequenceNumber: sequence.toString(),
  });
}

export function logSequenceError(
  accountId: string,
  errorCode: string,
  errorMessage: string,
  correlationId: string,
): TransactionLifecycleEvent {
  return recordTransactionEvent({
    correlationId,
    eventType: "sequence_error",
    sourceAccountId: accountId,
    errorMessage: `[${errorCode}] ${errorMessage}`,
    metadata: { errorCode },
  });
}

export function logTransactionPrepared(
  transactionHash: string,
  sourceAccountId: string,
  sequence: bigint,
  correlationId: string,
): TransactionLifecycleEvent {
  return recordTransactionEvent({
    correlationId,
    eventType: "transaction_prepared",
    transactionHash,
    sourceAccountId,
    sequenceNumber: sequence.toString(),
    state: "preparing",
  });
}

export function logTransactionSigned(
  transactionHash: string,
  sourceAccountId: string,
  correlationId: string,
): TransactionLifecycleEvent {
  return recordTransactionEvent({
    correlationId,
    eventType: "transaction_signed",
    transactionHash,
    sourceAccountId,
    state: "awaiting_wallet",
  });
}

export function logTransactionSubmitted(
  transactionHash: string,
  correlationId: string,
): TransactionLifecycleEvent {
  return recordTransactionEvent({
    correlationId,
    eventType: "transaction_submitted",
    transactionHash,
    state: "submitted",
  });
}

/**
 * Records the outcome of a submission attempt. Routes to the appropriate
 * event type based on `outcome.status`.
 */
export function logSubmissionOutcome(
  outcome: SubmissionOutcome,
  correlationId: string,
  retryCount?: number,
): TransactionLifecycleEvent {
  switch (outcome.status) {
    case "confirmed":
      return recordTransactionEvent({
        correlationId,
        eventType: "transaction_confirmed",
        transactionHash: outcome.transactionHash,
        ledger: outcome.ledger,
        state: "confirmed",
        retryCount: retryCount ?? null,
        metadata: { feeCharged: outcome.feeCharged },
      });

    case "failed":
      return recordTransactionEvent({
        correlationId,
        eventType: "transaction_failed",
        transactionHash: outcome.transactionHash ?? null,
        errorMessage: outcome.error,
        state: outcome.retryable ? "retry_eligible" : "failed",
        retryCount: retryCount ?? null,
        metadata: {
          retryable: outcome.retryable,
          sequenceErrorCode: outcome.sequenceError?.code ?? null,
        },
      });

    case "unknown":
      return recordTransactionEvent({
        correlationId,
        eventType: "transaction_unknown_outcome",
        transactionHash: outcome.transactionHash ?? null,
        errorMessage: outcome.error,
        state: "unknown_outcome",
        retryCount: retryCount ?? null,
      });
  }
}

export function logRecoveryStarted(
  transactionHash: string | undefined,
  correlationId: string,
): TransactionLifecycleEvent {
  return recordTransactionEvent({
    correlationId,
    eventType: "recovery_started",
    transactionHash: transactionHash ?? null,
    state: "unknown_outcome",
  });
}

export function logRecoveryCheckPerformed(
  transactionHash: string | undefined,
  checkNumber: number,
  correlationId: string,
): TransactionLifecycleEvent {
  return recordTransactionEvent({
    correlationId,
    eventType: "recovery_check_performed",
    transactionHash: transactionHash ?? null,
    metadata: { checkNumber },
  });
}

export function logRecoveryActionDetermined(
  action: string,
  reason: string,
  correlationId: string,
): TransactionLifecycleEvent {
  return recordTransactionEvent({
    correlationId,
    eventType: "recovery_action_determined",
    metadata: { action, reason },
  });
}

export function logRetryScheduled(
  transactionHash: string | undefined,
  retryCount: number,
  correlationId: string,
): TransactionLifecycleEvent {
  return recordTransactionEvent({
    correlationId,
    eventType: "retry_scheduled",
    transactionHash: transactionHash ?? null,
    retryCount,
    state: "retry_eligible",
  });
}

export function logRetryBlocked(
  transactionHash: string | undefined,
  reason: string,
  retryCount: number,
  correlationId: string,
): TransactionLifecycleEvent {
  return recordTransactionEvent({
    correlationId,
    eventType: "retry_blocked",
    transactionHash: transactionHash ?? null,
    errorMessage: reason,
    retryCount,
    state: "retry_blocked",
  });
}

export function logDuplicateSubmissionDetected(
  transactionHash: string | undefined,
  idempotencyKey: string,
  correlationId: string,
): TransactionLifecycleEvent {
  return recordTransactionEvent({
    correlationId,
    eventType: "duplicate_submission_detected",
    transactionHash: transactionHash ?? null,
    metadata: { idempotencyKey },
  });
}
