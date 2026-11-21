import { describe, it, expect } from "vitest";
import {
  buildVerificationResult,
  classifyTransactionStatus,
  isValidTransactionHash,
} from "./transaction-verification";
import type { StellarTransaction } from "@/types/blockchain";

const VALID_HASH = "a".repeat(64);

function makeTransaction(
  overrides: Partial<StellarTransaction> = {},
): StellarTransaction {
  return {
    hash: VALID_HASH,
    memo: "aca_c_123",
    ledger: 123,
    created_at: "2026-06-23T00:00:00.000Z",
    successful: true,
    ...overrides,
  };
}

describe("Stellar transaction verification", () => {
  describe("isValidTransactionHash", () => {
    it("accepts 64-character hex transaction hashes", () => {
      expect(isValidTransactionHash(VALID_HASH)).toBe(true);
    });

    it("rejects malformed transaction hashes", () => {
      expect(isValidTransactionHash("not-a-stellar-transaction")).toBe(false);
      expect(isValidTransactionHash("g".repeat(64))).toBe(false);
      expect(isValidTransactionHash("a".repeat(63))).toBe(false);
    });
  });

  describe("classifyTransactionStatus", () => {
    it("classifies successful confirmed transactions", () => {
      expect(classifyTransactionStatus(makeTransaction({ successful: true }))).toBe(
        "successful",
      );
    });

    it("classifies failed confirmed transactions", () => {
      expect(classifyTransactionStatus(makeTransaction({ successful: false }))).toBe(
        "failed",
      );
    });

    it("classifies missing transactions as pending", () => {
      expect(classifyTransactionStatus(null)).toBe("pending");
    });
  });

  describe("buildVerificationResult", () => {
    it("marks matching successful transactions as verified", () => {
      const result = buildVerificationResult({
        transactionHash: VALID_HASH,
        transaction: makeTransaction(),
        groupActionEventId: "65b7f44e-d8ca-44f3-afb7-5ec32327ff4a",
        groupId: "room_1",
        expectedMemo: "aca_c_123",
        now: new Date("2026-06-23T00:00:00.000Z"),
      });

      expect(result.verified).toBe(true);
      expect(result.status).toBe("successful");
      expect(result.error).toBeNull();
      expect(result.verifiedAt).toBe("2026-06-23T00:00:00.000Z");
    });

    it("rejects failed transactions", () => {
      const result = buildVerificationResult({
        transactionHash: VALID_HASH,
        transaction: makeTransaction({ successful: false }),
      });

      expect(result.verified).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error).toBe("Stellar transaction failed");
    });

    it("rejects pending transactions", () => {
      const result = buildVerificationResult({
        transactionHash: VALID_HASH,
        transaction: null,
      });

      expect(result.verified).toBe(false);
      expect(result.status).toBe("pending");
      expect(result.error).toBe("Stellar transaction is pending or not found");
    });

    it("rejects successful transactions with mismatched memos", () => {
      const result = buildVerificationResult({
        transactionHash: VALID_HASH,
        transaction: makeTransaction({ memo: "aca_j_456" }),
        expectedMemo: "aca_c_123",
      });

      expect(result.verified).toBe(false);
      expect(result.status).toBe("successful");
      expect(result.error).toBe(
        "Transaction memo does not match the expected group action",
      );
    });

    it("returns an invalid status for malformed transaction hashes", () => {
      const result = buildVerificationResult({
        transactionHash: "bad-hash",
        transaction: null,
      });

      expect(result.verified).toBe(false);
      expect(result.status).toBe("invalid");
      expect(result.error).toBe("Invalid Stellar transaction hash");
    });
  });
});
