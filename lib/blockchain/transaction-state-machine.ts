/**
 * Stellar Transaction Confirmation Flow — State Machine
 *
 * Defines the lifecycle of a blockchain operation and the valid transitions
 * between each state. This is a pure, framework-agnostic module so it can be
 * unit-tested in isolation and reused across desktop and mobile.
 */

export type TransactionState =
  | "preparing"
  | "awaiting_wallet_approval"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "failed";

export type TransactionEvent =
  | "PREPARE"
  | "REQUEST_WALLET_APPROVAL"
  | "WALLET_APPROVED"
  | "WALLET_REJECTED"
  | "SUBMIT"
  | "SUBMIT_ERROR"
  | "CONFIRMING"
  | "CONFIRMED"
  | "CONFIRMATION_ERROR"
  | "RETRY";

export interface TransactionStateContext {
  /** Transaction hash once submission occurs. */
  transactionHash?: string;
  /** Explorer URL for the transaction hash. */
  explorerUrl?: string;
  /** Human-readable error message when the transaction fails. */
  error?: string;
  /** Number of retry attempts performed. */
  retryCount?: number;
}

export interface TransactionStateSnapshot {
  state: TransactionState;
  context: TransactionStateContext;
}

/** Valid transitions keyed by current state → allowed events. */
const TRANSITIONS: Record<TransactionState, Partial<Record<TransactionEvent, TransactionState>>> = {
  preparing: {
    REQUEST_WALLET_APPROVAL: "awaiting_wallet_approval",
    FAILED: "failed",
  },
  awaiting_wallet_approval: {
    WALLET_APPROVED: "submitted",
    WALLET_REJECTED: "failed",
  },
  submitted: {
    CONFIRMING: "confirming",
    CONFIRMED: "confirmed",
    CONFIRMATION_ERROR: "failed",
  },
  confirming: {
    CONFIRMED: "confirmed",
    CONFIRMATION_ERROR: "failed",
  },
  confirmed: {},
  failed: {
    RETRY: "preparing",
  },
};

/** Terminal states that cannot transition further. */
export const TERMINAL_STATES: ReadonlySet<TransactionState> = new Set([
  "confirmed",
  "failed",
]);

/**
 * Creates a new transaction state machine instance.
 */
export function createTransactionStateMachine(
  initialState: TransactionState = "preparing",
  initialContext: TransactionStateContext = {},
) {
  let state: TransactionState = initialState;
  let context: TransactionStateContext = { ...initialContext };

  function getSnapshot(): TransactionStateSnapshot {
    return { state, context: { ...context } };
  }

  function getState(): TransactionState {
    return state;
  }

  function getContext(): TransactionStateContext {
    return { ...context };
  }

  function isTerminal(): boolean {
    return TERMINAL_STATES.has(state);
  }

  /**
   * Attempts to transition to a new state given an event.
   * Returns true if the transition was valid and applied, false otherwise.
   */
  function transition(
    event: TransactionEvent,
    nextContext: TransactionStateContext = {},
  ): boolean {
    const allowed = TRANSITIONS[state]?.[event];
    if (!allowed) {
      return false;
    }

    state = allowed;
    context = { ...context, ...nextContext };

    // Reset error/retry context when retrying from a failed state.
    if (event === "RETRY") {
      context.error = undefined;
      context.retryCount = (context.retryCount ?? 0) + 1;
    }

    return true;
  }

  return {
    getSnapshot,
    getState,
    getContext,
    isTerminal,
    transition,
  };
}

export type TransactionStateMachine = ReturnType<typeof createTransactionStateMachine>;

/**
 * Human-readable label for each state, used by UI components.
 */
export const TRANSACTION_STATE_LABELS: Record<TransactionState, string> = {
  preparing: "Preparing",
  awaiting_wallet_approval: "Awaiting wallet approval",
  submitted: "Submitted",
  confirming: "Confirming",
  confirmed: "Confirmed",
  failed: "Failed",
};

/**
 * Visual tone for each state, used to drive indicator styling.
 */
export const TRANSACTION_STATE_TONES: Record<TransactionState, "neutral" | "warning" | "info" | "success" | "danger"> = {
  preparing: "neutral",
  awaiting_wallet_approval: "warning",
  submitted: "info",
  confirming: "info",
  confirmed: "success",
  failed: "danger",
};
