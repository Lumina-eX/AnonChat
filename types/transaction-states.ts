/**
 * Extended Transaction State Model
 *
 * Extends the existing TransactionConfirmationState with states that cover
 * ambiguous network outcomes, safe retry eligibility, and permanent failures.
 * This module is pure (no I/O) and can be imported anywhere.
 */

// ── Extended state type ───────────────────────────────────────────────────────

/**
 * All states in the extended transaction lifecycle:
 *
 *   preparing → awaiting_wallet → submitted ─┬→ confirming → confirmed
 *                                             ↓
 *                                        unknown_outcome ─┬→ submitted (recovery confirmed it went through)
 *                                                         ├→ retry_eligible (confirmed it did NOT go through)
 *                                                         └→ failed
 *
 *   Any active state → failed → retry_eligible → preparing (begin retry)
 *   Any active state → failed → retry_blocked (terminal)
 */
export type ExtendedTransactionState =
  | "preparing"
  | "awaiting_wallet"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "failed"
  | "unknown_outcome"   // Submitted but network response lost — outcome unclear
  | "retry_eligible"    // Known failure that is safe to retry
  | "retry_blocked";    // Permanent failure or max retries exceeded — no further retries

// ── State transition map ──────────────────────────────────────────────────────

export const EXTENDED_STATE_TRANSITIONS: Record<
  ExtendedTransactionState,
  ExtendedTransactionState[]
> = {
  preparing: ["awaiting_wallet", "failed"],
  awaiting_wallet: ["submitted", "failed"],
  submitted: ["confirming", "unknown_outcome", "failed"],
  confirming: ["confirmed", "failed"],
  confirmed: [],
  failed: ["retry_eligible", "retry_blocked", "preparing"],
  unknown_outcome: ["submitted", "retry_eligible", "failed"],
  retry_eligible: ["preparing"],
  retry_blocked: [], // terminal — no further transitions
};

// ── Human-readable labels ─────────────────────────────────────────────────────

export const EXTENDED_STATE_LABELS: Record<
  ExtendedTransactionState,
  { label: string; description: string }
> = {
  preparing: {
    label: "Preparing",
    description: "Building and validating the transaction locally…",
  },
  awaiting_wallet: {
    label: "Awaiting Approval",
    description: "Please approve and sign the transaction in your wallet.",
  },
  submitted: {
    label: "Submitted",
    description: "Transaction sent to the Stellar network.",
  },
  confirming: {
    label: "Confirming",
    description: "Awaiting confirmation from the network…",
  },
  confirmed: {
    label: "Confirmed",
    description: "Transaction successfully included in the ledger.",
  },
  failed: {
    label: "Failed",
    description: "The transaction was rejected or encountered an error.",
  },
  unknown_outcome: {
    label: "Outcome Unknown",
    description:
      "The network response was lost. Verifying whether the transaction was accepted…",
  },
  retry_eligible: {
    label: "Retry Available",
    description:
      "The failure is recoverable. The transaction can be safely retried.",
  },
  retry_blocked: {
    label: "Retry Blocked",
    description:
      "The failure is permanent or max retries have been exhausted. No further attempts are possible.",
  },
};

// ── Sequence error infrastructure ─────────────────────────────────────────────

export const SequenceErrorCode = {
  STALE_SEQUENCE: "STALE_SEQUENCE",
  SEQUENCE_CONFLICT: "SEQUENCE_CONFLICT",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  SEQUENCE_FETCH_FAILED: "SEQUENCE_FETCH_FAILED",
} as const;

export type SequenceErrorCode =
  (typeof SequenceErrorCode)[keyof typeof SequenceErrorCode];

/** Thrown or returned when a Stellar account sequence number issue is detected. */
export class SequenceError extends Error {
  readonly code: SequenceErrorCode;
  readonly accountId: string;
  /** The current on-chain sequence number at the time of the error, if known. */
  readonly currentSequence?: bigint;
  /** The sequence number that was used (or attempted) in the transaction. */
  readonly usedSequence?: bigint;

  constructor(
    code: SequenceErrorCode,
    accountId: string,
    message: string,
    options?: { currentSequence?: bigint; usedSequence?: bigint },
  ) {
    super(message);
    this.name = "SequenceError";
    this.code = code;
    this.accountId = accountId;
    this.currentSequence = options?.currentSequence;
    this.usedSequence = options?.usedSequence;
  }
}

// ── Submission outcome discriminated union ────────────────────────────────────

/**
 * The result of attempting to submit a Stellar transaction.
 *
 * - `confirmed` — the network accepted and confirmed the transaction
 * - `failed`    — the network definitively rejected it (or a local error occurred);
 *                 `retryable` indicates whether a new attempt is safe
 * - `unknown`   — the network connection was lost mid-flight; we cannot determine
 *                 whether the transaction was accepted without a recovery check
 */
export type SubmissionOutcome =
  | {
      status: "confirmed";
      transactionHash: string;
      ledger: number;
      feeCharged: string;
    }
  | {
      status: "failed";
      transactionHash?: string;
      error: string;
      retryable: boolean;
      sequenceError?: SequenceError;
    }
  | {
      status: "unknown";
      transactionHash?: string;
      error: string;
    };

// ── Recovery action discriminated union ──────────────────────────────────────

/**
 * The recommended action following a recovery check on an ambiguous transaction.
 *
 * - `confirm_success` — the transaction was found on-chain and succeeded
 * - `retry`           — the transaction did not go through; it is safe to resubmit
 * - `give_up`         — the transaction cannot be recovered automatically
 */
export type RecoveryAction =
  | { action: "confirm_success"; transactionHash: string; ledger: number }
  | { action: "retry"; reason: string }
  | { action: "give_up"; reason: string };

// ── Helper predicates ─────────────────────────────────────────────────────────

/**
 * Returns true when the state indicates an automatic retry is explicitly available.
 */
export function isRetryEligibleState(state: ExtendedTransactionState): boolean {
  return state === "retry_eligible";
}

/**
 * Returns true for states from which no further progress is possible without
 * external intervention (starting a fresh flow).
 */
export function isTerminalExtendedState(state: ExtendedTransactionState): boolean {
  return state === "confirmed" || state === "retry_blocked";
}

/**
 * Returns true when the transaction outcome is not yet known and a recovery
 * check must be performed before any retry decision.
 */
export function isAmbiguousState(state: ExtendedTransactionState): boolean {
  return state === "unknown_outcome";
}

/**
 * Returns true when a state transition is valid according to the extended rules.
 */
export function isValidExtendedTransition(
  from: ExtendedTransactionState,
  to: ExtendedTransactionState,
): boolean {
  return EXTENDED_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}
