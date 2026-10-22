import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SequenceManager,
  SequenceError,
  isSequenceConflictError,
  isStaleSequence,
  nextSequenceNumber,
  type AccountLike,
} from "./sequence-manager";

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeAccount(id: string, seq: string): AccountLike {
  return {
    accountId: () => id,
    sequenceNumber: () => seq,
  };
}

const TEST_PUBKEY = "GAAAAAAAACGC6QWAOGV2XDMQ6XGKPNUVKEKJW3XYKQFQBPJHYOA";

function makeDeps(overrides?: {
  loadAccount?: ReturnType<typeof vi.fn>;
  sleep?: ReturnType<typeof vi.fn>;
}) {
  const loadAccount = overrides?.loadAccount ?? vi.fn();
  const sleep = overrides?.sleep ?? vi.fn(async () => {});
  return { loadAccount, sleep };
}

// ── isSequenceConflictError ──────────────────────────────────────────────────

describe("isSequenceConflictError", () => {
  it("detects tx_bad_seq in error message", () => {
    expect(isSequenceConflictError(new Error("Transaction failed: tx_bad_seq"))).toBe(true);
  });

  it("detects bad_seq in Horizon result codes", () => {
    const error = {
      extras: { result_codes: { transaction: "tx_bad_seq" } },
    };
    expect(isSequenceConflictError(error)).toBe(true);
  });

  it("detects sequence mismatch in error name", () => {
    const error = { name: "SequenceMismatch", message: "foo" };
    expect(isSequenceConflictError(error)).toBe(true);
  });

  it("returns false for non-sequence errors", () => {
    expect(isSequenceConflictError(new Error("op_underfunded"))).toBe(false);
    expect(isSequenceConflictError(new Error("timeout"))).toBe(false);
    expect(isSequenceConflictError(null)).toBe(false);
    expect(isSequenceConflictError(undefined)).toBe(false);
  });
});

// ── isStaleSequence ──────────────────────────────────────────────────────────

describe("isStaleSequence", () => {
  it("detects when network is ahead of local", () => {
    expect(isStaleSequence("1000", "1001")).toBe(true);
    expect(isStaleSequence("1000", "1050")).toBe(true);
  });

  it("returns false when local equals network", () => {
    expect(isStaleSequence("1000", "1000")).toBe(false);
  });

  it("returns false when local is ahead (should not happen normally)", () => {
    expect(isStaleSequence("1005", "1000")).toBe(false);
  });

  it("handles large sequence numbers", () => {
    expect(isStaleSequence("9007199254740992", "9007199254740993")).toBe(true);
  });
});

// ── nextSequenceNumber ────────────────────────────────────────────────────────

describe("nextSequenceNumber", () => {
  it("increments by one", () => {
    expect(nextSequenceNumber("1000")).toBe("1001");
    expect(nextSequenceNumber("0")).toBe("1");
  });

  it("handles large numbers without precision loss", () => {
    expect(nextSequenceNumber("9007199254740992")).toBe("9007199254740993");
  });
});

// ── SequenceManager.fetchCurrentSequence ────────────────────────────────────

describe("SequenceManager — fetchCurrentSequence", () => {
  it("fetches the latest sequence from the network", async () => {
    const loadAccount = vi.fn().mockResolvedValue(makeAccount(TEST_PUBKEY, "5000"));
    const manager = new SequenceManager({ loadAccount, sleep: vi.fn() });

    const seq = await manager.fetchCurrentSequence(TEST_PUBKEY);

    expect(loadAccount).toHaveBeenCalledTimes(1);
    expect(loadAccount).toHaveBeenCalledWith(TEST_PUBKEY);
    expect(seq).toBe("5000");
  });

  it("caches the account after first fetch", async () => {
    const loadAccount = vi.fn().mockResolvedValue(makeAccount(TEST_PUBKEY, "5000"));
    const manager = new SequenceManager({ loadAccount, sleep: vi.fn() });

    await manager.fetchCurrentSequence(TEST_PUBKEY);
    const cached = manager.getCachedAccount();

    expect(cached).not.toBeNull();
    expect(cached!.sequenceNumber()).toBe("5000");
  });

  it("throws ACCOUNT_NOT_FOUND on 404", async () => {
    const loadAccount = vi.fn().mockRejectedValue(
      Object.assign(new Error("Not Found"), { response: { status: 404 } }),
    );
    const manager = new SequenceManager({ loadAccount, sleep: vi.fn() });

    await expect(manager.fetchCurrentSequence(TEST_PUBKEY)).rejects.toThrow(SequenceError);
    await expect(manager.fetchCurrentSequence(TEST_PUBKEY)).rejects.toMatchObject({
      code: "ACCOUNT_NOT_FOUND",
    });
  });

  it("throws NETWORK_TIMEOUT on timeout errors", async () => {
    const loadAccount = vi.fn().mockRejectedValue(new Error("Timeout loading account"));
    const manager = new SequenceManager({ loadAccount, sleep: vi.fn() });

    await expect(manager.fetchCurrentSequence(TEST_PUBKEY)).rejects.toMatchObject({
      code: "NETWORK_TIMEOUT",
    });
  });
});

// ── SequenceManager.getSequenceForTransaction ───────────────────────────────

describe("SequenceManager — getSequenceForTransaction", () => {
  it("returns the next sequence number (current + 1)", async () => {
    const loadAccount = vi.fn().mockResolvedValue(makeAccount(TEST_PUBKEY, "5000"));
    const manager = new SequenceManager({ loadAccount, sleep: vi.fn() });

    const seq = await manager.getSequenceForTransaction(TEST_PUBKEY);

    expect(seq).toBe("5001");
  });
});

// ── SequenceManager.validateSequence ─────────────────────────────────────────

describe("SequenceManager — validateSequence", () => {
  it("passes when local sequence matches network", async () => {
    const loadAccount = vi.fn().mockResolvedValue(makeAccount(TEST_PUBKEY, "5000"));
    const manager = new SequenceManager({ loadAccount, sleep: vi.fn() });

    await expect(manager.validateSequence(TEST_PUBKEY, "5000")).resolves.toBeUndefined();
  });

  it("passes when local is ahead of network", async () => {
    const loadAccount = vi.fn().mockResolvedValue(makeAccount(TEST_PUBKEY, "5000"));
    const manager = new SequenceManager({ loadAccount, sleep: vi.fn() });

    await expect(manager.validateSequence(TEST_PUBKEY, "5005")).resolves.toBeUndefined();
  });

  it("throws STALE_SEQUENCE when local is behind network", async () => {
    const loadAccount = vi.fn().mockResolvedValue(makeAccount(TEST_PUBKEY, "5000"));
    const manager = new SequenceManager({ loadAccount, sleep: vi.fn() });

    await expect(manager.validateSequence(TEST_PUBKEY, "4999")).rejects.toMatchObject({
      code: "STALE_SEQUENCE",
      accountPublicKey: TEST_PUBKEY,
      localSequence: "4999",
      networkSequence: "5000",
    });
  });
});

// ── SequenceManager.refreshOnConflict ───────────────────────────────────────

describe("SequenceManager — refreshOnConflict", () => {
  it("refreshes and returns the next sequence after a conflict", async () => {
    const loadAccount = vi
      .fn()
      .mockResolvedValueOnce(makeAccount(TEST_PUBKEY, "5001"));

    const manager = new SequenceManager({ loadAccount, sleep: vi.fn() });

    const newSeq = await manager.refreshOnConflict(TEST_PUBKEY, "5000");

    expect(newSeq).toBe("5002");
  });

  it("retries with backoff on network failures", async () => {
    const loadAccount = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(makeAccount(TEST_PUBKEY, "5001"));

    const sleep = vi.fn(async () => {});
    const manager = new SequenceManager({ loadAccount, sleep });

    const newSeq = await manager.refreshOnConflict(TEST_PUBKEY, "5000");

    expect(newSeq).toBe("5002");
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("throws SEQUENCE_CONFLICT after max attempts", async () => {
    const loadAccount = vi.fn().mockRejectedValue(new Error("network error"));
    const sleep = vi.fn(async () => {});
    const manager = new SequenceManager(
      { loadAccount, sleep },
      { maxRefreshAttempts: 2 },
    );

    await expect(manager.refreshOnConflict(TEST_PUBKEY, "5000")).rejects.toMatchObject({
      code: "SEQUENCE_CONFLICT",
    });
    expect(loadAccount).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

// ── SequenceManager cache management ─────────────────────────────────────────

describe("SequenceManager — cache management", () => {
  it("invalidateCache clears the cached account", async () => {
    const loadAccount = vi.fn().mockResolvedValue(makeAccount(TEST_PUBKEY, "5000"));
    const manager = new SequenceManager({ loadAccount, sleep: vi.fn() });

    await manager.fetchCurrentSequence(TEST_PUBKEY);
    expect(manager.getCachedAccount()).not.toBeNull();

    manager.invalidateCache();
    expect(manager.getCachedAccount()).toBeNull();
  });

  it("returns null from getCachedAccount when cache is stale", async () => {
    const loadAccount = vi.fn().mockResolvedValue(makeAccount(TEST_PUBKEY, "5000"));
    const manager = new SequenceManager(
      { loadAccount, sleep: vi.fn() },
      { cacheTtlMs: 0 },
    );

    await manager.fetchCurrentSequence(TEST_PUBKEY);
    // Cache TTL of 0 means it's immediately stale
    expect(manager.getCachedAccount()).toBeNull();
  });
});

// ── Concurrent sequence preparation ──────────────────────────────────────────

describe("SequenceManager — concurrent preparation", () => {
  it("each call fetches the latest network state", async () => {
    const sequences = ["1000", "1001", "1002"];
    let callIndex = 0;
    const loadAccount = vi.fn(async () => {
      const seq = sequences[callIndex++] ?? "1002";
      return makeAccount(TEST_PUBKEY, seq);
    });

    const manager = new SequenceManager({ loadAccount, sleep: vi.fn() });

    const seq1 = await manager.getSequenceForTransaction(TEST_PUBKEY);
    expect(seq1).toBe("1001");

    const seq2 = await manager.getSequenceForTransaction(TEST_PUBKEY);
    expect(seq2).toBe("1002");

    const seq3 = await manager.getSequenceForTransaction(TEST_PUBKEY);
    expect(seq3).toBe("1003");

    // Each call made a fresh network fetch
    expect(loadAccount).toHaveBeenCalledTimes(3);
  });
});
