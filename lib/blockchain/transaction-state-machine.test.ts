import { describe, it, expect } from "vitest";
import {
  createTransactionStateMachine,
  TERMINAL_STATES,
  TRANSACTION_STATE_LABELS,
  TRANSACTION_STATE_TONES,
} from "./transaction-state-machine";

describe("createTransactionStateMachine", () => {
  it("starts in the preparing state by default", () => {
    const machine = createTransactionStateMachine();
    expect(machine.getState()).toBe("preparing");
    expect(machine.isTerminal()).toBe(false);
  });

  it("accepts a custom initial state", () => {
    const machine = createTransactionStateMachine("failed");
    expect(machine.getState()).toBe("failed");
    expect(machine.isTerminal()).toBe(true);
  });

  it("transitions preparing → awaiting_wallet_approval", () => {
    const machine = createTransactionStateMachine();
    expect(machine.transition("REQUEST_WALLET_APPROVAL")).toBe(true);
    expect(machine.getState()).toBe("awaiting_wallet_approval");
  });

  it("transitions awaiting_wallet_approval → submitted on approval", () => {
    const machine = createTransactionStateMachine("awaiting_wallet_approval");
    expect(machine.transition("WALLET_APPROVED")).toBe(true);
    expect(machine.getState()).toBe("submitted");
  });

  it("transitions awaiting_wallet_approval → failed on rejection", () => {
    const machine = createTransactionStateMachine("awaiting_wallet_approval");
    expect(machine.transition("WALLET_REJECTED")).toBe(true);
    expect(machine.getState()).toBe("failed");
  });

  it("exposes the transaction hash after submission", () => {
    const machine = createTransactionStateMachine("submitted");
    machine.transition("SUBMIT", {
      transactionHash: "abc123",
      explorerUrl: "https://stellar.expert/explorer/testnet/tx/abc123",
    });
    expect(machine.getContext().transactionHash).toBe("abc123");
    expect(machine.getContext().explorerUrl).toContain("abc123");
  });

  it("transitions submitted → confirming → confirmed", () => {
    const machine = createTransactionStateMachine("submitted");
    expect(machine.transition("CONFIRMING")).toBe(true);
    expect(machine.getState()).toBe("confirming");
    expect(machine.transition("CONFIRMED")).toBe(true);
    expect(machine.getState()).toBe("confirmed");
    expect(machine.isTerminal()).toBe(true);
  });

  it("transitions confirming → failed on confirmation error", () => {
    const machine = createTransactionStateMachine("confirming");
    expect(
      machine.transition("CONFIRMATION_ERROR", { error: "Ledger timeout" }),
    ).toBe(true);
    expect(machine.getState()).toBe("failed");
    expect(machine.getContext().error).toBe("Ledger timeout");
  });

  it("allows retry from failed state and increments retry count", () => {
    const machine = createTransactionStateMachine("failed");
    expect(machine.transition("RETRY")).toBe(true);
    expect(machine.getState()).toBe("preparing");
    expect(machine.getContext().retryCount).toBe(1);
    expect(machine.getContext().error).toBeUndefined();
  });

  it("rejects invalid transitions", () => {
    const machine = createTransactionStateMachine("preparing");
    expect(machine.transition("CONFIRMED")).toBe(false);
    expect(machine.getState()).toBe("preparing");
  });

  it("rejects transitions from terminal states", () => {
    const machine = createTransactionStateMachine("confirmed");
    expect(machine.transition("RETRY")).toBe(false);
    expect(machine.getState()).toBe("confirmed");
  });

  it("returns a snapshot with state and context", () => {
    const machine = createTransactionStateMachine("submitted");
    machine.transition("SUBMIT", { transactionHash: "tx1" });
    const snapshot = machine.getSnapshot();
    expect(snapshot.state).toBe("submitted");
    expect(snapshot.context.transactionHash).toBe("tx1");
  });

  it("defines labels and tones for every state", () => {
    const states = [
      "preparing",
      "awaiting_wallet_approval",
      "submitted",
      "confirming",
      "confirmed",
      "failed",
    ] as const;

    for (const state of states) {
      expect(TRANSACTION_STATE_LABELS[state]).toBeTruthy();
      expect(TRANSACTION_STATE_TONES[state]).toBeTruthy();
    }
  });

  it("marks confirmed and failed as terminal", () => {
    expect(TERMINAL_STATES.has("confirmed")).toBe(true);
    expect(TERMINAL_STATES.has("failed")).toBe(true);
    expect(TERMINAL_STATES.has("preparing")).toBe(false);
  });
});
