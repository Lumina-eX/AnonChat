import { describe, it, expect } from "vitest";
import {
  createTransactionContext,
  transactionReducer,
  applyAction,
  isValidTransition,
  isTerminalState,
  isActiveState,
  getStateProgress,
} from "@/lib/blockchain/transaction-state-machine";
import type {
  TransactionConfirmationContext,
  TransactionConfirmationState,
} from "@/types/blockchain";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(
  overrides: Partial<TransactionConfirmationContext> = {},
): TransactionConfirmationContext {
  return {
    ...createTransactionContext({ transactionType: "metadata_hash" }),
    ...overrides,
  };
}

// ── createTransactionContext ──────────────────────────────────────────────────

describe("createTransactionContext", () => {
  it("creates a context starting in 'preparing' state", () => {
    const ctx = createTransactionContext();
    expect(ctx.state).toBe("preparing");
    expect(ctx.retryCount).toBe(0);
    expect(ctx.retryable).toBe(false);
    expect(ctx.transactionHash).toBeNull();
    expect(ctx.ledger).toBeNull();
    expect(ctx.errorMessage).toBeNull();
  });

  it("passes through options correctly", () => {
    const ctx = createTransactionContext({
      groupId: "room-123",
      transactionType: "audit_event",
      operationLabel: "Audit Test",
      maxRetries: 5,
    });
    expect(ctx.groupId).toBe("room-123");
    expect(ctx.transactionType).toBe("audit_event");
    expect(ctx.operationLabel).toBe("Audit Test");
    expect(ctx.maxRetries).toBe(5);
  });
});

// ── isValidTransition ─────────────────────────────────────────────────────────

describe("isValidTransition", () => {
  it("allows the happy path: preparing → awaiting_wallet → submitted → confirming → confirmed", () => {
    expect(isValidTransition("preparing", "awaiting_wallet")).toBe(true);
    expect(isValidTransition("awaiting_wallet", "submitted")).toBe(true);
    expect(isValidTransition("submitted", "confirming")).toBe(true);
    expect(isValidTransition("confirming", "confirmed")).toBe(true);
  });

  it("allows transitions to failed from any active state", () => {
    const activeStates: TransactionConfirmationState[] = [
      "preparing",
      "awaiting_wallet",
      "submitted",
      "confirming",
    ];
    for (const state of activeStates) {
      expect(isValidTransition(state, "failed")).toBe(true);
    }
  });

  it("allows retry from failed to preparing", () => {
    expect(isValidTransition("failed", "preparing")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(isValidTransition("confirmed", "preparing")).toBe(false);
    expect(isValidTransition("confirmed", "failed")).toBe(false);
    expect(isValidTransition("preparing", "confirmed")).toBe(false);
    expect(isValidTransition("submitted", "awaiting_wallet")).toBe(false);
  });
});

// ── transactionReducer — happy path ──────────────────────────────────────────

describe("transactionReducer — happy path", () => {
  it("transitions through the full confirmation flow", () => {
    let ctx = createTransactionContext();

    ctx = transactionReducer(ctx, { type: "AWAIT_WALLET" });
    expect(ctx.state).toBe("awaiting_wallet");

    ctx = transactionReducer(ctx, {
      type: "SUBMIT",
      transactionHash: "abc123",
      feeCharged: "100",
      explorerUrl: "https://stellar.expert/tx/abc123",
    });
    expect(ctx.state).toBe("submitted");
    expect(ctx.transactionHash).toBe("abc123");
    expect(ctx.feeCharged).toBe("100");
    expect(ctx.explorerUrl).toBe("https://stellar.expert/tx/abc123");

    ctx = transactionReducer(ctx, { type: "START_CONFIRMING" });
    expect(ctx.state).toBe("confirming");

    ctx = transactionReducer(ctx, { type: "CONFIRM", ledger: 54321 });
    expect(ctx.state).toBe("confirmed");
    expect(ctx.ledger).toBe(54321);
  });

  it("clears errorMessage when transitioning out of failed", () => {
    let ctx = makeContext({ state: "preparing" });
    ctx = transactionReducer(ctx, { type: "FAIL", errorMessage: "Network error" });
    expect(ctx.errorMessage).toBe("Network error");

    ctx = transactionReducer(ctx, { type: "RETRY" });
    expect(ctx.state).toBe("preparing");
    expect(ctx.errorMessage).toBeNull();
    expect(ctx.retryCount).toBe(1);
  });

  it("RESET returns to a fresh preparing state", () => {
    let ctx = makeContext({ state: "confirmed", transactionHash: "xyz", ledger: 100 });
    ctx = transactionReducer(ctx, { type: "RESET" });
    expect(ctx.state).toBe("preparing");
    expect(ctx.transactionHash).toBeNull();
    expect(ctx.ledger).toBeNull();
    expect(ctx.retryCount).toBe(0);
  });
});

// ── transactionReducer — failure & retry ─────────────────────────────────────

describe("transactionReducer — failure and retry", () => {
  it("marks the transaction as failed from any active state", () => {
    const activeStates: TransactionConfirmationState[] = [
      "preparing",
      "awaiting_wallet",
      "submitted",
      "confirming",
    ];
    for (const state of activeStates) {
      let ctx = makeContext({ state, retryCount: 0, maxRetries: 3 });
      ctx = transactionReducer(ctx, { type: "FAIL", errorMessage: "Oops" });
      expect(ctx.state).toBe("failed");
      expect(ctx.errorMessage).toBe("Oops");
      expect(ctx.retryable).toBe(true);
    }
  });

  it("marks as non-retryable when retryable=false is passed", () => {
    let ctx = makeContext({ state: "preparing" });
    ctx = transactionReducer(ctx, { type: "FAIL", errorMessage: "Bad sig", retryable: false });
    expect(ctx.retryable).toBe(false);
  });

  it("marks as non-retryable when max retries are exhausted", () => {
    let ctx = makeContext({ state: "preparing", retryCount: 3, maxRetries: 3 });
    ctx = transactionReducer(ctx, { type: "FAIL", errorMessage: "Timeout" });
    expect(ctx.retryable).toBe(false);
  });

  it("increments retryCount on RETRY", () => {
    let ctx = makeContext({ state: "preparing" });
    ctx = transactionReducer(ctx, { type: "FAIL", errorMessage: "err" });
    expect(ctx.retryCount).toBe(0);
    ctx = transactionReducer(ctx, { type: "RETRY" });
    expect(ctx.retryCount).toBe(1);
    expect(ctx.state).toBe("preparing");
  });

  it("throws when attempting RETRY from non-failed state", () => {
    const ctx = makeContext({ state: "preparing" });
    expect(() => transactionReducer(ctx, { type: "RETRY" })).toThrow();
  });

  it("throws when attempting RETRY but not retryable", () => {
    const ctx = makeContext({ state: "failed", retryable: false });
    expect(() => transactionReducer(ctx, { type: "RETRY" })).toThrow();
  });
});

// ── transactionReducer — invalid transitions throw ───────────────────────────

describe("transactionReducer — invalid transitions throw", () => {
  it("throws when SUBMIT is called before AWAIT_WALLET", () => {
    const ctx = makeContext({ state: "preparing" });
    expect(() =>
      transactionReducer(ctx, { type: "SUBMIT", transactionHash: "hash" }),
    ).toThrow();
  });

  it("throws when START_CONFIRMING is called from preparing", () => {
    const ctx = makeContext({ state: "preparing" });
    expect(() => transactionReducer(ctx, { type: "START_CONFIRMING" })).toThrow();
  });

  it("throws when CONFIRM is called from submitted (must go through confirming)", () => {
    const ctx = makeContext({ state: "submitted" });
    expect(() => transactionReducer(ctx, { type: "CONFIRM", ledger: 1 })).toThrow();
  });

  it("throws when FAIL is called from confirmed", () => {
    const ctx = makeContext({ state: "confirmed" });
    expect(() =>
      transactionReducer(ctx, { type: "FAIL", errorMessage: "too late" }),
    ).toThrow();
  });
});

// ── applyAction (non-throwing wrapper) ───────────────────────────────────────

describe("applyAction", () => {
  it("returns updated context for valid transition", () => {
    const ctx = makeContext({ state: "preparing" });
    const { context: next, error } = applyAction(ctx, { type: "AWAIT_WALLET" });
    expect(next.state).toBe("awaiting_wallet");
    expect(error).toBeUndefined();
  });

  it("returns original context and an error message for invalid transition", () => {
    const ctx = makeContext({ state: "preparing" });
    const { context: next, error } = applyAction(ctx, {
      type: "SUBMIT",
      transactionHash: "hash",
    });
    expect(next.state).toBe("preparing"); // unchanged
    expect(error).toBeDefined();
    expect(typeof error).toBe("string");
  });
});

// ── Helper functions ──────────────────────────────────────────────────────────

describe("isTerminalState", () => {
  it("returns true for confirmed and failed", () => {
    expect(isTerminalState("confirmed")).toBe(true);
    expect(isTerminalState("failed")).toBe(true);
  });

  it("returns false for active states", () => {
    const active: TransactionConfirmationState[] = [
      "preparing",
      "awaiting_wallet",
      "submitted",
      "confirming",
    ];
    for (const s of active) {
      expect(isTerminalState(s)).toBe(false);
    }
  });
});

describe("isActiveState", () => {
  it("returns true for all intermediate states", () => {
    expect(isActiveState("preparing")).toBe(true);
    expect(isActiveState("awaiting_wallet")).toBe(true);
    expect(isActiveState("submitted")).toBe(true);
    expect(isActiveState("confirming")).toBe(true);
  });

  it("returns false for terminal states", () => {
    expect(isActiveState("confirmed")).toBe(false);
    expect(isActiveState("failed")).toBe(false);
  });
});

describe("getStateProgress", () => {
  it("returns increasing values through the happy path", () => {
    const preparing = getStateProgress("preparing");
    const awaiting = getStateProgress("awaiting_wallet");
    const submitted = getStateProgress("submitted");
    const confirming = getStateProgress("confirming");
    const confirmed = getStateProgress("confirmed");

    expect(preparing).toBeLessThan(awaiting);
    expect(awaiting).toBeLessThan(submitted);
    expect(submitted).toBeLessThan(confirming);
    expect(confirming).toBeLessThan(confirmed);
    expect(confirmed).toBe(100);
  });

  it("returns 0 for failed state", () => {
    expect(getStateProgress("failed")).toBe(0);
  });
});
