/**
 * Transaction Lifecycle State Model
 *
 * A backend-focused state model for tracking Stellar transaction outcomes
 * from preparation through confirmation (or ambiguous failure). This
 * complements the UI-facing `transaction-state-machine.ts` but is designed
 * for server-side submission, recovery, and audit workflows where the
 * critical question is not "what step is the user on?" but "do we know the
 * final outcome, and is a retry safe?"
 *
 * States:
 *   pending_submission → submitted → confirmed
 *                          ↘ failed
 *                          ↘ unknown
 *   Any state → retry_eligible / retry_blocked (derived flags, not
 *   primary states, but exposed as lifecycle statuses for callers that
 *   need a single flat enum).
 *
 * The model is intentionally a pure function/reducer so it can be persisted
 * (e.g. in a database row or log), replayed after a process restart, and
 * tested without any external dependencies.
 */

import { logBlockchainOperation, generateCorrelationId } from "./logger";

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Primary lifecycle states for a transaction submission.
 *
 * `retry_eligible` and `retry_blocked` are derived *classifications* rather
 * than primary states — they are included in this union so callers that need
 * a single status field can use the flat enum directly.
 */
export type TransactionLifecycleState =
  | "pending_submission"
  | "submitted"
  | "confirmed"
  | "failed"
  | "unknown"
  | "retry_eligible"
  | "retry_blocked";

/**
 * The set of states that represent a known, final outcome.
 */
export const TERMINAL_STATES: ReadonlySet<TransactionLifecycleState> = new Set<TransactionLifecycleState>([
  "confirmed",
  "failed",
]);

/**
 * The set of states where the transaction outcome is ambiguous — the
 * submission may or may not have been accepted by the network.
 */
export const AMBIGUOUS_STATES: ReadonlySet<TransactionLifecycleState> = new Set<TransactionLifecycleState>([
  "unknown",
]);

/**
 * Valid state transitions. Used by the reducer to enforce consistency.
 */
export const LIFECYCLE_TRANSITIONS: Record<
  TransactionLifecycleState,
  TransactionLifecycleState[]
> = {
  pending_submission: ["submitted", "failed", "retry_eligible", "retry_blocked"],
  submitted: ["confirmed", "failed", "unknown"],
  confirmed: [],
  failed: ["retry_eligible", "retry_blocked"],
  unknown: ["confirmed", "failed", "retry_eligible", "retry_blocked"],
  retry_eligible: ["pending_submission"],
  retry_blocked: [],
};

/**
 * Metadata associated with a lifecycle context. This is what gets persisted
 * and replayed.
 */
export interface TransactionLifecycleContext {
  /** Unique identifier for this lifecycle instance. */
  id: string;
  /** Current lifecycle state. */
  state: TransactionLifecycleState;
  /** Stellar transaction hash, available after submission. */
  transactionHash: string | null;
  /** Ledger number, available after confirmation. */
  ledger: number | null;
  /** Fee charged in stroops. */
  feeCharged: string | null;
  /** Human-readable error message when state is failed/unknown. */
  errorMessage: string | null;
  /** Machine-readable error code. */
  errorCode: string | null;
  /** Whether the transaction is idempotent (safe to retry). */
  idempotent: boolean;
  /** Number of retry attempts made. */
  retryCount: number;
  /** Maximum allowed retries. */
  maxRetries: number;
  /** ISO timestamp when the lifecycle started. */
  startedAt: string;
  /** ISO timestamp of the last state change. */
  updatedAt: string;
  /** Optional correlation ID for tracing. */
  correlationId: string | null;
  /** Optional operation label for logging. */
  operationLabel: string | null;
}

/**
 * Actions that can be applied to a lifecycle context.
 */
export type TransactionLifecycleAction =
  | { type: "MARK_SUBMITTED"; transactionHash: string; feeCharged?: string }
  | { type: "MARK_CONFIRMED"; ledger: number }
  | { type: "MARK_FAILED"; errorMessage: string; errorCode?: string }
  | { type: "MARK_UNKNOWN"; errorMessage: string; errorCode?: string }
  | { type: "EVALUATE_RETRY" }
  | { type: "BEGIN_RETRY" }
  | { type: "RESET" };

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a fresh transaction lifecycle context in the
 * `pending_submission` state.
 */
export function createLifecycleContext(options?: {
  id?: string;
  idempotent?: boolean;
  maxRetries?: number;
  operationLabel?: string;
  correlationId?: string;
}): TransactionLifecycleContext {
  const now = new Date().toISOString();
  return {
    id: options?.id ?? generateCorrelationId(),
    state: "pending_submission",
    transactionHash: null,
    ledger: null,
    feeCharged: null,
    errorMessage: null,
    errorCode: null,
    idempotent: options?.idempotent ?? false,
    retryCount: 0,
    maxRetries: options?.maxRetries ?? 3,
    startedAt: now,
    updatedAt: now,
    correlationId: options?.correlationId ?? null,
    operationLabel: options?.operationLabel ?? null,
  };
}

// ── Transition Validation ──────────────────────────────────────────────────

/**
 * Checks whether a state transition is valid according to the lifecycle rules.
 */
export function isValidLifecycleTransition(
  from: TransactionLifecycleState,
  to: TransactionLifecycleState,
): boolean {
  return LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── State Predicates ────────────────────────────────────────────────────────

/** Returns true when the state represents a known, final outcome. */
export function isTerminalLifecycleState(state: TransactionLifecycleState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Returns true when the transaction outcome is ambiguous (unknown). */
export function isAmbiguousState(state: TransactionLifecycleState): boolean {
  return AMBIGUOUS_STATES.has(state);
}

/**
 * Returns true when the transaction has a known hash (was submitted to the
 * network) regardless of the final outcome.
 */
export function hasBeenSubmitted(context: TransactionLifecycleContext): boolean {
  return context.transactionHash !== null;
}

/**
 * Determines whether a retry is safe given the current context.
 *
 * A retry is safe when:
 *  - The outcome is known (not `unknown`/`submitted`), OR the operation is
 *    idempotent.
 *  - The retry count has not exceeded the maximum.
 *  - The state allows retrying (failed/unknown/retry_eligible).
 */
export function isRetrySafe(context: TransactionLifecycleContext): boolean {
  if (context.retryCount >= context.maxRetries) return false;

  const retryableStates: TransactionLifecycleState[] = [
    "failed",
    "unknown",
    "retry_eligible",
  ];
  if (!retryableStates.includes(context.state)) return false;

  // If the outcome is unknown and the operation is NOT idempotent, retrying
  // could cause a duplicate execution — block it.
  if (context.state === "unknown" && !context.idempotent) return false;

  return true;
}

// ── Reducer ────────────────────────────────────────────────────────────────

/**
 * Pure reducer that applies a lifecycle action to a context and returns the
 * next context. Throws on invalid transitions.
 */
export function lifecycleReducer(
  context: TransactionLifecycleContext,
  action: TransactionLifecycleAction,
): TransactionLifecycleContext {
  const now = new Date().toISOString();

  switch (action.type) {
    case "MARK_SUBMITTED": {
      assertTransition(context.state, "submitted", action.type);
      return {
        ...context,
        state: "submitted",
        transactionHash: action.transactionHash,
        feeCharged: action.feeCharged ?? context.feeCharged,
        errorMessage: null,
        errorCode: null,
        updatedAt: now,
      };
    }

    case "MARK_CONFIRMED": {
      assertTransition(context.state, "confirmed", action.type);
      return {
        ...context,
        state: "confirmed",
        ledger: action.ledger,
        errorMessage: null,
        errorCode: null,
        updatedAt: now,
      };
    }

    case "MARK_FAILED": {
      assertTransition(context.state, "failed", action.type);
      return {
        ...context,
        state: "failed",
        errorMessage: action.errorMessage,
        errorCode: action.errorCode ?? null,
        updatedAt: now,
      };
    }

    case "MARK_UNKNOWN": {
      assertTransition(context.state, "unknown", action.type);
      return {
        ...context,
        state: "unknown",
        errorMessage: action.errorMessage,
        errorCode: action.errorCode ?? null,
        updatedAt: now,
      };
    }

    case "EVALUATE_RETRY": {
      // Evaluate whether a retry is safe and transition to the
      // appropriate classification state.
      const safe = isRetrySafe(context);
      const target: TransactionLifecycleState = safe ? "retry_eligible" : "retry_blocked";
      assertTransition(context.state, target, action.type);
      return {
        ...context,
        state: target,
        updatedAt: now,
      };
    }

    case "BEGIN_RETRY": {
      assertTransition(context.state, "pending_submission", action.type);
      return {
        ...context,
        state: "pending_submission",
        transactionHash: null,
        ledger: null,
        feeCharged: null,
        errorMessage: null,
        errorCode: null,
        retryCount: context.retryCount + 1,
        updatedAt: now,
      };
    }

    case "RESET": {
      return createLifecycleContext({
        id: context.id,
        idempotent: context.idempotent,
        maxRetries: context.maxRetries,
        operationLabel: context.operationLabel ?? undefined,
        correlationId: context.correlationId ?? undefined,
      });
    }

    default: {
      const _exhaustive: never = action;
      return context;
    }
  }
}

// ── Non-throwing wrapper ───────────────────────────────────────────────────

/**
 * Applies an action to the context with logging. Returns the updated context
 * or the original context if the transition was invalid (non-throwing variant
 * for service code that needs to handle errors gracefully).
 */
export function applyLifecycleAction(
  context: TransactionLifecycleContext,
  action: TransactionLifecycleAction,
): { context: TransactionLifecycleContext; error?: string } {
  try {
    const next = lifecycleReducer(context, action);
    logBlockchainOperation(
      "info",
      `Transaction lifecycle: ${context.state} → ${next.state}`,
      {
        lifecycleId: context.id,
        action: action.type,
        fromState: context.state,
        toState: next.state,
        transactionHash: next.transactionHash,
        retryCount: next.retryCount,
      },
      context.correlationId ?? undefined,
    );
    return { context: next };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Unknown lifecycle error";
    logBlockchainOperation(
      "warn",
      "Invalid lifecycle transition attempted",
      {
        lifecycleId: context.id,
        action: action.type,
        currentState: context.state,
        error: { type: "LifecycleError", message: errorMsg },
      },
      context.correlationId ?? undefined,
    );
    return { context, error: errorMsg };
  }
}

// ── Serialization (for persistence / restart recovery) ─────────────────────

/**
 * Serializes a lifecycle context to a plain JSON-safe object suitable for
 * database storage.
 */
export function serializeLifecycle(
  context: TransactionLifecycleContext,
): Record<string, unknown> {
  return { ...context };
}

/**
 * Deserializes a lifecycle context from a stored record. Validates that the
 * state is a known lifecycle state.
 */
export function deserializeLifecycle(
  data: Record<string, unknown>,
): TransactionLifecycleContext {
  const state = data.state as TransactionLifecycleState;
  if (!ALL_LIFECYCLE_STATES.has(state)) {
    throw new Error(`Unknown lifecycle state: ${String(state)}`);
  }
  return {
    id: String(data.id ?? generateCorrelationId()),
    state,
    transactionHash: (data.transactionHash as string) ?? null,
    ledger: (data.ledger as number) ?? null,
    feeCharged: (data.feeCharged as string) ?? null,
    errorMessage: (data.errorMessage as string) ?? null,
    errorCode: (data.errorCode as string) ?? null,
    idempotent: Boolean(data.idempotent),
    retryCount: Number(data.retryCount ?? 0),
    maxRetries: Number(data.maxRetries ?? 3),
    startedAt: String(data.startedAt ?? new Date().toISOString()),
    updatedAt: String(data.updatedAt ?? new Date().toISOString()),
    correlationId: (data.correlationId as string) ?? null,
    operationLabel: (data.operationLabel as string) ?? null,
  };
}

// ── Internal ──────────────────────────────────────────────────────────────

const ALL_LIFECYCLE_STATES: ReadonlySet<TransactionLifecycleState> = new Set<TransactionLifecycleState>([
  "pending_submission",
  "submitted",
  "confirmed",
  "failed",
  "unknown",
  "retry_eligible",
  "retry_blocked",
]);

function assertTransition(
  from: TransactionLifecycleState,
  to: TransactionLifecycleState,
  actionType: string,
): void {
  if (!isValidLifecycleTransition(from, to)) {
    throw new Error(
      `Invalid lifecycle transition: ${from} → ${to} via ${actionType}`,
    );
  }
}
