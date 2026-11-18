"use client";

/**
 * useTransactionConfirmation — React hook for the Stellar transaction confirmation flow.
 *
 * Manages the transaction state machine, exposes actions for UI components,
 * and integrates with the Stellar retry API.
 */

import { useCallback, useReducer, useRef } from "react";
import type {
  TransactionConfirmationContext,
  TransactionConfirmationAction,
} from "@/types/blockchain";
import {
  createTransactionContext,
  transactionReducer,
  applyAction,
  isTerminalState,
  isActiveState,
  getStateProgress,
} from "@/lib/blockchain/transaction-state-machine";
import { TRANSACTION_STATE_LABELS } from "@/types/blockchain";

export interface UseTransactionConfirmationOptions {
  /** Stellar group/room ID to use for retry API calls */
  groupId?: string;
  /** Type of transaction being performed */
  transactionType?: TransactionConfirmationContext["transactionType"];
  /** Human-readable label for the operation */
  operationLabel?: string;
  /** Maximum number of automatic retries */
  maxRetries?: number;
  /** Called when the transaction is confirmed */
  onConfirmed?: (context: TransactionConfirmationContext) => void;
  /** Called when the transaction fails */
  onFailed?: (context: TransactionConfirmationContext) => void;
}

export interface UseTransactionConfirmationReturn {
  context: TransactionConfirmationContext;
  isActive: boolean;
  isTerminal: boolean;
  progress: number;
  stateLabel: string;
  stateDescription: string;
  // Actions
  startPreparing: () => void;
  awaitWallet: () => void;
  markSubmitted: (opts: { transactionHash: string; feeCharged?: string; explorerUrl?: string }) => void;
  startConfirming: () => void;
  markConfirmed: (ledger: number) => void;
  markFailed: (errorMessage: string, retryable?: boolean) => void;
  retry: () => Promise<void>;
  reset: () => void;
}

function stateReducerWrapper(
  context: TransactionConfirmationContext,
  action: TransactionConfirmationAction,
): TransactionConfirmationContext {
  const { context: next } = applyAction(context, action);
  return next;
}

export function useTransactionConfirmation(
  options: UseTransactionConfirmationOptions = {},
): UseTransactionConfirmationReturn {
  const {
    groupId,
    transactionType = "generic",
    operationLabel,
    maxRetries = 3,
    onConfirmed,
    onFailed,
  } = options;

  const [context, dispatch] = useReducer(
    stateReducerWrapper,
    undefined,
    () =>
      createTransactionContext({
        groupId,
        transactionType,
        operationLabel,
        maxRetries,
      }),
  );

  // Keep callbacks in refs to avoid stale closure issues
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;

  const startPreparing = useCallback(() => {
    dispatch({ type: "START_PREPARING" });
  }, []);

  const awaitWallet = useCallback(() => {
    dispatch({ type: "AWAIT_WALLET" });
  }, []);

  const markSubmitted = useCallback(
    (opts: { transactionHash: string; feeCharged?: string; explorerUrl?: string }) => {
      dispatch({
        type: "SUBMIT",
        transactionHash: opts.transactionHash,
        feeCharged: opts.feeCharged,
        explorerUrl: opts.explorerUrl,
      });
    },
    [],
  );

  const startConfirming = useCallback(() => {
    dispatch({ type: "START_CONFIRMING" });
  }, []);

  const markConfirmed = useCallback(
    (ledger: number) => {
      dispatch({ type: "CONFIRM", ledger });
      // Fire callback after dispatch via microtask
      Promise.resolve().then(() => {
        onConfirmedRef.current?.(context);
      });
    },
    [context],
  );

  const markFailed = useCallback(
    (errorMessage: string, retryable = true) => {
      dispatch({ type: "FAIL", errorMessage, retryable });
      Promise.resolve().then(() => {
        onFailedRef.current?.(context);
      });
    },
    [context],
  );

  const retry = useCallback(async () => {
    if (context.state !== "failed" || !context.retryable) return;

    // If there's an attemptId and groupId, use the API to retry
    if (context.attemptId && context.groupId) {
      dispatch({ type: "RETRY" });
      dispatch({ type: "AWAIT_WALLET" });

      try {
        const res = await fetch(
          `/api/stellar/transactions/retry/${encodeURIComponent(context.groupId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attemptId: context.attemptId }),
          },
        );

        const data = await res.json();

        if (res.ok && data.success && data.transactionHash) {
          dispatch({
            type: "SUBMIT",
            transactionHash: data.transactionHash,
            feeCharged: data.feeCharged,
            explorerUrl: data.explorerUrl,
          });
          dispatch({ type: "START_CONFIRMING" });
          dispatch({ type: "CONFIRM", ledger: 0 });
        } else {
          dispatch({
            type: "FAIL",
            errorMessage: data.error ?? "Retry failed. Please try again.",
            retryable: true,
          });
        }
      } catch (err: any) {
        dispatch({
          type: "FAIL",
          errorMessage: err?.message ?? "Network error during retry.",
          retryable: true,
        });
      }
    } else {
      // Optimistic retry — just reset to preparing state
      dispatch({ type: "RETRY" });
    }
  }, [context]);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  const isActive = isActiveState(context.state);
  const isTerminal = isTerminalState(context.state);
  const progress = getStateProgress(context.state);
  const { label: stateLabel, description: stateDescription } =
    TRANSACTION_STATE_LABELS[context.state];

  return {
    context,
    isActive,
    isTerminal,
    progress,
    stateLabel,
    stateDescription,
    startPreparing,
    awaitWallet,
    markSubmitted,
    startConfirming,
    markConfirmed,
    markFailed,
    retry,
    reset,
  };
}
