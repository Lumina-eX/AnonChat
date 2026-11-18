/**
 * Stellar Transaction Confirmation Flow — State Machine
 *
 * Implements a deterministic state machine for tracking Stellar transaction
 * lifecycle from preparation through confirmation (or failure with retry).
 *
 * States: preparing → awaiting_wallet → submitted → confirming → confirmed
 *         Any state can transition to: failed
 *         failed → preparing (retry)
 */

import { randomUUID } from "crypto";
import type {
  TransactionConfirmationState,
  TransactionConfirmationContext,
  TransactionConfirmationAction,
} from "@/types/blockchain";
import { VALID_STATE_TRANSITIONS } from "@/types/blockchain";
import { logBlockchainOperation } from "./logger";

const DEFAULT_MAX_RETRIES = 3;

/**
 * Checks whether a state transition is valid according to the machine rules.
 */
export function isValidTransition(
  from: TransactionConfirmationState,
  to: TransactionConfirmationState,
): boolean {
  return VALID_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Creates a fresh transaction confirmation context.
 */
export function createTransactionContext(
  options: Partial<
    Pick<
      TransactionConfirmationContext,
      "groupId" | "attemptId" | "transactionType" | "operationLabel" | "maxRetries"
    >
  > = {},
): TransactionConfirmationContext {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    state: "preparing",
    transactionHash: null,
    ledger: null,
    feeCharged: null,
    explorerUrl: null,
    errorMessage: null,
    retryable: false,
    retryCount: 0,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    startedAt: now,
    updatedAt: now,
    groupId: options.groupId ?? null,
    attemptId: options.attemptId ?? null,
    transactionType: options.transactionType ?? "generic",
    operationLabel: options.operationLabel ?? "Stellar Transaction",
  };
}

/**
 * Pure state machine reducer. Applies an action to the current context
 * and returns the next context. Throws if the transition is invalid.
 */
export function transactionReducer(
  context: TransactionConfirmationContext,
  action: TransactionConfirmationAction,
): TransactionConfirmationContext {
  const now = new Date().toISOString();

  switch (action.type) {
    case "START_PREPARING": {
      if (!isValidTransition(context.state, "preparing") && context.state !== "preparing") {
        throw new Error(
          `Invalid transition: ${context.state} → preparing via START_PREPARING`,
        );
      }
      return {
        ...context,
        state: "preparing",
        errorMessage: null,
        retryable: false,
        updatedAt: now,
      };
    }

    case "AWAIT_WALLET": {
      if (!isValidTransition(context.state, "awaiting_wallet")) {
        throw new Error(
          `Invalid transition: ${context.state} → awaiting_wallet via AWAIT_WALLET`,
        );
      }
      return { ...context, state: "awaiting_wallet", updatedAt: now };
    }

    case "SUBMIT": {
      if (!isValidTransition(context.state, "submitted")) {
        throw new Error(
          `Invalid transition: ${context.state} → submitted via SUBMIT`,
        );
      }
      return {
        ...context,
        state: "submitted",
        transactionHash: action.transactionHash,
        feeCharged: action.feeCharged ?? context.feeCharged,
        explorerUrl: action.explorerUrl ?? context.explorerUrl,
        updatedAt: now,
      };
    }

    case "START_CONFIRMING": {
      if (!isValidTransition(context.state, "confirming")) {
        throw new Error(
          `Invalid transition: ${context.state} → confirming via START_CONFIRMING`,
        );
      }
      return { ...context, state: "confirming", updatedAt: now };
    }

    case "CONFIRM": {
      if (!isValidTransition(context.state, "confirmed")) {
        throw new Error(
          `Invalid transition: ${context.state} → confirmed via CONFIRM`,
        );
      }
      return {
        ...context,
        state: "confirmed",
        ledger: action.ledger,
        errorMessage: null,
        updatedAt: now,
      };
    }

    case "FAIL": {
      if (!isValidTransition(context.state, "failed")) {
        throw new Error(
          `Invalid transition: ${context.state} → failed via FAIL`,
        );
      }
      const canRetry =
        (action.retryable ?? true) &&
        context.retryCount < context.maxRetries;
      return {
        ...context,
        state: "failed",
        errorMessage: action.errorMessage,
        retryable: canRetry,
        updatedAt: now,
      };
    }

    case "RETRY": {
      if (context.state !== "failed") {
        throw new Error(`Cannot retry from state: ${context.state}`);
      }
      if (!context.retryable) {
        throw new Error("Transaction is not retryable (max retries exceeded or non-retryable error)");
      }
      return {
        ...context,
        state: "preparing",
        errorMessage: null,
        retryable: false,
        retryCount: context.retryCount + 1,
        updatedAt: now,
      };
    }

    case "RESET": {
      return createTransactionContext({
        groupId: context.groupId ?? undefined,
        transactionType: context.transactionType,
        operationLabel: context.operationLabel,
        maxRetries: context.maxRetries,
      });
    }

    default: {
      // Exhaustive check
      const _exhaustive: never = action;
      return context;
    }
  }
}

/**
 * Applies an action to the context with logging. Returns the updated context
 * or the original context if the transition was invalid (non-throwing variant
 * for UI code).
 */
export function applyAction(
  context: TransactionConfirmationContext,
  action: TransactionConfirmationAction,
  correlationId?: string,
): { context: TransactionConfirmationContext; error?: string } {
  try {
    const next = transactionReducer(context, action);
    logBlockchainOperation(
      "info",
      `Transaction state: ${context.state} → ${next.state}`,
      {
        flowId: context.id,
        action: action.type,
        fromState: context.state,
        toState: next.state,
        transactionHash: next.transactionHash ?? undefined,
        retryCount: next.retryCount,
      },
      correlationId,
    );
    return { context: next };
  } catch (err: any) {
    const errorMsg = err?.message ?? "Unknown state machine error";
    logBlockchainOperation(
      "warn",
      "Invalid state machine transition attempted",
      {
        flowId: context.id,
        action: action.type,
        currentState: context.state,
        error: errorMsg,
      },
      correlationId,
    );
    return { context, error: errorMsg };
  }
}

/**
 * Derives whether a given state represents a terminal (non-progressing) state.
 */
export function isTerminalState(state: TransactionConfirmationState): boolean {
  return state === "confirmed" || state === "failed";
}

/**
 * Derives whether a given state is an active (in-progress) state.
 */
export function isActiveState(state: TransactionConfirmationState): boolean {
  return (
    state === "preparing" ||
    state === "awaiting_wallet" ||
    state === "submitted" ||
    state === "confirming"
  );
}

/**
 * Returns a percentage (0–100) representing overall progress for a given state.
 * Useful for progress bar UIs.
 */
export function getStateProgress(state: TransactionConfirmationState): number {
  switch (state) {
    case "preparing":
      return 10;
    case "awaiting_wallet":
      return 30;
    case "submitted":
      return 60;
    case "confirming":
      return 80;
    case "confirmed":
      return 100;
    case "failed":
      return 0;
    default:
      return 0;
  }
}
