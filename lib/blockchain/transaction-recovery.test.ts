import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TransactionRecoveryWorkflow,
  type RecoveryDeps,
  type TransactionLookupResult,
  type AccountLike,
} from "./transaction-recovery";
import {
  createLifecycleContext,
  type TransactionLifecycleContext,
} from "./transaction-lifecycle";

// ── Test helpers ─────────────────────────────────────────────────────────────

const TEST_PUBKEY = "GAAAAAAAACGC6QWAOGV2XDMQ6XGKPNUVKEKJW3XYKQFQBPJHYOA";

function makeAccount(seq: string): AccountLike {
  return {
    accountId: () => TEST_PUBKEY,
    sequenceNumber: () => seq,
  };
}

function makeDeps(overrides?: {
  getTransaction?: ReturnType<typeof vi.fn>;
  loadAccount?: ReturnType<typeof vi.fn>;
  submitTransaction?: ReturnType<typeof vi.fn>;
  sleep?: ReturnType<typeof vi.fn>;
}): RecoveryDeps {
  return {
    getTransaction:
      overrides?.getTransaction ?? vi.fn(async () => ({ found: false, hash: "abc" })),
    loadAccount:
      overrides?.loadAccount ?? vi.fn(async () => makeAccount("5000")),
    submitTransaction:
      overrides?.submitTransaction ?? vi.fn(async () => ({
        hash: "def",
        ledger: 42,
        successful: true,
      })),
    sleep: overrides?.sleep ?? vi.fn(async () => {}),
  };
}

function makeUnknownLifecycle(
  overrides?: Partial<TransactionLifecycleContext>,
): TransactionLifecycleContext {
  return {
    ...createLifecycleContext({ idempotent: true, maxRetries: 3 }),
    state: "unknown",
    transactionHash: "abc",
    errorMessage: "Timeout",
    errorCode: "TIMEOUT",
    ...overrides,
  };
}

// ── recoverUnknownTransaction — transaction found and successful ────────────

describe("TransactionRecoveryWorkflow — recoverUnknownTransaction", () => {
  it("confirms when transaction is found on network and successful (duplicate detection)", async () => {
    const getTransaction = vi.fn(async (): Promise<TransactionLookupResult> => ({
      found: true,
      hash: "abc",
      ledger: 54321,
      successful: true,
      memo: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const deps = makeDeps({ getTransaction });
    const recovery = new TransactionRecoveryWorkflow(deps);

    const result = await recovery.recoverUnknownTransaction(
      "abc",
      makeUnknownLifecycle(),
    );

    expect(result.outcome).toBe("confirmed");
    if (result.outcome === "confirmed") {
      expect(result.transactionHash).toBe("abc");
      expect(result.ledger).toBe(54321);
      expect(result.isDuplicate).toBe(true);
    }
  });

  it("returns failed when transaction is found but unsuccessful", async () => {
    const getTransaction = vi.fn(async (): Promise<TransactionLookupResult> => ({
      found: true,
      hash: "abc",
      ledger: 54321,
      successful: false,
      memo: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const deps = makeDeps({ getTransaction });
    const recovery = new TransactionRecoveryWorkflow(deps);

    const result = await recovery.recoverUnknownTransaction(
      "abc",
      makeUnknownLifecycle(),
    );

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.errorCode).toBe("TX_ON_CHAIN_FAILED");
    }
  });

  it("returns retry_eligible when tx not found and operation is idempotent", async () => {
    const getTransaction = vi.fn(async (): Promise<TransactionLookupResult> => ({
      found: false,
      hash: "abc",
    }));
    const deps = makeDeps({ getTransaction });
    const recovery = new TransactionRecoveryWorkflow(deps, {
      idempotent: true,
      maxPollAttempts: 2,
    });

    const result = await recovery.recoverUnknownTransaction(
      "abc",
      makeUnknownLifecycle({ idempotent: true }),
    );

    expect(result.outcome).toBe("retry_eligible");
    if (result.outcome === "retry_eligible") {
      expect(result.transactionHash).toBeNull();
    }
  });

  it("returns retry_blocked when tx not found and operation is non-idempotent", async () => {
    const getTransaction = vi.fn(async (): Promise<TransactionLookupResult> => ({
      found: false,
      hash: "abc",
    }));
    const deps = makeDeps({ getTransaction });
    const recovery = new TransactionRecoveryWorkflow(deps, {
      idempotent: false,
    });

    const result = await recovery.recoverUnknownTransaction(
      "abc",
      makeUnknownLifecycle({ idempotent: false }),
    );

    expect(result.outcome).toBe("retry_blocked");
    if (result.outcome === "retry_blocked") {
      expect(result.reason).toContain("non-idempotent");
    }
  });

  it("returns retry_blocked when max retries are exhausted", async () => {
    const getTransaction = vi.fn(async (): Promise<TransactionLookupResult> => ({
      found: false,
      hash: "abc",
    }));
    const deps = makeDeps({ getTransaction });
    const recovery = new TransactionRecoveryWorkflow(deps, {
      idempotent: true,
    });

    const result = await recovery.recoverUnknownTransaction(
      "abc",
      makeUnknownLifecycle({ idempotent: true, retryCount: 3, maxRetries: 3 }),
    );

    expect(result.outcome).toBe("retry_blocked");
  });
});

// ── recoverUnknownTransaction — polling with backoff ─────────────────────────

describe("TransactionRecoveryWorkflow — polling behavior", () => {
  it("polls multiple times before giving up", async () => {
    const getTransaction = vi
      .fn()
      .mockResolvedValueOnce({ found: false, hash: "abc" })
      .mockResolvedValueOnce({ found: false, hash: "abc" })
      .mockResolvedValueOnce({ found: false, hash: "abc" });

    const sleep = vi.fn(async () => {});
    const deps = makeDeps({ getTransaction, sleep });
    const recovery = new TransactionRecoveryWorkflow(deps, {
      maxPollAttempts: 3,
      pollBaseDelayMs: 10,
      idempotent: true,
    });

    const result = await recovery.recoverUnknownTransaction(
      "abc",
      makeUnknownLifecycle({ idempotent: true }),
    );

    expect(getTransaction).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // sleeps between attempts, not after last
    expect(result.outcome).toBe("retry_eligible");
  });

  it("stops polling as soon as transaction is found", async () => {
    const getTransaction = vi
      .fn()
      .mockResolvedValueOnce({ found: false, hash: "abc" })
      .mockResolvedValueOnce({
        found: true,
        hash: "abc",
        ledger: 100,
        successful: true,
        memo: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      });

    const deps = makeDeps({ getTransaction });
    const recovery = new TransactionRecoveryWorkflow(deps, {
      maxPollAttempts: 5,
      idempotent: true,
    });

    const result = await recovery.recoverUnknownTransaction(
      "abc",
      makeUnknownLifecycle({ idempotent: true }),
    );

    expect(getTransaction).toHaveBeenCalledTimes(2);
    expect(result.outcome).toBe("confirmed");
  });

  it("continues polling on transient lookup errors", async () => {
    const getTransaction = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection error"))
      .mockResolvedValueOnce({
        found: true,
        hash: "abc",
        ledger: 100,
        successful: true,
        memo: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      });

    const deps = makeDeps({ getTransaction });
    const recovery = new TransactionRecoveryWorkflow(deps, {
      maxPollAttempts: 3,
      idempotent: true,
    });

    const result = await recovery.recoverUnknownTransaction(
      "abc",
      makeUnknownLifecycle({ idempotent: true }),
    );

    expect(getTransaction).toHaveBeenCalledTimes(2);
    expect(result.outcome).toBe("confirmed");
  });
});

// ── safeRetry ───────────────────────────────────────────────────────────────

describe("TransactionRecoveryWorkflow — safeRetry", () => {
  it("rebuilds and resubmits when retry is eligible", async () => {
    const loadAccount = vi.fn(async () => makeAccount("5000"));
    const submitTransaction = vi.fn(async () => ({
      hash: "newhash",
      ledger: 60,
      fee_charged: "100",
      successful: true,
    }));

    const deps = makeDeps({ loadAccount, submitTransaction });
    const recovery = new TransactionRecoveryWorkflow(deps, { idempotent: true });

    const lifecycle = makeUnknownLifecycle({ idempotent: true, retryCount: 0 });

    // First recover to get to retry_eligible
    const recoverResult = await recovery.recoverUnknownTransaction("abc", lifecycle);
    expect(recoverResult.outcome).toBe("retry_eligible");

    if (recoverResult.outcome === "retry_eligible") {
      const retryResult = await recovery.safeRetry(
        TEST_PUBKEY,
        () => ({ hash: () => "newhash", sign: vi.fn() }),
        () => {},
        recoverResult.lifecycle,
      );

      expect(retryResult.outcome).toBe("confirmed");
      if (retryResult.outcome === "confirmed") {
        expect(retryResult.transactionHash).toBe("newhash");
        expect(retryResult.ledger).toBe(60);
        expect(retryResult.isDuplicate).toBe(false);
      }
    }
  });

  it("blocks retry when lifecycle is not retry-eligible", async () => {
    const deps = makeDeps();
    const recovery = new TransactionRecoveryWorkflow(deps);

    const lifecycle = makeUnknownLifecycle({
      idempotent: false,
      retryCount: 0,
    });

    const result = await recovery.safeRetry(
      TEST_PUBKEY,
      () => ({ hash: () => "newhash", sign: vi.fn() }),
      () => {},
      lifecycle,
    );

    expect(result.outcome).toBe("retry_blocked");
    if (result.outcome === "retry_blocked") {
      expect(result.reason).toContain("not retry-eligible");
    }
  });

  it("returns failed when account load fails during retry", async () => {
    const loadAccount = vi.fn(async () => {
      throw Object.assign(new Error("Not Found"), { response: { status: 404 } });
    });

    const deps = makeDeps({ loadAccount });
    const recovery = new TransactionRecoveryWorkflow(deps, { idempotent: true });

    const lifecycle = makeUnknownLifecycle({ idempotent: true, retryCount: 0 });

    // First recover to retry_eligible
    const recoverResult = await recovery.recoverUnknownTransaction("abc", lifecycle);
    if (recoverResult.outcome === "retry_eligible") {
      const retryResult = await recovery.safeRetry(
        TEST_PUBKEY,
        () => ({ hash: () => "newhash", sign: vi.fn() }),
        () => {},
        recoverResult.lifecycle,
      );

      expect(retryResult.outcome).toBe("failed");
      if (retryResult.outcome === "failed") {
        expect(retryResult.errorCode).toBe("ACCOUNT_LOAD_FAILED");
      }
    }
  });

  it("returns failed when submission fails with definitive error", async () => {
    const loadAccount = vi.fn(async () => makeAccount("5000"));
    const submitTransaction = vi.fn(async () => {
      throw Object.assign(new Error("op_underfunded"), {
        response: { status: 400 },
        extras: { result_codes: { transaction: "op_underfunded" } },
      });
    });

    const deps = makeDeps({ loadAccount, submitTransaction });
    const recovery = new TransactionRecoveryWorkflow(deps, { idempotent: true });

    const lifecycle = makeUnknownLifecycle({ idempotent: true, retryCount: 0 });

    const recoverResult = await recovery.recoverUnknownTransaction("abc", lifecycle);
    if (recoverResult.outcome === "retry_eligible") {
      const retryResult = await recovery.safeRetry(
        TEST_PUBKEY,
        () => ({ hash: () => "newhash", sign: vi.fn() }),
        () => {},
        recoverResult.lifecycle,
      );

      expect(retryResult.outcome).toBe("failed");
    }
  });

  it("returns unknown when retry submission has ambiguous outcome", async () => {
    const loadAccount = vi.fn(async () => makeAccount("5000"));
    const submitTransaction = vi.fn(async () => {
      throw new Error("Timeout talking to Horizon");
    });

    const deps = makeDeps({ loadAccount, submitTransaction });
    const recovery = new TransactionRecoveryWorkflow(deps, { idempotent: true });

    const lifecycle = makeUnknownLifecycle({ idempotent: true, retryCount: 0 });

    const recoverResult = await recovery.recoverUnknownTransaction("abc", lifecycle);
    if (recoverResult.outcome === "retry_eligible") {
      const retryResult = await recovery.safeRetry(
        TEST_PUBKEY,
        () => ({ hash: () => "newhash", sign: vi.fn() }),
        () => {},
        recoverResult.lifecycle,
      );

      expect(retryResult.outcome).toBe("unknown");
    }
  });
});

// ── Duplicate prevention ──────────────────────────────────────────────────────

describe("TransactionRecoveryWorkflow — duplicate prevention", () => {
  it("does NOT resubmit when transaction is found on-chain and successful", async () => {
    const getTransaction = vi.fn(async (): Promise<TransactionLookupResult> => ({
      found: true,
      hash: "abc",
      ledger: 54321,
      successful: true,
      memo: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const submitTransaction = vi.fn();
    const deps = makeDeps({ getTransaction, submitTransaction });
    const recovery = new TransactionRecoveryWorkflow(deps);

    const result = await recovery.recoverUnknownTransaction(
      "abc",
      makeUnknownLifecycle(),
    );

    expect(result.outcome).toBe("confirmed");
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("does NOT retry a non-idempotent operation even when tx is not found", async () => {
    const getTransaction = vi.fn(async (): Promise<TransactionLookupResult> => ({
      found: false,
      hash: "abc",
    }));
    const submitTransaction = vi.fn();
    const deps = makeDeps({ getTransaction, submitTransaction });
    const recovery = new TransactionRecoveryWorkflow(deps, { idempotent: false });

    const result = await recovery.recoverUnknownTransaction(
      "abc",
      makeUnknownLifecycle({ idempotent: false }),
    );

    expect(result.outcome).toBe("retry_blocked");
    expect(submitTransaction).not.toHaveBeenCalled();
  });
});

// ── Recovery after restart ───────────────────────────────────────────────────

describe("TransactionRecoveryWorkflow — recovery after restart", () => {
  it("recovers a deserialized lifecycle from a previous run", async () => {
    const getTransaction = vi.fn(async (): Promise<TransactionLookupResult> => ({
      found: true,
      hash: "abc",
      ledger: 54321,
      successful: true,
      memo: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const deps = makeDeps({ getTransaction });
    const recovery = new TransactionRecoveryWorkflow(deps);

    // Simulate a deserialized lifecycle from a persisted record after restart
    const deserialized = {
      id: "flow-123",
      state: "unknown" as const,
      transactionHash: "abc",
      ledger: null,
      feeCharged: null,
      errorMessage: "Timeout",
      errorCode: "TIMEOUT",
      idempotent: true,
      retryCount: 0,
      maxRetries: 3,
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      correlationId: "corr-123",
      operationLabel: "Payment",
    };

    const result = await recovery.recoverUnknownTransaction("abc", deserialized);

    expect(result.outcome).toBe("confirmed");
    if (result.outcome === "confirmed") {
      expect(result.isDuplicate).toBe(true);
    }
  });
});
