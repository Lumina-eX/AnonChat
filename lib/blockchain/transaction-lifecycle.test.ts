import { describe, it, expect } from "vitest";
import {
  createLifecycleContext,
  lifecycleReducer,
  applyLifecycleAction,
  isValidLifecycleTransition,
  isTerminalLifecycleState,
  isAmbiguousState,
  hasBeenSubmitted,
  isRetrySafe,
  serializeLifecycle,
  deserializeLifecycle,
  type TransactionLifecycleContext,
  type TransactionLifecycleState,
} from "./transaction-lifecycle";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(
  overrides: Partial<TransactionLifecycleContext> = {},
): TransactionLifecycleContext {
  return {
    ...createLifecycleContext({ idempotent: false, maxRetries: 3 }),
    ...overrides,
  };
}

// ── createLifecycleContext ──────────────────────────────────────────────────

describe("createLifecycleContext", () => {
  it("creates a context starting in pending_submission state", () => {
    const ctx = createLifecycleContext();
    expect(ctx.state).toBe("pending_submission");
    expect(ctx.transactionHash).toBeNull();
    expect(ctx.ledger).toBeNull();
    expect(ctx.errorMessage).toBeNull();
    expect(ctx.retryCount).toBe(0);
  });

  it("passes through options correctly", () => {
    const ctx = createLifecycleContext({
      idempotent: true,
      maxRetries: 5,
      operationLabel: "Payment",
    });
    expect(ctx.idempotent).toBe(true);
    expect(ctx.maxRetries).toBe(5);
    expect(ctx.operationLabel).toBe("Payment");
  });

  it("generates a unique id", () => {
    const ctx1 = createLifecycleContext();
    const ctx2 = createLifecycleContext();
    expect(ctx1.id).not.toBe(ctx2.id);
  });
});

// ── isValidLifecycleTransition ──────────────────────────────────────────────

describe("isValidLifecycleTransition", () => {
  it("allows the happy path: pending_submission → submitted → confirmed", () => {
    expect(isValidLifecycleTransition("pending_submission", "submitted")).toBe(true);
    expect(isValidLifecycleTransition("submitted", "confirmed")).toBe(true);
  });

  it("allows transitions to failed from pending_submission and submitted", () => {
    expect(isValidLifecycleTransition("pending_submission", "failed")).toBe(true);
    expect(isValidLifecycleTransition("submitted", "failed")).toBe(true);
  });

  it("allows transition to unknown from submitted", () => {
    expect(isValidLifecycleTransition("submitted", "unknown")).toBe(true);
  });

  it("allows transitions from unknown to confirmed, failed, retry_eligible, retry_blocked", () => {
    expect(isValidLifecycleTransition("unknown", "confirmed")).toBe(true);
    expect(isValidLifecycleTransition("unknown", "failed")).toBe(true);
    expect(isValidLifecycleTransition("unknown", "retry_eligible")).toBe(true);
    expect(isValidLifecycleTransition("unknown", "retry_blocked")).toBe(true);
  });

  it("allows retry from retry_eligible to pending_submission", () => {
    expect(isValidLifecycleTransition("retry_eligible", "pending_submission")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(isValidLifecycleTransition("confirmed", "submitted")).toBe(false);
    expect(isValidLifecycleTransition("confirmed", "failed")).toBe(false);
    expect(isValidLifecycleTransition("pending_submission", "confirmed")).toBe(false);
    expect(isValidLifecycleTransition("retry_blocked", "pending_submission")).toBe(false);
    expect(isValidLifecycleTransition("submitted", "pending_submission")).toBe(false);
  });
});

// ── lifecycleReducer — happy path ───────────────────────────────────────────

describe("lifecycleReducer — happy path", () => {
  it("transitions through the full success flow", () => {
    let ctx = createLifecycleContext();

    ctx = lifecycleReducer(ctx, {
      type: "MARK_SUBMITTED",
      transactionHash: "abc123",
      feeCharged: "100",
    });
    expect(ctx.state).toBe("submitted");
    expect(ctx.transactionHash).toBe("abc123");
    expect(ctx.feeCharged).toBe("100");

    ctx = lifecycleReducer(ctx, { type: "MARK_CONFIRMED", ledger: 54321 });
    expect(ctx.state).toBe("confirmed");
    expect(ctx.ledger).toBe(54321);
    expect(ctx.errorMessage).toBeNull();
  });

  it("transitions to failed from pending_submission", () => {
    let ctx = createLifecycleContext();
    ctx = lifecycleReducer(ctx, {
      type: "MARK_FAILED",
      errorMessage: "Insufficient fee",
      errorCode: "tx_insufficient_fee",
    });
    expect(ctx.state).toBe("failed");
    expect(ctx.errorMessage).toBe("Insufficient fee");
    expect(ctx.errorCode).toBe("tx_insufficient_fee");
  });

  it("transitions to unknown from submitted", () => {
    let ctx = createLifecycleContext();
    ctx = lifecycleReducer(ctx, { type: "MARK_SUBMITTED", transactionHash: "hash" });
    ctx = lifecycleReducer(ctx, {
      type: "MARK_UNKNOWN",
      errorMessage: "Timeout",
      errorCode: "TIMEOUT",
    });
    expect(ctx.state).toBe("unknown");
    expect(ctx.errorMessage).toBe("Timeout");
    expect(ctx.errorCode).toBe("TIMEOUT");
  });
});

// ── lifecycleReducer — retry evaluation ──────────────────────────────────────

describe("lifecycleReducer — EVALUATE_RETRY", () => {
  it("transitions to retry_eligible when retry is safe (idempotent, retries remain)", () => {
    let ctx = makeContext({
      state: "failed",
      idempotent: true,
      retryCount: 0,
      maxRetries: 3,
    });
    ctx = lifecycleReducer(ctx, { type: "EVALUATE_RETRY" });
    expect(ctx.state).toBe("retry_eligible");
  });

  it("transitions to retry_blocked when max retries exhausted", () => {
    let ctx = makeContext({
      state: "failed",
      idempotent: true,
      retryCount: 3,
      maxRetries: 3,
    });
    ctx = lifecycleReducer(ctx, { type: "EVALUATE_RETRY" });
    expect(ctx.state).toBe("retry_blocked");
  });

  it("transitions to retry_blocked for unknown non-idempotent operations", () => {
    let ctx = makeContext({
      state: "unknown",
      idempotent: false,
      retryCount: 0,
      maxRetries: 3,
    });
    ctx = lifecycleReducer(ctx, { type: "EVALUATE_RETRY" });
    expect(ctx.state).toBe("retry_blocked");
  });

  it("transitions to retry_eligible for unknown idempotent operations", () => {
    let ctx = makeContext({
      state: "unknown",
      idempotent: true,
      retryCount: 0,
      maxRetries: 3,
    });
    ctx = lifecycleReducer(ctx, { type: "EVALUATE_RETRY" });
    expect(ctx.state).toBe("retry_eligible");
  });
});

// ── lifecycleReducer — BEGIN_RETRY ───────────────────────────────────────────

describe("lifecycleReducer — BEGIN_RETRY", () => {
  it("transitions to pending_submission and increments retryCount", () => {
    let ctx = makeContext({
      state: "retry_eligible",
      retryCount: 0,
      transactionHash: "old-hash",
    });
    ctx = lifecycleReducer(ctx, { type: "BEGIN_RETRY" });
    expect(ctx.state).toBe("pending_submission");
    expect(ctx.retryCount).toBe(1);
    expect(ctx.transactionHash).toBeNull();
    expect(ctx.ledger).toBeNull();
    expect(ctx.errorMessage).toBeNull();
    expect(ctx.errorCode).toBeNull();
  });
});

// ── lifecycleReducer — RESET ─────────────────────────────────────────────────

describe("lifecycleReducer — RESET", () => {
  it("returns to a fresh pending_submission state preserving config", () => {
    let ctx = makeContext({
      state: "confirmed",
      transactionHash: "xyz",
      ledger: 100,
      idempotent: true,
      maxRetries: 5,
    });
    ctx = lifecycleReducer(ctx, { type: "RESET" });
    expect(ctx.state).toBe("pending_submission");
    expect(ctx.transactionHash).toBeNull();
    expect(ctx.ledger).toBeNull();
    expect(ctx.idempotent).toBe(true);
    expect(ctx.maxRetries).toBe(5);
    expect(ctx.retryCount).toBe(0);
  });
});

// ── lifecycleReducer — invalid transitions throw ────────────────────────────

describe("lifecycleReducer — invalid transitions throw", () => {
  it("throws when MARK_CONFIRMED is called from pending_submission", () => {
    const ctx = makeContext({ state: "pending_submission" });
    expect(() =>
      lifecycleReducer(ctx, { type: "MARK_CONFIRMED", ledger: 1 }),
    ).toThrow();
  });

  it("throws when BEGIN_RETRY is called from non-retry_eligible state", () => {
    const ctx = makeContext({ state: "submitted" });
    expect(() => lifecycleReducer(ctx, { type: "BEGIN_RETRY" })).toThrow();
  });

  it("throws when MARK_FAILED is called from confirmed", () => {
    const ctx = makeContext({ state: "confirmed" });
    expect(() =>
      lifecycleReducer(ctx, { type: "MARK_FAILED", errorMessage: "too late" }),
    ).toThrow();
  });
});

// ── applyLifecycleAction (non-throwing wrapper) ─────────────────────────────

describe("applyLifecycleAction", () => {
  it("returns updated context for valid transition", () => {
    const ctx = makeContext({ state: "pending_submission" });
    const { context: next, error } = applyLifecycleAction(ctx, {
      type: "MARK_SUBMITTED",
      transactionHash: "hash",
    });
    expect(next.state).toBe("submitted");
    expect(error).toBeUndefined();
  });

  it("returns original context and error for invalid transition", () => {
    const ctx = makeContext({ state: "confirmed" });
    const { context: next, error } = applyLifecycleAction(ctx, {
      type: "MARK_SUBMITTED",
      transactionHash: "hash",
    });
    expect(next.state).toBe("confirmed");
    expect(error).toBeDefined();
  });
});

// ── State predicates ─────────────────────────────────────────────────────────

describe("isTerminalLifecycleState", () => {
  it("returns true for confirmed and failed", () => {
    expect(isTerminalLifecycleState("confirmed")).toBe(true);
    expect(isTerminalLifecycleState("failed")).toBe(true);
  });

  it("returns false for non-terminal states", () => {
    expect(isTerminalLifecycleState("pending_submission")).toBe(false);
    expect(isTerminalLifecycleState("submitted")).toBe(false);
    expect(isTerminalLifecycleState("unknown")).toBe(false);
    expect(isTerminalLifecycleState("retry_eligible")).toBe(false);
    expect(isTerminalLifecycleState("retry_blocked")).toBe(false);
  });
});

describe("isAmbiguousState", () => {
  it("returns true for unknown", () => {
    expect(isAmbiguousState("unknown")).toBe(true);
  });

  it("returns false for all other states", () => {
    expect(isAmbiguousState("confirmed")).toBe(false);
    expect(isAmbiguousState("failed")).toBe(false);
    expect(isAmbiguousState("submitted")).toBe(false);
  });
});

describe("hasBeenSubmitted", () => {
  it("returns true when transactionHash is set", () => {
    const ctx = makeContext({ state: "submitted", transactionHash: "abc" });
    expect(hasBeenSubmitted(ctx)).toBe(true);
  });

  it("returns false when transactionHash is null", () => {
    const ctx = makeContext({ state: "pending_submission" });
    expect(hasBeenSubmitted(ctx)).toBe(false);
  });
});

// ── isRetrySafe ──────────────────────────────────────────────────────────────

describe("isRetrySafe", () => {
  it("returns true for failed idempotent operations with retries remaining", () => {
    const ctx = makeContext({
      state: "failed",
      idempotent: true,
      retryCount: 0,
      maxRetries: 3,
    });
    expect(isRetrySafe(ctx)).toBe(true);
  });

  it("returns false when max retries are exhausted", () => {
    const ctx = makeContext({
      state: "failed",
      idempotent: true,
      retryCount: 3,
      maxRetries: 3,
    });
    expect(isRetrySafe(ctx)).toBe(false);
  });

  it("returns false for unknown non-idempotent operations", () => {
    const ctx = makeContext({
      state: "unknown",
      idempotent: false,
      retryCount: 0,
      maxRetries: 3,
    });
    expect(isRetrySafe(ctx)).toBe(false);
  });

  it("returns true for unknown idempotent operations", () => {
    const ctx = makeContext({
      state: "unknown",
      idempotent: true,
      retryCount: 0,
      maxRetries: 3,
    });
    expect(isRetrySafe(ctx)).toBe(true);
  });

  it("returns false for non-retryable states (submitted, confirmed, pending_submission)", () => {
    expect(isRetrySafe(makeContext({ state: "submitted" }))).toBe(false);
    expect(isRetrySafe(makeContext({ state: "confirmed" }))).toBe(false);
    expect(isRetrySafe(makeContext({ state: "pending_submission" }))).toBe(false);
  });
});

// ── serialize / deserialize ──────────────────────────────────────────────────

describe("serializeLifecycle / deserializeLifecycle", () => {
  it("round-trips a context through serialization", () => {
    const ctx = makeContext({
      state: "submitted",
      transactionHash: "abc123",
      feeCharged: "100",
      ledger: 42,
      idempotent: true,
      retryCount: 1,
      maxRetries: 5,
    });

    const serialized = serializeLifecycle(ctx);
    const deserialized = deserializeLifecycle(serialized);

    expect(deserialized.state).toBe(ctx.state);
    expect(deserialized.transactionHash).toBe(ctx.transactionHash);
    expect(deserialized.ledger).toBe(ctx.ledger);
    expect(deserialized.feeCharged).toBe(ctx.feeCharged);
    expect(deserialized.idempotent).toBe(ctx.idempotent);
    expect(deserialized.retryCount).toBe(ctx.retryCount);
    expect(deserialized.maxRetries).toBe(ctx.maxRetries);
    expect(deserialized.id).toBe(ctx.id);
  });

  it("deserializeLifecycle throws on unknown state", () => {
    expect(() => deserializeLifecycle({ state: "invalid_state" })).toThrow(
      "Unknown lifecycle state",
    );
  });

  it("deserializeLifecycle applies defaults for missing fields", () => {
    const result = deserializeLifecycle({ state: "pending_submission", id: "test-id" });
    expect(result.transactionHash).toBeNull();
    expect(result.retryCount).toBe(0);
    expect(result.maxRetries).toBe(3);
  });

  it("supports recovery after restart by deserializing persisted state", () => {
    // Simulate a process restart: state was persisted as "unknown"
    const persisted = {
      id: "flow-123",
      state: "unknown",
      transactionHash: "aabbcc",
      ledger: null,
      feeCharged: null,
      errorMessage: "Timeout",
      errorCode: "TIMEOUT",
      idempotent: true,
      retryCount: 1,
      maxRetries: 3,
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      correlationId: "corr-123",
      operationLabel: "Payment",
    };

    const restored = deserializeLifecycle(persisted);
    expect(restored.state).toBe("unknown");
    expect(restored.transactionHash).toBe("aabbcc");
    expect(restored.idempotent).toBe(true);

    // After restore, we can evaluate retry eligibility
    const { context: evaluated } = applyLifecycleAction(restored, { type: "EVALUATE_RETRY" });
    expect(evaluated.state).toBe("retry_eligible");
  });
});
