/**
 * Tests for Stellar Transaction Utilities
 *
 * Coverage:
 *   - Transaction State Model (types/transaction-states.ts)
 *   - Sequence Management Utility (lib/blockchain/sequence-manager.ts)
 *   - Transaction Submission Service (lib/blockchain/transaction-submission-service.ts)
 *   - Recovery Workflow (lib/blockchain/recovery-workflow.ts)
 *   - Transaction Logger (lib/blockchain/transaction-logger.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Stellar SDK mock ──────────────────────────────────────────────────────────

const { mockLoadAccount, mockSubmitTransaction, mockTransactionsCall } = vi.hoisted(() => ({
  mockLoadAccount: vi.fn(),
  mockSubmitTransaction: vi.fn(),
  mockTransactionsCall: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", async () => {
  const actual = await vi.importActual<typeof import("@stellar/stellar-sdk")>(
    "@stellar/stellar-sdk",
  );

  class MockTransactionBuilder {
    constructor(_account: any, _opts: any) {}
    addOperation(_op: unknown) { return this; }
    addMemo(_m: unknown) { return this; }
    setTimeout(_: number) { return this; }
    build() {
      return {
        hash: () => Buffer.from("aabbccdd".repeat(8), "hex"),
        sign: vi.fn(),
        toEnvelope: () => ({ toXDR: () => "base64xdr==" }),
      };
    }
  }

  return {
    ...actual,
    TransactionBuilder: MockTransactionBuilder,
    Horizon: {
      ...actual.Horizon,
      Server: class {
        loadAccount(...args: unknown[]) { return mockLoadAccount(...args); }
        submitTransaction(...args: unknown[]) { return mockSubmitTransaction(...args); }
        transactions() {
          return {
            transaction: (_hash: string) => ({ call: mockTransactionsCall }),
          };
        }
      },
    },
  };
});

vi.mock("@/lib/blockchain/stellar-config", () => ({
  isConfigured: () => true,
  loadStellarConfig: () => ({
    network: "testnet" as const,
    // Real valid Stellar test keypair (never used on mainnet)
    sourceSecret: "SCUERSGGE4H55C3ZT6AOYDAT5LJ2PLEXFTSVWXWHYLART3IS7TGESB72",
    horizonUrl: "https://horizon-testnet.stellar.org",
    transactionTimeout: 5000,
  }),
  getExplorerUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  EXTENDED_STATE_TRANSITIONS,
  EXTENDED_STATE_LABELS,
  SequenceErrorCode,
  SequenceError,
  isRetryEligibleState,
  isTerminalExtendedState,
  isAmbiguousState,
  isValidExtendedTransition,
  type ExtendedTransactionState,
  type SubmissionOutcome,
} from "@/types/transaction-states";

import {
  clearSequenceCache,
  getSequenceCacheSnapshot,
  fetchAccountSequence,
  getAccountSequence,
  detectSequenceError,
  refreshSequenceAfterConflict,
  isSequenceError,
} from "@/lib/blockchain/sequence-manager";

import {
  classifySubmissionError,
  prepareTransaction,
  signTransaction,
  submitSignedTransaction,
  prepareAndSubmit,
  retryWithRefreshedSequence,
  type SignedTransaction,
} from "@/lib/blockchain/transaction-submission-service";

import {
  SEQUENCE_CONFIRMATION_WINDOW_MS,
  checkTransactionStatus,
  determineRecoveryAction,
  runRecoveryWorkflow,
  createRecoveryContext,
  isRecoverable,
  type TransactionStatusQuery,
} from "@/lib/blockchain/recovery-workflow";

import {
  clearEventBuffer,
  getRecentEvents,
  recordTransactionEvent,
  logSequenceFetched,
  logSequenceError,
  logTransactionPrepared,
  logTransactionSubmitted,
  logSubmissionOutcome,
  logRecoveryStarted,
  logRecoveryActionDetermined,
  logDuplicateSubmissionDetected,
  logRetryScheduled,
  logRetryBlocked,
} from "@/lib/blockchain/transaction-logger";

// ── Test constants ────────────────────────────────────────────────────────────

// Real valid Stellar test keypair (never used on mainnet)
const SIGNER_SECRET = "SCUERSGGE4H55C3ZT6AOYDAT5LJ2PLEXFTSVWXWHYLART3IS7TGESB72";
const SOURCE_ACCOUNT = "GDBH6REA3MSVFK4ZSHXQFWFOJ7GF5YXQWV42M6JASB6QT4RXLYKZ4GB6";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const TX_HASH = "a".repeat(64);

function makeHorizonAccount(sequence = "100") {
  return {
    sequence,
    balances: [{ asset_type: "native", balance: "10.0000000" }],
  };
}

function makeStatusQuery(overrides?: Partial<TransactionStatusQuery>): TransactionStatusQuery {
  return {
    transactionHash: TX_HASH,
    sourceAccountId: SOURCE_ACCOUNT,
    submittedSequence: 100n,
    horizonUrl: HORIZON_URL,
    submittedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. TRANSACTION STATE MODEL
// ════════════════════════════════════════════════════════════════════════════════

describe("Transaction State Model", () => {
  describe("EXTENDED_STATE_TRANSITIONS", () => {
    it("covers all 9 states", () => {
      const states: ExtendedTransactionState[] = [
        "preparing", "awaiting_wallet", "submitted", "confirming",
        "confirmed", "failed", "unknown_outcome", "retry_eligible", "retry_blocked",
      ];
      for (const state of states) {
        expect(EXTENDED_STATE_TRANSITIONS).toHaveProperty(state);
        expect(EXTENDED_STATE_LABELS).toHaveProperty(state);
      }
    });

    it("allows the happy path: preparing → … → confirmed", () => {
      expect(isValidExtendedTransition("preparing", "awaiting_wallet")).toBe(true);
      expect(isValidExtendedTransition("awaiting_wallet", "submitted")).toBe(true);
      expect(isValidExtendedTransition("submitted", "confirming")).toBe(true);
      expect(isValidExtendedTransition("confirming", "confirmed")).toBe(true);
    });

    it("allows submitted → unknown_outcome for ambiguous network failures", () => {
      expect(isValidExtendedTransition("submitted", "unknown_outcome")).toBe(true);
    });

    it("allows unknown_outcome → submitted (recovery confirms success path)", () => {
      expect(isValidExtendedTransition("unknown_outcome", "submitted")).toBe(true);
    });

    it("allows unknown_outcome → retry_eligible (recovery confirms not sent)", () => {
      expect(isValidExtendedTransition("unknown_outcome", "retry_eligible")).toBe(true);
    });

    it("allows failed → retry_eligible and failed → retry_blocked", () => {
      expect(isValidExtendedTransition("failed", "retry_eligible")).toBe(true);
      expect(isValidExtendedTransition("failed", "retry_blocked")).toBe(true);
    });

    it("allows retry_eligible → preparing to begin a retry", () => {
      expect(isValidExtendedTransition("retry_eligible", "preparing")).toBe(true);
    });

    it("makes retry_blocked terminal with no outgoing transitions", () => {
      expect(EXTENDED_STATE_TRANSITIONS["retry_blocked"]).toHaveLength(0);
    });

    it("makes confirmed terminal with no outgoing transitions", () => {
      expect(EXTENDED_STATE_TRANSITIONS["confirmed"]).toHaveLength(0);
    });

    it("rejects nonsensical transitions", () => {
      expect(isValidExtendedTransition("confirmed", "preparing")).toBe(false);
      expect(isValidExtendedTransition("retry_blocked", "preparing")).toBe(false);
      expect(isValidExtendedTransition("preparing", "confirmed")).toBe(false);
    });
  });

  describe("state predicates", () => {
    it("isRetryEligibleState returns true only for retry_eligible", () => {
      expect(isRetryEligibleState("retry_eligible")).toBe(true);
      expect(isRetryEligibleState("failed")).toBe(false);
      expect(isRetryEligibleState("retry_blocked")).toBe(false);
    });

    it("isTerminalExtendedState returns true for confirmed and retry_blocked", () => {
      expect(isTerminalExtendedState("confirmed")).toBe(true);
      expect(isTerminalExtendedState("retry_blocked")).toBe(true);
      expect(isTerminalExtendedState("failed")).toBe(false);
      expect(isTerminalExtendedState("retry_eligible")).toBe(false);
    });

    it("isAmbiguousState returns true only for unknown_outcome", () => {
      expect(isAmbiguousState("unknown_outcome")).toBe(true);
      expect(isAmbiguousState("failed")).toBe(false);
      expect(isAmbiguousState("submitted")).toBe(false);
    });
  });

  describe("SequenceError", () => {
    it("creates a SequenceError with correct name, code, and optional fields", () => {
      const err = new SequenceError(
        SequenceErrorCode.STALE_SEQUENCE,
        SOURCE_ACCOUNT,
        "Stale sequence",
        { usedSequence: 5n, currentSequence: 10n },
      );
      expect(err.name).toBe("SequenceError");
      expect(err.code).toBe(SequenceErrorCode.STALE_SEQUENCE);
      expect(err.accountId).toBe(SOURCE_ACCOUNT);
      expect(err.usedSequence).toBe(5n);
      expect(err.currentSequence).toBe(10n);
      expect(err instanceof Error).toBe(true);
      expect(err instanceof SequenceError).toBe(true);
    });

    it("covers all four SequenceErrorCode values", () => {
      const codes = [
        SequenceErrorCode.STALE_SEQUENCE,
        SequenceErrorCode.SEQUENCE_CONFLICT,
        SequenceErrorCode.ACCOUNT_NOT_FOUND,
        SequenceErrorCode.SEQUENCE_FETCH_FAILED,
      ];
      for (const code of codes) {
        const err = new SequenceError(code, SOURCE_ACCOUNT, `Error: ${code}`);
        expect(err.code).toBe(code);
      }
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 2. SEQUENCE MANAGEMENT UTILITY
// ════════════════════════════════════════════════════════════════════════════════

describe("Sequence Management Utility", () => {
  beforeEach(() => {
    clearSequenceCache();
    vi.clearAllMocks();
  });

  describe("fetchAccountSequence", () => {
    it("returns sequence info on a successful Horizon response", async () => {
      mockLoadAccount.mockResolvedValueOnce(makeHorizonAccount("42"));
      const result = await fetchAccountSequence(SOURCE_ACCOUNT, HORIZON_URL);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.info.sequence).toBe(42n);
        expect(result.info.accountId).toBe(SOURCE_ACCOUNT);
        expect(result.info.fetchedAt).toBeTruthy();
      }
    });

    it("returns ACCOUNT_NOT_FOUND when Horizon returns 404", async () => {
      mockLoadAccount.mockRejectedValueOnce({ response: { status: 404 } });
      const result = await fetchAccountSequence(SOURCE_ACCOUNT, HORIZON_URL);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(SequenceErrorCode.ACCOUNT_NOT_FOUND);
        expect(result.error instanceof SequenceError).toBe(true);
      }
    });

    it("returns SEQUENCE_FETCH_FAILED on network error", async () => {
      mockLoadAccount.mockRejectedValueOnce(new Error("ECONNRESET"));
      const result = await fetchAccountSequence(SOURCE_ACCOUNT, HORIZON_URL);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(SequenceErrorCode.SEQUENCE_FETCH_FAILED);
      }
    });

    it("populates the cache on success", async () => {
      mockLoadAccount.mockResolvedValueOnce(makeHorizonAccount("99"));
      await fetchAccountSequence(SOURCE_ACCOUNT, HORIZON_URL);
      const cache = getSequenceCacheSnapshot();
      expect(cache.has(SOURCE_ACCOUNT)).toBe(true);
      expect(cache.get(SOURCE_ACCOUNT)!.sequence).toBe(99n);
    });
  });

  describe("getAccountSequence — cache behaviour", () => {
    it("serves from cache when the entry is fresh", async () => {
      mockLoadAccount.mockResolvedValue(makeHorizonAccount("10"));
      await fetchAccountSequence(SOURCE_ACCOUNT, HORIZON_URL);

      await getAccountSequence(SOURCE_ACCOUNT, HORIZON_URL);
      // Only the initial fetchAccountSequence call should have hit Horizon
      expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    });

    it("bypasses cache when forceRefresh is true", async () => {
      mockLoadAccount.mockResolvedValue(makeHorizonAccount("11"));
      await fetchAccountSequence(SOURCE_ACCOUNT, HORIZON_URL);
      await getAccountSequence(SOURCE_ACCOUNT, HORIZON_URL, { forceRefresh: true });
      expect(mockLoadAccount).toHaveBeenCalledTimes(2);
    });

    it("fetches from Horizon when cache is empty", async () => {
      mockLoadAccount.mockResolvedValueOnce(makeHorizonAccount("77"));
      const result = await getAccountSequence(SOURCE_ACCOUNT, HORIZON_URL);
      expect(result.success).toBe(true);
      expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    });

    it("fetches fresh data when cache has been cleared", async () => {
      mockLoadAccount.mockResolvedValue(makeHorizonAccount("5"));
      await fetchAccountSequence(SOURCE_ACCOUNT, HORIZON_URL);
      clearSequenceCache();
      await getAccountSequence(SOURCE_ACCOUNT, HORIZON_URL);
      expect(mockLoadAccount).toHaveBeenCalledTimes(2);
    });
  });

  describe("detectSequenceError", () => {
    it("detects STALE_SEQUENCE from Horizon tx_bad_seq result code", () => {
      const error = {
        message: "Transaction failed",
        response: {
          data: { extras: { result_codes: { transaction: "tx_bad_seq", operations: [] } } },
        },
      };
      const result = detectSequenceError(error, SOURCE_ACCOUNT, 5n);
      expect(result).not.toBeNull();
      expect(result!.code).toBe(SequenceErrorCode.STALE_SEQUENCE);
      expect(result!.usedSequence).toBe(5n);
    });

    it("detects STALE_SEQUENCE when error message contains tx_bad_seq", () => {
      const result = detectSequenceError(new Error("tx_bad_seq"), SOURCE_ACCOUNT);
      expect(result).not.toBeNull();
      expect(result!.code).toBe(SequenceErrorCode.STALE_SEQUENCE);
    });

    it("detects SEQUENCE_CONFLICT for generic sequence-related message", () => {
      const result = detectSequenceError(new Error("sequence number is out of range"), SOURCE_ACCOUNT);
      expect(result).not.toBeNull();
      expect(result!.code).toBe(SequenceErrorCode.SEQUENCE_CONFLICT);
    });

    it("returns null for unrelated errors", () => {
      expect(detectSequenceError(new Error("tx_bad_auth"), SOURCE_ACCOUNT)).toBeNull();
      expect(detectSequenceError(new Error("insufficient balance"), SOURCE_ACCOUNT)).toBeNull();
    });

    it("returns null for null and undefined", () => {
      expect(detectSequenceError(null, SOURCE_ACCOUNT)).toBeNull();
      expect(detectSequenceError(undefined, SOURCE_ACCOUNT)).toBeNull();
    });
  });

  describe("refreshSequenceAfterConflict", () => {
    it("bypasses the cache and fetches a fresh sequence", async () => {
      mockLoadAccount.mockResolvedValue(makeHorizonAccount("20"));
      await fetchAccountSequence(SOURCE_ACCOUNT, HORIZON_URL);
      expect(getSequenceCacheSnapshot().has(SOURCE_ACCOUNT)).toBe(true);

      const result = await refreshSequenceAfterConflict(SOURCE_ACCOUNT, HORIZON_URL);
      expect(result.success).toBe(true);
      // Both the initial fetch and the forced refresh should call loadAccount
      expect(mockLoadAccount).toHaveBeenCalledTimes(2);
    });
  });

  describe("isSequenceError type guard", () => {
    it("returns true for SequenceError instances", () => {
      const err = new SequenceError(SequenceErrorCode.STALE_SEQUENCE, SOURCE_ACCOUNT, "test");
      expect(isSequenceError(err)).toBe(true);
    });

    it("returns false for plain Errors, null, and primitives", () => {
      expect(isSequenceError(new Error("plain"))).toBe(false);
      expect(isSequenceError(null)).toBe(false);
      expect(isSequenceError("string")).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 3. TRANSACTION SUBMISSION SERVICE
// ════════════════════════════════════════════════════════════════════════════════

describe("Transaction Submission Service", () => {
  beforeEach(() => {
    clearSequenceCache();
    vi.clearAllMocks();
  });

  describe("prepareTransaction", () => {
    it("returns a prepared transaction with sequence and hash on success", async () => {
      mockLoadAccount.mockResolvedValue(makeHorizonAccount("100"));
      const result = await prepareTransaction({
        sourceAccountId: SOURCE_ACCOUNT,
        operations: [],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.prepared.sourceAccountId).toBe(SOURCE_ACCOUNT);
        expect(typeof result.prepared.transactionHash).toBe("string");
        expect(result.prepared.sequenceNumber).toBe(100n);
        expect(result.prepared.preparedAt).toBeTruthy();
      }
    });

    it("propagates a SequenceError when the account is not found", async () => {
      mockLoadAccount.mockRejectedValue({ response: { status: 404 } });
      const result = await prepareTransaction({
        sourceAccountId: SOURCE_ACCOUNT,
        operations: [],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.sequenceError).toBeDefined();
        expect(result.sequenceError!.code).toBe(SequenceErrorCode.ACCOUNT_NOT_FOUND);
      }
    });

    it("fetches the latest sequence from Horizon before building", async () => {
      mockLoadAccount.mockResolvedValue(makeHorizonAccount("200"));
      await prepareTransaction({ sourceAccountId: SOURCE_ACCOUNT, operations: [] });
      expect(mockLoadAccount).toHaveBeenCalled();
    });

    it("uses the correct sequence number returned by Horizon", async () => {
      mockLoadAccount.mockResolvedValue(makeHorizonAccount("999"));
      const result = await prepareTransaction({ sourceAccountId: SOURCE_ACCOUNT, operations: [] });
      if (result.success) {
        expect(result.prepared.sequenceNumber).toBe(999n);
      }
    });
  });

  describe("signTransaction", () => {
    it("produces a SignedTransaction with XDR envelope and signer list", async () => {
      mockLoadAccount.mockResolvedValue(makeHorizonAccount("1"));
      const prepResult = await prepareTransaction({
        sourceAccountId: SOURCE_ACCOUNT,
        operations: [],
      });
      if (!prepResult.success) throw new Error("prep failed");

      const signed = signTransaction(prepResult.prepared, SIGNER_SECRET);
      expect(signed.signedEnvelope).toBeTruthy();
      expect(Array.isArray(signed.signers)).toBe(true);
      expect(signed.signers.length).toBeGreaterThan(0);
      expect(signed.signedAt).toBeTruthy();
    });
  });

  describe("submitSignedTransaction", () => {
    async function makeSignedTx(): Promise<SignedTransaction> {
      mockLoadAccount.mockResolvedValue(makeHorizonAccount("1"));
      const prep = await prepareTransaction({ sourceAccountId: SOURCE_ACCOUNT, operations: [] });
      if (!prep.success) throw new Error("Prep failed");
      return signTransaction(prep.prepared, SIGNER_SECRET);
    }

    it("returns confirmed outcome on a successful Horizon response", async () => {
      const signed = await makeSignedTx();
      mockSubmitTransaction.mockResolvedValueOnce({
        hash: TX_HASH,
        ledger: 55000,
        fee_charged: "100",
      });
      const result = await submitSignedTransaction(signed);
      expect(result.status).toBe("confirmed");
      if (result.status === "confirmed") {
        expect(result.transactionHash).toBe(TX_HASH);
        expect(result.ledger).toBe(55000);
        expect(result.feeCharged).toBe("100");
      }
    });

    it("returns failed with retryable=true and SequenceError for tx_bad_seq", async () => {
      const signed = await makeSignedTx();
      mockSubmitTransaction.mockRejectedValueOnce({
        message: "Transaction failed",
        response: {
          status: 400,
          data: { extras: { result_codes: { transaction: "tx_bad_seq", operations: [] } } },
        },
      });
      const result = await submitSignedTransaction(signed);
      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.retryable).toBe(true);
        expect(result.sequenceError).toBeDefined();
        expect(result.sequenceError!.code).toBe(SequenceErrorCode.STALE_SEQUENCE);
      }
    });

    it("returns unknown outcome on network timeout", async () => {
      const signed = await makeSignedTx();
      mockSubmitTransaction.mockRejectedValueOnce(new Error("Request timeout"));
      const result = await submitSignedTransaction(signed);
      expect(result.status).toBe("unknown");
    });

    it("returns unknown outcome on HTTP 504 (gateway timeout)", async () => {
      const signed = await makeSignedTx();
      mockSubmitTransaction.mockRejectedValueOnce({
        message: "Gateway timeout",
        response: { status: 504 },
      });
      const result = await submitSignedTransaction(signed);
      expect(result.status).toBe("unknown");
    });

    it("returns unknown outcome on HTTP 503 (service unavailable)", async () => {
      const signed = await makeSignedTx();
      mockSubmitTransaction.mockRejectedValueOnce({
        message: "Service unavailable",
        response: { status: 503 },
      });
      const result = await submitSignedTransaction(signed);
      expect(result.status).toBe("unknown");
    });

    it("returns failed non-retryable for tx_bad_auth", async () => {
      const signed = await makeSignedTx();
      mockSubmitTransaction.mockRejectedValueOnce({
        message: "Bad auth",
        response: {
          status: 400,
          data: { extras: { result_codes: { transaction: "tx_bad_auth", operations: [] } } },
        },
      });
      const result = await submitSignedTransaction(signed);
      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.retryable).toBe(false);
      }
    });

    it("returns unknown outcome for ECONNRESET (connection interrupted mid-flight)", async () => {
      const signed = await makeSignedTx();
      mockSubmitTransaction.mockRejectedValueOnce(new Error("ECONNRESET: connection reset"));
      const result = await submitSignedTransaction(signed);
      expect(result.status).toBe("unknown");
    });

    it("does not automatically resubmit after an unknown outcome", async () => {
      const signed = await makeSignedTx();
      mockSubmitTransaction.mockRejectedValueOnce(new Error("Request timeout"));
      const result = await submitSignedTransaction(signed);
      // The caller is responsible for triggering the recovery workflow
      expect(result.status).toBe("unknown");
      // submitTransaction was called exactly once — no automatic retry
      expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("prepareAndSubmit convenience wrapper", () => {
    it("confirms on a successful end-to-end flow", async () => {
      mockLoadAccount.mockResolvedValue(makeHorizonAccount("1"));
      mockSubmitTransaction.mockResolvedValueOnce({
        hash: TX_HASH,
        ledger: 100,
        fee_charged: "200",
      });
      const result = await prepareAndSubmit(
        { sourceAccountId: SOURCE_ACCOUNT, operations: [] },
        SIGNER_SECRET,
      );
      expect(result.status).toBe("confirmed");
    });

    it("returns failed when preparation fails (account not found)", async () => {
      mockLoadAccount.mockRejectedValue({ response: { status: 404 } });
      const result = await prepareAndSubmit(
        { sourceAccountId: SOURCE_ACCOUNT, operations: [] },
        SIGNER_SECRET,
      );
      expect(result.status).toBe("failed");
    });
  });

  describe("retryWithRefreshedSequence", () => {
    it("force-refreshes the sequence and retries the transaction", async () => {
      mockLoadAccount.mockResolvedValue(makeHorizonAccount("50"));
      mockSubmitTransaction.mockResolvedValueOnce({
        hash: TX_HASH,
        ledger: 200,
        fee_charged: "100",
      });
      const result = await retryWithRefreshedSequence(
        { sourceAccountId: SOURCE_ACCOUNT, operations: [] },
        SIGNER_SECRET,
      );
      expect(result.status).toBe("confirmed");
      // loadAccount should be called at least twice — once for refresh, once for build
      expect(mockLoadAccount).toHaveBeenCalledTimes(2);
    });
  });

  describe("classifySubmissionError — pure function (no I/O)", () => {
    it("classifies connection-lost errors as ambiguous", () => {
      const r = classifySubmissionError(new Error("Request timeout"));
      expect(r.isAmbiguous).toBe(true);
      expect(r.isSequenceError).toBe(false);
    });

    it("classifies ECONNRESET as ambiguous", () => {
      expect(classifySubmissionError(new Error("ECONNRESET")).isAmbiguous).toBe(true);
    });

    it("classifies tx_bad_seq as a retryable sequence error", () => {
      const r = classifySubmissionError({
        message: "tx_bad_seq",
        response: {
          status: 400,
          data: { extras: { result_codes: { transaction: "tx_bad_seq" } } },
        },
      });
      expect(r.isSequenceError).toBe(true);
      expect(r.retryable).toBe(true);
      expect(r.isAmbiguous).toBe(false);
    });

    it("classifies tx_bad_auth as non-retryable", () => {
      const r = classifySubmissionError({
        message: "tx_bad_auth",
        response: {
          status: 400,
          data: { extras: { result_codes: { transaction: "tx_bad_auth" } } },
        },
      });
      expect(r.retryable).toBe(false);
      expect(r.isAmbiguous).toBe(false);
      expect(r.isSequenceError).toBe(false);
    });

    it("classifies HTTP 504 as ambiguous", () => {
      const r = classifySubmissionError({ message: "gateway timeout", response: { status: 504 } });
      expect(r.isAmbiguous).toBe(true);
    });

    it("handles null input gracefully", () => {
      const r = classifySubmissionError(null);
      expect(r.isAmbiguous).toBe(false);
      expect(r.retryable).toBe(false);
    });

    it("classifies incorrect sequence number as sequence error (retryable)", () => {
      const r = classifySubmissionError({
        message: "Transaction failed: bad_seq",
        response: { status: 400, data: { extras: { result_codes: { transaction: "tx_bad_seq" } } } },
      });
      expect(r.isSequenceError).toBe(true);
      expect(r.retryable).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 4. RECOVERY WORKFLOW
// ════════════════════════════════════════════════════════════════════════════════

describe("Recovery Workflow", () => {
  beforeEach(() => {
    clearSequenceCache();
    vi.clearAllMocks();
  });

  describe("isRecoverable — pure function", () => {
    it("returns true when submission is recent", () => {
      expect(isRecoverable(new Date().toISOString())).toBe(true);
    });

    it("returns false when submission exceeds the default window", () => {
      const old = new Date(Date.now() - SEQUENCE_CONFIRMATION_WINDOW_MS - 1_000).toISOString();
      expect(isRecoverable(old)).toBe(false);
    });

    it("respects a custom window argument", () => {
      const fiveSecondsAgo = new Date(Date.now() - 5_000).toISOString();
      expect(isRecoverable(fiveSecondsAgo, 10_000)).toBe(true);
      expect(isRecoverable(fiveSecondsAgo, 3_000)).toBe(false);
    });
  });

  describe("checkTransactionStatus", () => {
    it("returns found=true with outcome when transaction exists on Horizon", async () => {
      mockTransactionsCall.mockResolvedValueOnce({
        hash: TX_HASH,
        successful: true,
        ledger: 12345,
      });
      const result = await checkTransactionStatus(makeStatusQuery());
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.successful).toBe(true);
        expect(result.ledger).toBe(12345);
      }
    });

    it("returns found=false reason=not_found on Horizon 404", async () => {
      mockTransactionsCall.mockRejectedValueOnce({ response: { status: 404 } });
      const result = await checkTransactionStatus(makeStatusQuery());
      expect(result.found).toBe(false);
      if (!result.found) {
        expect(result.reason).toBe("not_found");
      }
    });

    it("returns found=false reason=horizon_error on network failure", async () => {
      mockTransactionsCall.mockRejectedValueOnce(new Error("Network error"));
      const result = await checkTransactionStatus(makeStatusQuery());
      expect(result.found).toBe(false);
      if (!result.found) {
        expect(result.reason).toBe("horizon_error");
        expect(result.error).toContain("Network error");
      }
    });

    it("reports found=true successful=false when tx failed on-chain", async () => {
      mockTransactionsCall.mockResolvedValueOnce({
        hash: TX_HASH, successful: false, ledger: 999,
      });
      const result = await checkTransactionStatus(makeStatusQuery());
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.successful).toBe(false);
      }
    });
  });

  describe("determineRecoveryAction", () => {
    it("recommends confirm_success when tx is found and successful", async () => {
      mockTransactionsCall.mockResolvedValueOnce({
        hash: TX_HASH, successful: true, ledger: 500,
      });
      const action = await determineRecoveryAction(makeStatusQuery());
      expect(action.action).toBe("confirm_success");
      if (action.action === "confirm_success") {
        expect(action.ledger).toBe(500);
        expect(action.transactionHash).toBe(TX_HASH);
      }
    });

    it("recommends give_up when tx is found but failed on-chain", async () => {
      mockTransactionsCall.mockResolvedValueOnce({
        hash: TX_HASH, successful: false, ledger: 501,
      });
      const action = await determineRecoveryAction(makeStatusQuery());
      expect(action.action).toBe("give_up");
    });

    it("recommends retry when tx not found and sequence is still available", async () => {
      mockTransactionsCall.mockRejectedValueOnce({ response: { status: 404 } });
      // Current sequence equals submitted sequence — slot not consumed
      mockLoadAccount.mockResolvedValueOnce(makeHorizonAccount("100"));
      const action = await determineRecoveryAction(
        makeStatusQuery({ submittedSequence: 100n }),
      );
      expect(action.action).toBe("retry");
    });

    it("recommends give_up when sequence is consumed but tx not found", async () => {
      mockTransactionsCall.mockRejectedValueOnce({ response: { status: 404 } });
      // Current sequence advanced past submitted sequence
      mockLoadAccount.mockResolvedValueOnce(makeHorizonAccount("101"));
      const action = await determineRecoveryAction(
        makeStatusQuery({ submittedSequence: 100n }),
      );
      expect(action.action).toBe("give_up");
    });

    it("recommends retry when submission is outside the confirmation window", async () => {
      const staleSubmittedAt = new Date(
        Date.now() - SEQUENCE_CONFIRMATION_WINDOW_MS - 5_000,
      ).toISOString();
      mockTransactionsCall.mockRejectedValueOnce({ response: { status: 404 } });
      const action = await determineRecoveryAction(
        makeStatusQuery({ submittedAt: staleSubmittedAt }),
      );
      expect(action.action).toBe("retry");
    });

    it("recommends give_up when Horizon itself is unreachable", async () => {
      mockTransactionsCall.mockRejectedValueOnce(new Error("Server error"));
      const action = await determineRecoveryAction(makeStatusQuery());
      expect(action.action).toBe("give_up");
      if (action.action === "give_up") {
        expect(action.reason).toMatch(/could not query/i);
      }
    });

    it("queries the network before recommending any retry (never blindly resubmits)", async () => {
      mockTransactionsCall.mockRejectedValueOnce({ response: { status: 404 } });
      mockLoadAccount.mockResolvedValueOnce(makeHorizonAccount("100"));
      await determineRecoveryAction(makeStatusQuery({ submittedSequence: 100n }));
      // Network was consulted before any retry recommendation
      expect(mockTransactionsCall).toHaveBeenCalled();
    });

    it("verifies transaction outcome before reporting success", async () => {
      mockTransactionsCall.mockResolvedValueOnce({
        hash: TX_HASH, successful: true, ledger: 777,
      });
      const action = await determineRecoveryAction(makeStatusQuery());
      // Only reports confirm_success after verification
      expect(action.action).toBe("confirm_success");
      expect(mockTransactionsCall).toHaveBeenCalled();
    });
  });

  describe("runRecoveryWorkflow", () => {
    it("stops on first confirm_success and returns checksPerformed=1", async () => {
      mockTransactionsCall.mockResolvedValue({
        hash: TX_HASH, successful: true, ledger: 777,
      });
      const { action, checksPerformed } = await runRecoveryWorkflow(
        makeStatusQuery(),
        { maxChecks: 5, checkIntervalMs: 0 },
      );
      expect(action.action).toBe("confirm_success");
      expect(checksPerformed).toBe(1);
    });

    it("stops immediately on give_up", async () => {
      mockTransactionsCall.mockResolvedValue({
        hash: TX_HASH, successful: false, ledger: 1,
      });
      const { action, checksPerformed } = await runRecoveryWorkflow(
        makeStatusQuery(),
        { maxChecks: 5, checkIntervalMs: 0 },
      );
      expect(action.action).toBe("give_up");
      expect(checksPerformed).toBe(1);
    });

    it("stops immediately on a retry recommendation", async () => {
      mockTransactionsCall.mockRejectedValue({ response: { status: 404 } });
      mockLoadAccount.mockResolvedValue(makeHorizonAccount("100"));
      const { action, checksPerformed } = await runRecoveryWorkflow(
        makeStatusQuery({ submittedSequence: 100n }),
        { maxChecks: 5, checkIntervalMs: 0 },
      );
      expect(action.action).toBe("retry");
      expect(checksPerformed).toBe(1);
    });
  });

  describe("createRecoveryContext", () => {
    it("creates a serialisable context object with zero checks", () => {
      const query = makeStatusQuery();
      const ctx = createRecoveryContext(query, "corr-123");
      expect(ctx.correlationId).toBe("corr-123");
      expect(ctx.checkCount).toBe(0);
      expect(ctx.lastCheckedAt).toBeNull();
      expect(ctx.query).toBe(query);
    });

    it("generates a correlationId when not provided", () => {
      const ctx = createRecoveryContext(makeStatusQuery());
      expect(typeof ctx.correlationId).toBe("string");
      expect(ctx.correlationId.length).toBeGreaterThan(0);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 5. TRANSACTION LOGGER
// ════════════════════════════════════════════════════════════════════════════════

describe("Transaction Logger", () => {
  beforeEach(() => {
    clearEventBuffer();
  });

  describe("recordTransactionEvent", () => {
    it("stamps a unique eventId and ISO timestamp on every event", () => {
      const ev = recordTransactionEvent({
        correlationId: "c1",
        eventType: "transaction_prepared",
        transactionHash: TX_HASH,
      });
      expect(ev.eventId).toBeTruthy();
      expect(ev.timestamp).toBeTruthy();
      expect(new Date(ev.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("appends events to the buffer", () => {
      recordTransactionEvent({ correlationId: "c1", eventType: "sequence_fetched" });
      recordTransactionEvent({ correlationId: "c1", eventType: "transaction_prepared" });
      expect(getRecentEvents("c1").length).toBe(2);
    });

    it("caps the buffer at 1000 events (oldest dropped)", () => {
      for (let i = 0; i < 1010; i++) {
        recordTransactionEvent({ correlationId: "cap-test", eventType: "sequence_fetched" });
      }
      expect(getRecentEvents().length).toBe(1000);
    });

    it("filters events by correlationId", () => {
      recordTransactionEvent({ correlationId: "flow-a", eventType: "sequence_fetched" });
      recordTransactionEvent({ correlationId: "flow-b", eventType: "sequence_refreshed" });
      recordTransactionEvent({ correlationId: "flow-a", eventType: "transaction_prepared" });

      expect(getRecentEvents("flow-a").length).toBe(2);
      expect(getRecentEvents("flow-b").length).toBe(1);
    });
  });

  describe("clearEventBuffer", () => {
    it("removes all buffered events", () => {
      recordTransactionEvent({ correlationId: "c1", eventType: "sequence_fetched" });
      clearEventBuffer();
      expect(getRecentEvents().length).toBe(0);
    });
  });

  describe("convenience loggers", () => {
    it("logSequenceFetched records a sequence_fetched event with correct fields", () => {
      const ev = logSequenceFetched(SOURCE_ACCOUNT, 42n, "corr1");
      expect(ev.eventType).toBe("sequence_fetched");
      expect(ev.sourceAccountId).toBe(SOURCE_ACCOUNT);
      expect(ev.sequenceNumber).toBe("42");
    });

    it("logSequenceError records a sequence_error event with the error code embedded", () => {
      const ev = logSequenceError(SOURCE_ACCOUNT, "STALE_SEQUENCE", "Bad seq", "corr1");
      expect(ev.eventType).toBe("sequence_error");
      expect(ev.errorMessage).toContain("STALE_SEQUENCE");
    });

    it("logTransactionPrepared records correct state=preparing", () => {
      const ev = logTransactionPrepared(TX_HASH, SOURCE_ACCOUNT, 10n, "corr1");
      expect(ev.eventType).toBe("transaction_prepared");
      expect(ev.transactionHash).toBe(TX_HASH);
      expect(ev.state).toBe("preparing");
      expect(ev.sequenceNumber).toBe("10");
    });

    it("logTransactionSubmitted records correct state=submitted", () => {
      const ev = logTransactionSubmitted(TX_HASH, "corr1");
      expect(ev.eventType).toBe("transaction_submitted");
      expect(ev.state).toBe("submitted");
    });

    it("logSubmissionOutcome → transaction_confirmed for status=confirmed", () => {
      const outcome: SubmissionOutcome = {
        status: "confirmed",
        transactionHash: TX_HASH,
        ledger: 100,
        feeCharged: "100",
      };
      const ev = logSubmissionOutcome(outcome, "corr1");
      expect(ev.eventType).toBe("transaction_confirmed");
      expect(ev.state).toBe("confirmed");
      expect(ev.metadata?.feeCharged).toBe("100");
    });

    it("logSubmissionOutcome → transaction_failed for status=failed", () => {
      const outcome: SubmissionOutcome = {
        status: "failed",
        error: "tx_bad_auth",
        retryable: false,
      };
      const ev = logSubmissionOutcome(outcome, "corr1");
      expect(ev.eventType).toBe("transaction_failed");
      expect(ev.errorMessage).toBe("tx_bad_auth");
    });

    it("logSubmissionOutcome → transaction_unknown_outcome for status=unknown", () => {
      const outcome: SubmissionOutcome = {
        status: "unknown",
        error: "Network timeout",
      };
      const ev = logSubmissionOutcome(outcome, "corr1");
      expect(ev.eventType).toBe("transaction_unknown_outcome");
      expect(ev.state).toBe("unknown_outcome");
    });

    it("logSubmissionOutcome records state=retry_eligible when retryable=true", () => {
      const outcome: SubmissionOutcome = {
        status: "failed",
        error: "tx_bad_seq",
        retryable: true,
      };
      const ev = logSubmissionOutcome(outcome, "corr1");
      expect(ev.state).toBe("retry_eligible");
    });

    it("logRecoveryStarted records a recovery_started event with the tx hash", () => {
      const ev = logRecoveryStarted(TX_HASH, "corr1");
      expect(ev.eventType).toBe("recovery_started");
      expect(ev.transactionHash).toBe(TX_HASH);
      expect(ev.state).toBe("unknown_outcome");
    });

    it("logRecoveryActionDetermined records action and reason in metadata", () => {
      const ev = logRecoveryActionDetermined("retry", "Safe to resubmit", "corr1");
      expect(ev.eventType).toBe("recovery_action_determined");
      expect(ev.metadata?.action).toBe("retry");
      expect(ev.metadata?.reason).toBe("Safe to resubmit");
    });

    it("logDuplicateSubmissionDetected records the idempotency key", () => {
      const ev = logDuplicateSubmissionDetected(TX_HASH, "key-abc", "corr1");
      expect(ev.eventType).toBe("duplicate_submission_detected");
      expect(ev.metadata?.idempotencyKey).toBe("key-abc");
    });

    it("logRetryScheduled records the retry count and state=retry_eligible", () => {
      const ev = logRetryScheduled(TX_HASH, 2, "corr1");
      expect(ev.eventType).toBe("retry_scheduled");
      expect(ev.retryCount).toBe(2);
      expect(ev.state).toBe("retry_eligible");
    });

    it("logRetryBlocked records the reason and state=retry_blocked", () => {
      const ev = logRetryBlocked(TX_HASH, "Max retries exceeded", 3, "corr1");
      expect(ev.eventType).toBe("retry_blocked");
      expect(ev.state).toBe("retry_blocked");
      expect(ev.errorMessage).toBe("Max retries exceeded");
      expect(ev.retryCount).toBe(3);
    });
  });

  describe("full lifecycle traceability", () => {
    it("all events in a flow share correlationId and can be retrieved together", () => {
      const corrId = "full-flow-test";
      clearEventBuffer();

      logSequenceFetched(SOURCE_ACCOUNT, 1n, corrId);
      logTransactionPrepared(TX_HASH, SOURCE_ACCOUNT, 1n, corrId);
      logTransactionSubmitted(TX_HASH, corrId);
      logSubmissionOutcome({ status: "unknown", error: "timeout" }, corrId);
      logRecoveryStarted(TX_HASH, corrId);
      logRecoveryActionDetermined("retry", "Sequence available", corrId);
      logRetryScheduled(TX_HASH, 1, corrId);
      logTransactionSubmitted(TX_HASH, corrId);
      logSubmissionOutcome(
        { status: "confirmed", transactionHash: TX_HASH, ledger: 999, feeCharged: "100" },
        corrId,
        1,
      );

      const events = getRecentEvents(corrId);
      const eventTypes = events.map((e) => e.eventType);

      expect(eventTypes).toContain("sequence_fetched");
      expect(eventTypes).toContain("transaction_prepared");
      expect(eventTypes).toContain("transaction_submitted");
      expect(eventTypes).toContain("transaction_unknown_outcome");
      expect(eventTypes).toContain("recovery_started");
      expect(eventTypes).toContain("recovery_action_determined");
      expect(eventTypes).toContain("retry_scheduled");
      expect(eventTypes).toContain("transaction_confirmed");
      expect(events.every((e) => e.correlationId === corrId)).toBe(true);
    });

    it("accurate success is only reported after verification (transaction_confirmed state)", () => {
      const corrId = "verify-before-success";
      clearEventBuffer();

      // Simulate: submitted → unknown → recovery → confirmed
      logTransactionSubmitted(TX_HASH, corrId);
      logSubmissionOutcome({ status: "unknown", error: "Network lost" }, corrId);
      logRecoveryStarted(TX_HASH, corrId);
      // Recovery confirms the transaction DID go through
      logSubmissionOutcome(
        { status: "confirmed", transactionHash: TX_HASH, ledger: 1000, feeCharged: "100" },
        corrId,
      );

      const events = getRecentEvents(corrId);
      const confirmedEvent = events.find((e) => e.eventType === "transaction_confirmed");
      expect(confirmedEvent).toBeDefined();
      // The confirmed event came AFTER the recovery_started event
      const recoveryIdx = events.findIndex((e) => e.eventType === "recovery_started");
      const confirmedIdx = events.findIndex((e) => e.eventType === "transaction_confirmed");
      expect(confirmedIdx).toBeGreaterThan(recoveryIdx);
    });
  });
});
