/**
 * Transaction Audit Verification Service — comprehensive test suite.
 *
 * Coverage targets from the acceptance criteria:
 *  ✓ Successful transaction verification
 *  ✓ Missing transaction handling (pending state)
 *  ✓ Failed transaction handling
 *  ✓ Unverifiable states (Horizon timeout, service failure, missing config)
 *  ✓ Horizon timeout scenarios
 *  ✓ Horizon service failures (retryable)
 *  ✓ Retryable verification failures
 *  ✓ Transaction hash validation (invalid format)
 *  ✓ Network mismatch rejection (testnet tx against mainnet config)
 *  ✓ Testnet / mainnet separation
 *  ✓ Expected operation matching
 *  ✓ Incorrect operation detection
 *  ✓ Duplicate verification prevention (idempotency)
 *  ✓ Audit record creation
 *  ✓ Idempotent verification execution
 *  ✓ Verification state transitions
 *  ✓ Recovery after temporary network failures
 *  ✓ Ledger metadata persistence
 *  ✓ Concurrent verification requests
 *  ✓ Memo mismatch rejection
 *  ✓ Source account mismatch rejection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { withRetry, isHorizonRetryable } from "./retry";
import { saveAuditRecord, findAuditRecord } from "./audit-verification-store";
import type {
  AuditVerificationResult,
  AnonChatAction,
  StellarTransactionVerificationStatus,
  TransactionAuditRecord,
} from "@/types/blockchain";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/blockchain/stellar-config", () => ({
  loadStellarConfig: vi.fn(() => ({
    network: "testnet",
    sourceSecret: "STEST000000000000000000000000000000000000000000000000000000",
    horizonUrl: "https://horizon-testnet.stellar.org",
    transactionTimeout: 10_000,
  })),
  isConfigured: vi.fn(() => true),
  getExplorerUrl: vi.fn(
    (hash: string, network: string) =>
      `https://stellar.expert/explorer/${network}/tx/${hash}`,
  ),
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof StellarSdk>();
  return {
    ...original,
    Horizon: {
      Server: vi.fn().mockImplementation(() => ({
        transactions: vi.fn(() => ({
          transaction: vi.fn(() => ({
            call: vi.fn(),
          })),
        })),
      })),
    },
    TransactionBuilder: {
      ...original.TransactionBuilder,
      fromXDR: vi.fn(),
    },
  };
});

// ── Test helpers ──────────────────────────────────────────────────────────────

const VALID_HASH = "a".repeat(64);
const VALID_HASH_2 = "b".repeat(64);

function makeHorizonRecord(overrides: Record<string, unknown> = {}) {
  return {
    hash: VALID_HASH,
    memo: "aca_c_room-1",
    memo_type: "text",
    ledger_attr: 55_123_456,
    created_at: "2026-11-18T12:00:00Z",
    successful: true,
    source_account: "GABC1234567890123456789012345678901234567890123456789012",
    operation_count: 1,
    envelope_xdr: "TESTXDR",
    ...overrides,
  };
}

function makeDecodedTx(opType = "payment") {
  return {
    networkPassphrase: StellarSdk.Networks.TESTNET,
    operations: [{ type: opType, source: "GABC1234567890123456789012345678901234567890123456789012" }],
    source: "GABC1234567890123456789012345678901234567890123456789012",
  };
}

function getHorizonCallMock() {
  const { Horizon } = vi.mocked(StellarSdk);
  const serverInstance = (Horizon.Server as unknown as ReturnType<typeof vi.fn>).mock.results[
    (Horizon.Server as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
  ]?.value;
  return serverInstance?.transactions?.()?.transaction?.()?.call;
}

/** Builds a minimal Supabase-like client for testing storage interactions. */
function makeSupabase(options: {
  existing?: TransactionAuditRecord | null;
  upsertError?: { message: string; code?: string } | null;
  updateError?: { message: string } | null;
} = {}) {
  const { existing = null, upsertError = null, updateError = null } = options;

  const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
  const upsert = vi.fn().mockResolvedValue({ data: null, error: upsertError });
  // The store calls .update(payload).eq(col1, val1).eq(col2, val2)
  // so we need two levels of .eq() chaining.
  const updateEq2 = vi.fn().mockResolvedValue({ error: updateError });
  const updateEq = vi.fn(() => ({ eq: updateEq2 }));
  const update = vi.fn(() => ({ eq: updateEq }));

  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
          maybeSingle,
          order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })),
        })),
      })),
      upsert,
      update,
    })),
    _mocks: { maybeSingle, upsert, updateEq, updateEq2, update },
  };
}

// ── Import the service under test (after mocks are set up) ───────────────────

// Dynamic import ensures mocks are applied
let verifyTransactionForAudit: typeof import("./transaction-audit-verification").verifyTransactionForAudit;

beforeEach(async () => {
  vi.clearAllMocks();
  // Re-import to pick up fresh mock state
  const mod = await import("./transaction-audit-verification");
  verifyTransactionForAudit = mod.verifyTransactionForAudit;

  // Reset Horizon.Server mock to a fresh instance per test
  const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
  (Horizon.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    transactions: vi.fn(() => ({
      transaction: vi.fn(() => ({
        call: vi.fn(),
      })),
    })),
  }));
  (TransactionBuilder.fromXDR as ReturnType<typeof vi.fn>).mockReturnValue(
    makeDecodedTx(),
  );
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("verifyTransactionForAudit", () => {
  // ── 1. Hash format validation ─────────────────────────────────────────────

  describe("hash format validation", () => {
    it("returns invalid status for a non-hex hash", async () => {
      const result = await verifyTransactionForAudit({
        transactionHash: "not-a-valid-hash",
        expectedAction: "group_creation",
      });

      expect(result.status).toBe("invalid");
      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/invalid.*hash/i);
    });

    it("returns invalid status for a 63-character hex string", async () => {
      const result = await verifyTransactionForAudit({
        transactionHash: "a".repeat(63),
        expectedAction: "group_creation",
      });

      expect(result.status).toBe("invalid");
    });

    it("returns invalid status for a 65-character hex string", async () => {
      const result = await verifyTransactionForAudit({
        transactionHash: "a".repeat(65),
        expectedAction: "group_creation",
      });

      expect(result.status).toBe("invalid");
    });

    it("accepts a valid 64-character lowercase hex hash", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx());

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
      });

      expect(result.status).not.toBe("invalid");
    });
  });

  // ── 2. Config unavailable ────────────────────────────────────────────────

  describe("when Stellar config is unavailable", () => {
    it("returns unverifiable status", async () => {
      const { loadStellarConfig } = await import("@/lib/blockchain/stellar-config");
      vi.mocked(loadStellarConfig).mockReturnValueOnce(null);

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
      });

      expect(result.status).toBe("unverifiable");
      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/configuration unavailable/i);
    });
  });

  // ── 3. Missing transaction (404) ─────────────────────────────────────────

  describe("when the transaction does not exist on-chain", () => {
    it("returns pending status (not failed)", async () => {
      const { Horizon } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({
            call: vi.fn().mockRejectedValue(new Error("Transaction not found — 404")),
          }),
        }),
      }));

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
        retryOptions: { maxRetries: 0 },
      } as any, { retryOptions: { maxRetries: 0 } });

      expect(result.status).toBe("pending");
      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  // ── 4. Failed transaction ────────────────────────────────────────────────

  describe("when the transaction failed on-chain", () => {
    it("returns failed status and does not mark as verified", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({
            call: vi.fn().mockResolvedValue(makeHorizonRecord({ successful: false })),
          }),
        }),
      }));

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
      });

      expect(result.status).toBe("failed");
      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/failed on-chain/i);
    });
  });

  // ── 5. Horizon timeout ───────────────────────────────────────────────────

  describe("Horizon timeout", () => {
    it("returns unverifiable (not failed) so the action is not wrongly rejected", async () => {
      const { Horizon } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({
            call: vi.fn().mockRejectedValue(new Error("Timeout retrieving transaction")),
          }),
        }),
      }));

      const result = await verifyTransactionForAudit(
        { transactionHash: VALID_HASH, expectedAction: "group_creation" },
        { retryOptions: { maxRetries: 0 } },
      );

      expect(result.status).toBe("unverifiable");
      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/timed out|timeout/i);
    });
  });

  // ── 6. Horizon service failure (retryable) ───────────────────────────────

  describe("Horizon service unavailable", () => {
    it("returns unverifiable after all retries are exhausted", async () => {
      const { Horizon } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({
            call: vi.fn().mockRejectedValue(new Error("Service Unavailable — 503")),
          }),
        }),
      }));

      const result = await verifyTransactionForAudit(
        { transactionHash: VALID_HASH, expectedAction: "group_creation" },
        { retryOptions: { maxRetries: 2, baseDelayMs: 1, jitterMs: 0 } },
      );

      expect(result.status).toBe("unverifiable");
      expect(result.verified).toBe(false);
      expect(result.retryCount).toBeGreaterThanOrEqual(2);
    });

    it("succeeds if Horizon recovers on the second attempt", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      let callCount = 0;
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({
            call: vi.fn().mockImplementation(async () => {
              callCount++;
              if (callCount === 1) throw new Error("Service Unavailable — 503");
              return makeHorizonRecord();
            }),
          }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx());

      const result = await verifyTransactionForAudit(
        { transactionHash: VALID_HASH, expectedAction: "group_creation" },
        { retryOptions: { maxRetries: 3, baseDelayMs: 1, jitterMs: 0 } },
      );

      expect(result.status).toBe("successful");
      expect(result.verified).toBe(true);
      expect(result.retryCount).toBe(1);
    });
  });

  // ── 7. Network mismatch ──────────────────────────────────────────────────

  describe("network mismatch rejection", () => {
    it("rejects a mainnet transaction when configured for testnet", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
        }),
      }));
      // Simulate XDR decode failure — happens when wrong passphrase is used
      (TransactionBuilder.fromXDR as any).mockImplementation(() => {
        throw new Error("Invalid network passphrase");
      });

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
      });

      expect(result.status).toBe("failed");
      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/network mismatch/i);
    });

    it("rejects when the decoded passphrase belongs to mainnet but config is testnet", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue({
        networkPassphrase: StellarSdk.Networks.PUBLIC, // mainnet passphrase
        operations: [{ type: "payment", source: "GABC" }],
        source: "GABC",
      });

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
      });

      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/network mismatch/i);
      expect(result.error).toMatch(/mainnet/i);
    });

    it("does not set verified=true when testnet transaction is submitted to mainnet config", async () => {
      const { loadStellarConfig } = await import("@/lib/blockchain/stellar-config");
      vi.mocked(loadStellarConfig).mockReturnValueOnce({
        network: "mainnet",
        sourceSecret: "STEST000000000000000000000000000000000000000000000000000000",
        horizonUrl: "https://horizon.stellar.org",
        transactionTimeout: 10_000,
      });

      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
        }),
      }));
      // fromXDR throws because testnet tx can't decode against PUBLIC passphrase
      (TransactionBuilder.fromXDR as any).mockImplementation(() => {
        throw new Error("Invalid network passphrase");
      });

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
      });

      expect(result.verified).toBe(false);
      expect(result.status).toBe("failed");
    });
  });

  // ── 8. Operation validation ──────────────────────────────────────────────

  describe("operation validation", () => {
    it("accepts a payment operation for group_creation", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx("payment"));

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
      });

      expect(result.status).toBe("successful");
      expect(result.operationType).toBe("payment");
    });

    it("rejects a createAccount operation for group_creation (wrong operation type)", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx("createAccount"));

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
      });

      expect(result.status).toBe("failed");
      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/expected payment operation/i);
    });

    it("rejects a transaction with no operations", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue({
        networkPassphrase: StellarSdk.Networks.TESTNET,
        operations: [],
        source: "GABC",
      });

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
      });

      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/no operations/i);
    });

    it("accepts payment or setOptions for ownership_transfer", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx("setOptions"));

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "ownership_transfer",
      });

      expect(result.status).toBe("successful");
      expect(result.verified).toBe(true);
    });

    it("rejects an unsupported operation type for ownership_transfer", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx("manageData"));

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "ownership_transfer",
      });

      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/expected payment/i);
    });
  });

  // ── 9. Memo validation ───────────────────────────────────────────────────

  describe("memo validation", () => {
    it("accepts when expectedMemo matches the transaction memo", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({
            call: vi.fn().mockResolvedValue(makeHorizonRecord({ memo: "aca_c_room-1" })),
          }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx());

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
        expectedMemo: "aca_c_room-1",
      });

      expect(result.verified).toBe(true);
    });

    it("rejects when expectedMemo does not match the transaction memo", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({
            call: vi.fn().mockResolvedValue(makeHorizonRecord({ memo: "aca_j_room-2" })),
          }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx());

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
        expectedMemo: "aca_c_room-1",
      });

      expect(result.status).toBe("failed");
      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/memo.*does not match/i);
    });

    it("skips memo validation when expectedMemo is null", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({
            call: vi.fn().mockResolvedValue(makeHorizonRecord({ memo: "any-memo" })),
          }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx());

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
        expectedMemo: null,
      });

      expect(result.verified).toBe(true);
    });
  });

  // ── 10. Source account validation ────────────────────────────────────────

  describe("source account validation", () => {
    it("rejects when expectedSourceAccount does not match", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({
            call: vi.fn().mockResolvedValue(makeHorizonRecord()),
          }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx());

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
        expectedSourceAccount: "GWRONGACCOUNT0000000000000000000000000000000000000000000",
      });

      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/source account/i);
    });

    it("accepts when expectedSourceAccount matches", async () => {
      const sourceAccount = "GABC1234567890123456789012345678901234567890123456789012";
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({
            call: vi.fn().mockResolvedValue(makeHorizonRecord({ source_account: sourceAccount })),
          }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue({
        networkPassphrase: StellarSdk.Networks.TESTNET,
        operations: [{ type: "payment", source: sourceAccount }],
        source: sourceAccount,
      });

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
        expectedSourceAccount: sourceAccount,
      });

      expect(result.verified).toBe(true);
      expect(result.sourceAccount).toBe(sourceAccount);
    });
  });

  // ── 11. Ledger metadata persistence ─────────────────────────────────────

  describe("ledger metadata", () => {
    it("includes ledger number and close time in a successful result", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({
            call: vi.fn().mockResolvedValue(
              makeHorizonRecord({
                ledger_attr: 55_123_456,
                created_at: "2026-11-18T12:00:00Z",
              }),
            ),
          }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx());

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
      });

      expect(result.ledger).toBe(55_123_456);
      expect(result.ledgerCloseTime).toBe("2026-11-18T12:00:00Z");
    });
  });

  // ── 12. Idempotency / duplicate prevention ────────────────────────────────

  describe("idempotent verification", () => {
    it("returns existing successful record without calling Horizon again", async () => {
      const existingRecord: TransactionAuditRecord = {
        transaction_hash: VALID_HASH,
        network_identifier: "testnet",
        ledger: 55_000_000,
        ledger_close_time: "2026-11-18T10:00:00Z",
        source_account: "GABC",
        operation_count: 1,
        operation_type: "payment",
        expected_action: "group_creation",
        group_id: null,
        status: "successful",
        verified: true,
        retry_count: 0,
        error_message: null,
        diagnostic_details: null,
        verified_at: "2026-11-18T10:00:00Z",
      };

      const supabase = makeSupabase({ existing: existingRecord });

      const { Horizon } = vi.mocked(StellarSdk);
      const callMock = vi.fn();
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({ transaction: () => ({ call: callMock }) }),
      }));

      const result = await verifyTransactionForAudit(
        { transactionHash: VALID_HASH, expectedAction: "group_creation" },
        { supabase: supabase as any },
      );

      expect(result.status).toBe("successful");
      expect(result.verified).toBe(true);
      expect(result.idempotent).toBe(true);
      expect(callMock).not.toHaveBeenCalled();
    });

    it("does not create a duplicate audit record when re-verified", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx());

      const supabase = makeSupabase({ existing: null });

      await verifyTransactionForAudit(
        { transactionHash: VALID_HASH, expectedAction: "group_creation" },
        { supabase: supabase as any },
      );

      // Second call with same hash — now existing record is returned
      const supabase2 = makeSupabase({
        existing: {
          transaction_hash: VALID_HASH,
          network_identifier: "testnet",
          ledger: 55_000_000,
          ledger_close_time: null,
          source_account: null,
          operation_count: 1,
          operation_type: "payment",
          expected_action: "group_creation",
          group_id: null,
          status: "successful",
          verified: true,
          retry_count: 0,
          error_message: null,
          diagnostic_details: null,
          verified_at: "2026-11-18T10:00:00Z",
        },
      });

      const result2 = await verifyTransactionForAudit(
        { transactionHash: VALID_HASH, expectedAction: "group_creation" },
        { supabase: supabase2 as any },
      );

      expect(result2.idempotent).toBe(true);
      // Upsert should not have been called for the second invocation
      expect(supabase2._mocks.upsert).not.toHaveBeenCalled();
    });

    it("handles concurrent verification requests without creating duplicate records", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({
            call: vi.fn().mockResolvedValue(makeHorizonRecord()),
          }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx());

      // Supabase returns a unique constraint error (23505) on the second insert
      const supabase = makeSupabase({
        upsertError: { message: "duplicate key value", code: "23505" },
      });

      const result = await verifyTransactionForAudit(
        { transactionHash: VALID_HASH, expectedAction: "group_creation" },
        { supabase: supabase as any },
      );

      // Should not throw — treat 23505 as idempotent success
      expect(result.status).toBe("successful");
    });
  });

  // ── 13. State transitions ─────────────────────────────────────────────────

  describe("verification state transitions", () => {
    it("promotes pending → successful when re-verification succeeds", async () => {
      const pendingRecord: TransactionAuditRecord = {
        transaction_hash: VALID_HASH,
        network_identifier: "testnet",
        ledger: null,
        ledger_close_time: null,
        source_account: null,
        operation_count: null,
        operation_type: null,
        expected_action: "group_creation",
        group_id: null,
        status: "pending",
        verified: false,
        retry_count: 1,
        error_message: "Horizon timeout",
        diagnostic_details: null,
        verified_at: "2026-11-18T10:00:00Z",
      };

      // First call returns pending cached record (not successful, so no early return)
      const supabase = makeSupabase({ existing: pendingRecord });

      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx());

      const result = await verifyTransactionForAudit(
        { transactionHash: VALID_HASH, expectedAction: "group_creation" },
        { supabase: supabase as any },
      );

      expect(result.status).toBe("successful");
      expect(result.verified).toBe(true);
      // The update path should have been triggered
      expect(supabase._mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "successful", verified: true }),
      );
    });

    it("does not downgrade successful → pending on a re-run", async () => {
      const successfulRecord: TransactionAuditRecord = {
        transaction_hash: VALID_HASH,
        network_identifier: "testnet",
        ledger: 55_000_000,
        ledger_close_time: null,
        source_account: null,
        operation_count: 1,
        operation_type: "payment",
        expected_action: "group_creation",
        group_id: null,
        status: "successful",
        verified: true,
        retry_count: 0,
        error_message: null,
        diagnostic_details: null,
        verified_at: "2026-11-18T09:00:00Z",
      };

      const supabase = makeSupabase({ existing: successfulRecord });

      // This run would produce pending if it ran (Horizon not set up), but
      // the idempotency guard should short-circuit.
      const result = await verifyTransactionForAudit(
        { transactionHash: VALID_HASH, expectedAction: "group_creation" },
        { supabase: supabase as any },
      );

      expect(result.status).toBe("successful");
      expect(result.verified).toBe(true);
      // No Horizon call should have been made
      expect(supabase._mocks.update).not.toHaveBeenCalled();
    });
  });

  // ── 14. All action types accepted ────────────────────────────────────────

  describe("all AnonChat action types", () => {
    const actions: AnonChatAction[] = [
      "group_creation",
      "group_join",
      "group_leave",
      "member_removal",
      "wallet_auth",
      "audit_event",
      "ownership_transfer",
    ];

    for (const action of actions) {
      it(`verifies a successful payment operation for action: ${action}`, async () => {
        const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
        (Horizon.Server as any).mockImplementation(() => ({
          transactions: () => ({
            transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
          }),
        }));
        const opType =
          action === "ownership_transfer" ? "setOptions" : "payment";
        (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx(opType));

        const result = await verifyTransactionForAudit({
          transactionHash: VALID_HASH,
          expectedAction: action,
        });

        expect(result.expectedAction).toBe(action);
        expect(result.status).toBe("successful");
        expect(result.verified).toBe(true);
      });
    }
  });

  // ── 15. Envelope XDR unavailable ─────────────────────────────────────────

  describe("when envelope_xdr is missing from the Horizon response", () => {
    it("returns unverifiable because network passphrase cannot be confirmed", async () => {
      const { Horizon } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({
            call: vi.fn().mockResolvedValue(
              makeHorizonRecord({ envelope_xdr: undefined }),
            ),
          }),
        }),
      }));

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
      });

      expect(result.status).toBe("unverifiable");
      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/network validation cannot be completed/i);
    });
  });

  // ── 16. Explorer URL ──────────────────────────────────────────────────────

  describe("explorer URL", () => {
    it("includes an explorer URL on successful verification", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx());

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
      });

      expect(result.explorerUrl).toMatch(/stellar\.expert/);
      expect(result.explorerUrl).toContain(VALID_HASH);
    });

    it("returns null explorerUrl for invalid hash", async () => {
      const result = await verifyTransactionForAudit({
        transactionHash: "bad-hash",
        expectedAction: "group_creation",
      });

      expect(result.explorerUrl).toBeNull();
    });
  });

  // ── 17. No supabase — storage is skipped ─────────────────────────────────

  describe("when supabase is not provided", () => {
    it("returns a valid result without attempting storage", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx());

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
      });

      expect(result.status).toBe("successful");
      expect(result.verified).toBe(true);
    });
  });

  // ── 18. Diagnostic details ────────────────────────────────────────────────

  describe("diagnostic details", () => {
    it("includes structured diagnosticDetails on failure", async () => {
      const result = await verifyTransactionForAudit({
        transactionHash: "not-valid",
        expectedAction: "group_creation",
      });

      expect(result.diagnosticDetails).not.toBeNull();
      expect(result.diagnosticDetails).toHaveProperty("reason");
    });

    it("sets diagnosticDetails to null on success", async () => {
      const { Horizon, TransactionBuilder } = vi.mocked(StellarSdk);
      (Horizon.Server as any).mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: vi.fn().mockResolvedValue(makeHorizonRecord()) }),
        }),
      }));
      (TransactionBuilder.fromXDR as any).mockReturnValue(makeDecodedTx());

      const result = await verifyTransactionForAudit({
        transactionHash: VALID_HASH,
        expectedAction: "group_creation",
      });

      expect(result.diagnosticDetails).toBeNull();
    });
  });

  // ── 19. Correlation ID ────────────────────────────────────────────────────

  describe("correlation ID", () => {
    it("uses provided correlationId in the result", async () => {
      const result = await verifyTransactionForAudit({
        transactionHash: "bad-hash",
        expectedAction: "group_creation",
        correlationId: "test-correlation-id-123",
      });

      expect(result.correlationId).toBe("test-correlation-id-123");
    });

    it("generates a correlationId when none is provided", async () => {
      const result = await verifyTransactionForAudit({
        transactionHash: "bad-hash",
        expectedAction: "group_creation",
      });

      expect(result.correlationId).toBeDefined();
      expect(result.correlationId.length).toBeGreaterThan(0);
    });
  });
});

// ── withRetry unit tests ──────────────────────────────────────────────────────

describe("withRetry", () => {
  it("returns success on first attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, jitterMs: 0 });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    if (result.success) expect(result.value).toBe("ok");
  });

  it("retries and eventually succeeds", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      if (++calls < 3) throw new Error("fail");
      return "recovered";
    });

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, jitterMs: 0 });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    if (result.success) expect(result.value).toBe("recovered");
  });

  it("exhausts retries and returns failure", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent failure"));
    const result = await withRetry(fn, { maxRetries: 2, baseDelayMs: 1, jitterMs: 0 });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3); // initial + 2 retries
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("not found — 404"));
    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 1,
      jitterMs: 0,
      isRetryable: isHorizonRetryable,
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1); // no retries
  });

  it("calls onRetry with attempt number and delay", async () => {
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    await withRetry(fn, { maxRetries: 2, baseDelayMs: 1, jitterMs: 0, onRetry });

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 0, expect.any(Number));
  });
});

// ── isHorizonRetryable unit tests ─────────────────────────────────────────────

describe("isHorizonRetryable", () => {
  it("retries timeout errors", () => {
    expect(isHorizonRetryable(new Error("Timeout retrieving transaction"))).toBe(true);
  });

  it("retries 503 errors", () => {
    expect(isHorizonRetryable(new Error("Service Unavailable — 503"))).toBe(true);
  });

  it("retries 429 errors", () => {
    expect(isHorizonRetryable(new Error("Too Many Requests — 429"))).toBe(true);
  });

  it("does not retry 404 errors", () => {
    expect(isHorizonRetryable(new Error("Transaction not found — 404"))).toBe(false);
  });

  it("does not retry 400 errors", () => {
    expect(isHorizonRetryable(new Error("Bad Request — 400"))).toBe(false);
  });

  it("does not retry 401 errors", () => {
    expect(isHorizonRetryable(new Error("Unauthorized — 401"))).toBe(false);
  });

  it("retries unknown (non-Error) values", () => {
    expect(isHorizonRetryable("some string error")).toBe(true);
    expect(isHorizonRetryable(null)).toBe(true);
  });
});

// ── saveAuditRecord / findAuditRecord unit tests ──────────────────────────────

describe("audit-verification-store", () => {
  function makeResult(
    overrides: Partial<AuditVerificationResult> = {},
  ): AuditVerificationResult {
    return {
      transactionHash: VALID_HASH,
      status: "successful",
      verified: true,
      networkIdentifier: "testnet",
      ledger: 55_000_000,
      ledgerCloseTime: "2026-11-18T10:00:00Z",
      sourceAccount: "GABC",
      operationCount: 1,
      operationType: "payment",
      expectedAction: "group_creation",
      groupId: null,
      error: null,
      diagnosticDetails: null,
      verifiedAt: "2026-11-18T10:00:00Z",
      explorerUrl: null,
      idempotent: false,
      retryCount: 0,
      correlationId: "test-corr",
      ...overrides,
    };
  }

  it("inserts a new record and returns written=true, existing=false", async () => {
    const supabase = makeSupabase({ existing: null });
    const result = makeResult();

    const { written, existing } = await saveAuditRecord(supabase as any, result);

    expect(written).toBe(true);
    expect(existing).toBe(false);
    expect(supabase._mocks.upsert).toHaveBeenCalledOnce();
  });

  it("skips update when existing record has equal or higher status rank", async () => {
    const existingRecord: TransactionAuditRecord = {
      transaction_hash: VALID_HASH,
      network_identifier: "testnet",
      ledger: null,
      ledger_close_time: null,
      source_account: null,
      operation_count: null,
      operation_type: null,
      expected_action: "group_creation",
      group_id: null,
      status: "successful",
      verified: true,
      retry_count: 0,
      error_message: null,
      diagnostic_details: null,
      verified_at: "2026-11-18T09:00:00Z",
    };

    const supabase = makeSupabase({ existing: existingRecord });
    // Incoming result is "pending" — lower rank than "successful"
    const result = makeResult({ status: "pending", verified: false });

    const { written, existing } = await saveAuditRecord(supabase as any, result);

    expect(written).toBe(false);
    expect(existing).toBe(true);
    expect(supabase._mocks.update).not.toHaveBeenCalled();
  });

  it("updates the record when incoming status is more definitive", async () => {
    const existingRecord: TransactionAuditRecord = {
      transaction_hash: VALID_HASH,
      network_identifier: "testnet",
      ledger: null,
      ledger_close_time: null,
      source_account: null,
      operation_count: null,
      operation_type: null,
      expected_action: "group_creation",
      group_id: null,
      status: "pending",
      verified: false,
      retry_count: 1,
      error_message: "timeout",
      diagnostic_details: null,
      verified_at: "2026-11-18T09:00:00Z",
    };

    const supabase = makeSupabase({ existing: existingRecord });
    const result = makeResult({ status: "successful", verified: true });

    const { written, existing } = await saveAuditRecord(supabase as any, result);

    expect(written).toBe(true);
    expect(existing).toBe(true);
    expect(supabase._mocks.update).toHaveBeenCalledOnce();
  });

  it("throws when insert fails with a non-duplicate error", async () => {
    const supabase = makeSupabase({
      existing: null,
      upsertError: { message: "connection refused" },
    });
    const result = makeResult();

    await expect(saveAuditRecord(supabase as any, result)).rejects.toThrow(
      "Failed to save audit record",
    );
  });
});
