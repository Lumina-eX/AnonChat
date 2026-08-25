"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createTransactionStateMachine,
  TransactionState,
  TransactionStateContext,
  TransactionStateSnapshot,
  TransactionEvent,
} from "./transaction-state-machine";
import { useWebSocketMessage } from "@/lib/websocket/hooks";
import { WebSocketMessage } from "@/types/websocket";
import { getExplorerUrl } from "./stellar-config";
import { handleAppError } from "@/lib/error-handler";

/**
 * Configuration for a single blockchain operation.
 */
export interface TransactionFlowOptions {
  /**
   * Builds and validates the transaction locally. Should return the
   * transaction payload (e.g. XDR) or throw an error.
   */
  buildTransaction: () => Promise<unknown>;
  /**
   * Requests the user to approve/sign the transaction in their wallet.
   * Should return the signed transaction or throw on rejection.
   */
  requestWalletApproval: (builtTransaction: unknown) => Promise<unknown>;
  /**
   * Submits the signed transaction to the Stellar network.
   * Should return an object containing the transaction hash.
   */
  submitTransaction: (signedTransaction: unknown) => Promise<{ transactionHash: string }>;
  /**
   * Verifies that the transaction has been included in a ledger.
   * Should resolve once the transaction is confirmed on-chain.
   */
  verifyConfirmation: (transactionHash: string) => Promise<void>;
  /**
   * Stellar network type used to build explorer URLs.
   */
  network: "testnet" | "mainnet";
  /**
   * Optional realtime event type to listen for confirmation updates.
   * When provided, the flow will also react to server-pushed events.
   */
  realtimeEventType?: string;
}

export interface TransactionFlowResult {
  snapshot: TransactionStateSnapshot;
  state: TransactionState;
  context: TransactionStateContext;
  isTerminal: boolean;
  /** Starts the flow from the beginning. */
  start: () => Promise<void>;
  /** Retries a failed transaction (rebuilds and resubmits). */
  retry: () => Promise<void>;
  /** Resets the flow back to the initial state. */
  reset: () => void;
}

/**
 * Reusable hook that drives a blockchain operation through the full
 * transaction confirmation flow:
 *
 *   preparing → awaiting_wallet_approval → submitted → confirming → confirmed
 *                                                              ↘ failed → retry
 *
 * Integrates with realtime events so the UI updates immediately as states
 * change, and surfaces meaningful errors for network timeouts, rejected
 * signatures, and invalid transactions.
 */
export function useTransactionFlow(
  options: TransactionFlowOptions,
): TransactionFlowResult {
  const {
    buildTransaction,
    requestWalletApproval,
    submitTransaction,
    verifyConfirmation,
    network,
    realtimeEventType,
  } = options;

  const machineRef = useRef(createTransactionStateMachine());
  const [snapshot, setSnapshot] = useState<TransactionStateSnapshot>(
    machineRef.current.getSnapshot(),
  );
  const runningRef = useRef(false);

  const syncSnapshot = useCallback(() => {
    setSnapshot(machineRef.current.getSnapshot());
  }, []);

  const applyTransition = useCallback(
    (event: TransactionEvent, context: TransactionStateContext = {}) => {
      const applied = machineRef.current.transition(event, context);
      if (applied) {
        syncSnapshot();
      }
      return applied;
    },
    [syncSnapshot],
  );

  const runFlow = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    try {
      // 1. Preparing — build and validate locally.
      applyTransition("PREPARE");
      let builtTransaction: unknown;
      try {
        builtTransaction = await buildTransaction();
      } catch (error) {
        applyTransition("FAILED", {
          error: error instanceof Error ? error.message : "Failed to build transaction.",
        });
        handleAppError(error, "SEND_MESSAGE");
        return;
      }

      // 2. Awaiting wallet approval.
      applyTransition("REQUEST_WALLET_APPROVAL");
      let signedTransaction: unknown;
      try {
        signedTransaction = await requestWalletApproval(builtTransaction);
      } catch (error) {
        applyTransition("FAILED", {
          error: error instanceof Error ? error.message : "Transaction was not approved.",
        });
        handleAppError(error, "SEND_MESSAGE");
        return;
      }

      // 3. Submitted — send to the Stellar network and expose the hash.
      let transactionHash: string;
      try {
        const result = await submitTransaction(signedTransaction);
        transactionHash = result.transactionHash;
      } catch (error) {
        applyTransition("FAILED", {
          error: error instanceof Error ? error.message : "Failed to submit transaction.",
        });
        handleAppError(error, "SEND_MESSAGE");
        return;
      }

      const explorerUrl = getExplorerUrl(transactionHash, network);
      applyTransition("SUBMIT", { transactionHash, explorerUrl });

      // 4. Confirming — await ledger inclusion.
      applyTransition("CONFIRMING");
      try {
        await verifyConfirmation(transactionHash);
      } catch (error) {
        applyTransition("FAILED", {
          transactionHash,
          explorerUrl,
          error: error instanceof Error ? error.message : "Transaction confirmation timed out.",
        });
        handleAppError(error, "SEND_MESSAGE");
        return;
      }

      // 5. Confirmed.
      applyTransition("CONFIRMED", { transactionHash, explorerUrl });
    } finally {
      runningRef.current = false;
    }
  }, [
    applyTransition,
    buildTransaction,
    requestWalletApproval,
    submitTransaction,
    verifyConfirmation,
    network,
  ]);

  const start = useCallback(async () => {
    machineRef.current = createTransactionStateMachine();
    syncSnapshot();
    await runFlow();
  }, [runFlow, syncSnapshot]);

  const retry = useCallback(async () => {
    const applied = applyTransition("RETRY");
    if (!applied) return;
    await runFlow();
  }, [applyTransition, runFlow]);

  const reset = useCallback(() => {
    machineRef.current = createTransactionStateMachine();
    syncSnapshot();
  }, [syncSnapshot]);

  // Integrate with realtime events so the UI updates immediately as states change.
  useWebSocketMessage(
    (realtimeEventType ?? "transaction_status_update") as any,
    (message: WebSocketMessage) => {
      const payload = message.payload ?? {};
      const eventState = payload.state as TransactionState | undefined;
      const txHash = payload.transactionHash as string | undefined;
      const error = payload.error as string | undefined;

      if (!eventState) return;

      switch (eventState) {
        case "submitted":
          if (txHash) {
            applyTransition("SUBMIT", {
              transactionHash: txHash,
              explorerUrl: getExplorerUrl(txHash, network),
            });
          }
          break;
        case "confirming":
          applyTransition("CONFIRMING");
          break;
        case "confirmed":
          applyTransition("CONFIRMED", {
            transactionHash: txHash,
            explorerUrl: txHash ? getExplorerUrl(txHash, network) : undefined,
          });
          break;
        case "failed":
          applyTransition("FAILED", { error });
          break;
        default:
          break;
      }
    },
  );

  return {
    snapshot,
    state: snapshot.state,
    context: snapshot.context,
    isTerminal: machineRef.current.isTerminal(),
    start,
    retry,
    reset,
  };
}
