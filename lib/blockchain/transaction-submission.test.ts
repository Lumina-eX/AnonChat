import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TransactionSubmissionService,
  classifySubmissionError,
  type SubmissionServiceDeps,
  type TransactionLike,
  type AccountLike,
  type HorizonSubmitResponse,
} from "./transaction-submission";

// ── Test helpers ─────────────────────────────────────────────────────────────

const TEST_PUBKEY = "GAAAAAAAACGC6QWAOGV2XDMQ6XGKPNUVKEKJW3XYKQFQBPJHYOA";

function makeAccount(seq: string): AccountLike {
  return {
    accountId: () => TEST_PUBKEY,
    sequenceNumber: () => seq,
  };
}

function makeTx(hash?: string): TransactionLike {
  const _hash = hash ?? "a".repeat(64);
  return {
    hash: () => _hash,
    sign: vi.fn(),
  };
}

function makeSuccessResponse(hash: string, ledger: number): HorizonSubmitResponse {
  return {
    hash,
    ledger,
    fee_charged: "100",
    successful: true,
  };
}

function makeDeps(overrides?: {
  loadAccount?: ReturnType<typeof vi.fn>;
  submitTransaction?: ReturnType<typeof vi.fn>;
  sleep?: ReturnType<typeof vi.fn>;
}): SubmissionServiceDeps {
  return {
    loadAccount: overrides?.loadAccount ?? vi.fn(async () => makeAccount("1000")),
    submitTransaction:
      overrides?.submitTransaction ?? vi.fn(async () => makeSuccessResponse("a".repeat(64), 42)),
    sleep: overrides?.sleep ?? vi.fn(async () => {}),
  };
}

// ── classifySubmissionError ─────────────────────────────────────────────────

describe("classifySubmissionError", () => {
  it("classifies 4xx as failed (definitive rejection)", () => {
    const error = Object.assign(new Error("Transaction rejected"), {
      response: { status: 400 },
    });
    const result = classifySubmissionError(error);
    expect(result.outcome).toBe("failed");
  });

  it("classifies errors with result codes as failed", () => {
    const error = {
      message: "Transaction failed",
      extras: {
        result_codes: { transaction: "tx_bad_seq", operations: ["op_underfunded"] },
      },
    };
    const result = classifySubmissionError(error);
    expect(result.outcome).toBe("failed");
    expect(result.errorCode).toBe("tx_bad_seq");
  });

  it("classifies timeouts as unknown (ambiguous)", () => {
    const error = new Error("Timeout talking to Horizon");
    const result = classifySubmissionError(error);
    expect(result.outcome).toBe("unknown");
  });

  it("classifies 5xx as unknown (ambiguous)", () => {
    const error = Object.assign(new Error("Server error"), {
      response: { status: 503 },
    });
    const result = classifySubmissionError(error);
    expect(result.outcome).toBe("unknown");
  });

  it("classifies connection errors as unknown", () => {
    const error = new Error("ECONNRESET socket hang up");
    const result = classifySubmissionError(error);
    expect(result.outcome).toBe("unknown");
  });

  it("defaults to unknown for unrecognized errors (safe default)", () => {
    const error = new Error("Something unexpected happened");
    const result = classifySubmissionError(error);
    expect(result.outcome).toBe("unknown");
  });
});

// ── prepareTransaction ──────────────────────────────────────────────────────

describe("TransactionSubmissionService — prepareTransaction", () => {
  it("loads the latest account and builds the transaction", async () => {
    const loadAccount = vi.fn(async () => makeAccount("5000"));
    const deps = makeDeps({ loadAccount });
    const service = new TransactionSubmissionService(deps);

    const tx = makeTx();
    const buildFn = vi.fn(() => tx);

    const result = await service.prepareTransaction(TEST_PUBKEY, buildFn, "corr-1");

    expect(loadAccount).toHaveBeenCalledTimes(1);
    expect(buildFn).toHaveBeenCalledTimes(1);
    expect(result.transaction).toBe(tx);
    expect(result.sequence).toBe("5000");
  });

  it("supports async builder functions", async () => {
    const deps = makeDeps();
    const service = new TransactionSubmissionService(deps);

    const tx = makeTx();
    const buildFn = vi.fn(async () => tx);

    const result = await service.prepareTransaction(TEST_PUBKEY, buildFn);

    expect(result.transaction).toBe(tx);
    expect(buildFn).toHaveBeenCalledTimes(1);
  });

  it("propagates account load errors", async () => {
    const loadAccount = vi.fn(async () => {
      throw Object.assign(new Error("Not Found"), { response: { status: 404 } });
    });
    const deps = makeDeps({ loadAccount });
    const service = new TransactionSubmissionService(deps);

    await expect(
      service.prepareTransaction(TEST_PUBKEY, vi.fn(() => makeTx())),
    ).rejects.toThrow();
  });
});

// ── submitTransaction — success ──────────────────────────────────────────────

describe("TransactionSubmissionService — submitTransaction (success)", () => {
  it("returns confirmed when transaction is successful", async () => {
    const submitTransaction = vi.fn(async () =>
      makeSuccessResponse("abc123", 54321),
    );
    const deps = makeDeps({ submitTransaction });
    const service = new TransactionSubmissionService(deps);

    const tx = makeTx("abc123");
    const lifecycle = createLifecycleContextHelper();

    const result = await service.submitTransaction(tx, lifecycle, "corr-1");

    expect(result.outcome).toBe("confirmed");
    if (result.outcome === "confirmed") {
      expect(result.transactionHash).toBe("abc123");
      expect(result.ledger).toBe(54321);
      expect(result.feeCharged).toBe("100");
    }
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });
});

// ── submitTransaction — failed ──────────────────────────────────────────────

describe("TransactionSubmissionService — submitTransaction (failed)", () => {
  it("returns failed when successful=false in response", async () => {
    const submitTransaction = vi.fn(async () => ({
      hash: "abc123",
      ledger: 54321,
      fee_charged: "100",
      successful: false,
    }));
    const deps = makeDeps({ submitTransaction });
    const service = new TransactionSubmissionService(deps);

    const tx = makeTx("abc123");
    const lifecycle = createLifecycleContextHelper();

    const result = await service.submitTransaction(tx, lifecycle);

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.transactionHash).toBe("abc123");
      expect(result.errorCode).toBe("TX_OPERATIONS_FAILED");
    }
  });

  it("returns failed on 4xx rejection with result codes", async () => {
    const submitTransaction = vi.fn(async () => {
      throw Object.assign(new Error("Transaction rejected"), {
        response: { status: 400 },
        extras: {
          result_codes: { transaction: "tx_bad_seq", operations: [] },
        },
      });
    });
    const deps = makeDeps({ submitTransaction });
    const service = new TransactionSubmissionService(deps);

    const tx = makeTx("abc123");
    const lifecycle = createLifecycleContextHelper();

    const result = await service.submitTransaction(tx, lifecycle);

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.errorCode).toContain("tx_bad_seq");
    }
  });
});

// ── submitTransaction — unknown (ambiguous) ───────────────────────────────────

describe("TransactionSubmissionService — submitTransaction (unknown/ambiguous)", () => {
  it("returns unknown on timeout", async () => {
    const submitTransaction = vi.fn(async () => {
      throw new Error("Timeout talking to Horizon");
    });
    const deps = makeDeps({ submitTransaction });
    const service = new TransactionSubmissionService(deps);

    const tx = makeTx("abc123");
    const lifecycle = createLifecycleContextHelper();

    const result = await service.submitTransaction(tx, lifecycle);

    expect(result.outcome).toBe("unknown");
    if (result.outcome === "unknown") {
      expect(result.transactionHash).toBe("abc123");
      expect(result.errorMessage).toContain("Timeout");
    }
  });

  it("returns unknown on 503 server error", async () => {
    const submitTransaction = vi.fn(async () => {
      throw Object.assign(new Error("Service Unavailable"), {
        response: { status: 503 },
      });
    });
    const deps = makeDeps({ submitTransaction });
    const service = new TransactionSubmissionService(deps);

    const tx = makeTx("abc123");
    const lifecycle = createLifecycleContextHelper();

    const result = await service.submitTransaction(tx, lifecycle);

    expect(result.outcome).toBe("unknown");
  });
});

// ── submitTransactionSafely ──────────────────────────────────────────────────

describe("TransactionSubmissionService — submitTransactionSafely", () => {
  it("completes the full prepare → sign → submit flow", async () => {
    const loadAccount = vi.fn(async () => makeAccount("5000"));
    const submitTransaction = vi.fn(async () =>
      makeSuccessResponse("abc123", 42),
    );
    const deps = makeDeps({ loadAccount, submitTransaction });
    const service = new TransactionSubmissionService(deps, {
      idempotent: true,
    });

    const tx = makeTx("abc123");
    const signFn = vi.fn();

    const result = await service.submitTransactionSafely(
      TEST_PUBKEY,
      () => tx,
      signFn,
      { operationLabel: "Payment" },
    );

    expect(result.outcome).toBe("confirmed");
    expect(signFn).toHaveBeenCalledTimes(1);
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("retries on sequence conflict by refreshing account", async () => {
    // First loadAccount returns stale seq, submit fails with tx_bad_seq,
    // second loadAccount returns fresh seq, second submit succeeds
    const loadAccount = vi
      .fn()
      .mockResolvedValueOnce(makeAccount("5000"))
      .mockResolvedValueOnce(makeAccount("5001"));

    const submitTransaction = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("tx_bad_seq"), {
          extras: { result_codes: { transaction: "tx_bad_seq" } },
        }),
      )
      .mockResolvedValueOnce(makeSuccessResponse("def456", 50));

    const deps = makeDeps({ loadAccount, submitTransaction });
    const service = new TransactionSubmissionService(deps, {
      idempotent: true,
      maxRefreshAttempts: 3,
    });

    const result = await service.submitTransactionSafely(
      TEST_PUBKEY,
      () => makeTx("def456"),
      () => {},
    );

    expect(result.outcome).toBe("confirmed");
    expect(loadAccount).toHaveBeenCalledTimes(2);
    expect(submitTransaction).toHaveBeenCalledTimes(2);
  });

  it("does not auto-retry unknown outcomes for non-idempotent operations", async () => {
    const loadAccount = vi.fn(async () => makeAccount("5000"));
    const submitTransaction = vi.fn(async () => {
      throw new Error("Timeout talking to Horizon");
    });
    const deps = makeDeps({ loadAccount, submitTransaction });
    const service = new TransactionSubmissionService(deps, {
      idempotent: false,
    });

    const result = await service.submitTransactionSafely(
      TEST_PUBKEY,
      () => makeTx("abc123"),
      () => {},
    );

    // Unknown outcome should NOT trigger a retry for non-idempotent ops
    expect(result.outcome).toBe("unknown");
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });
});

// ── Lifecycle tracking is maintained ─────────────────────────────────────────

describe("TransactionSubmissionService — lifecycle tracking", () => {
  it("lifecycle reflects the correct final state after confirmed submission", async () => {
    const submitTransaction = vi.fn(async () =>
      makeSuccessResponse("abc123", 42),
    );
    const deps = makeDeps({ submitTransaction });
    const service = new TransactionSubmissionService(deps);

    const result = await service.submitTransactionSafely(
      TEST_PUBKEY,
      () => makeTx("abc123"),
      () => {},
    );

    expect(result.lifecycle.state).toBe("confirmed");
    expect(result.lifecycle.transactionHash).toBe("abc123");
    expect(result.lifecycle.ledger).toBe(42);
  });

  it("lifecycle reflects unknown state after ambiguous failure", async () => {
    const submitTransaction = vi.fn(async () => {
      throw new Error("ECONNRESET socket hang up");
    });
    const deps = makeDeps({ submitTransaction });
    const service = new TransactionSubmissionService(deps, {
      idempotent: false,
    });

    const result = await service.submitTransactionSafely(
      TEST_PUBKEY,
      () => makeTx("abc123"),
      () => {},
    );

    expect(result.lifecycle.state).toBe("unknown");
  });
});

// ── Concurrent submission attempts ──────────────────────────────────────────

describe("TransactionSubmissionService — concurrent submissions use fresh sequences", () => {
  it("each concurrent prepareTransaction gets a fresh account load", async () => {
    const loadAccount = vi
      .fn()
      .mockResolvedValueOnce(makeAccount("1000"))
      .mockResolvedValueOnce(makeAccount("1001"));

    const deps = makeDeps({ loadAccount });
    const service = new TransactionSubmissionService(deps);

    // Two concurrent preparations
    const [prep1, prep2] = await Promise.all([
      service.prepareTransaction(TEST_PUBKEY, () => makeTx("tx1")),
      service.prepareTransaction(TEST_PUBKEY, () => makeTx("tx2")),
    ]);

    expect(prep1.sequence).not.toBe(prep2.sequence);
    expect(loadAccount).toHaveBeenCalledTimes(2);
  });
});

// ── Helper ──────────────────────────────────────────────────────────────────

// Import at bottom to avoid circular ref in test helpers
import { createLifecycleContext } from "./transaction-lifecycle";

function createLifecycleContextHelper() {
  return createLifecycleContext({ idempotent: true, maxRetries: 3 });
}
