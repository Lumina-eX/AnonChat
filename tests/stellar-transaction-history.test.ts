import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isAnonChatTransaction,
  formatStroopsToXlm,
  classifyActionType,
  isRelevantAnonChatTransaction,
  parseHorizonTransaction,
  fetchWalletTransactionHistory,
  getHorizonServerConfig,
} from "@/lib/blockchain/stellar-history";
import { deriveMemoGroupId } from "@/lib/blockchain/memo";
import { GET } from "@/app/api/stellar/transactions/history/route";
import { NextRequest } from "next/server";

// Sample test data
const TEST_WALLET = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const VALID_MEMO = deriveMemoGroupId("room_1714000000000_abc123xyz"); // grp_...
const NON_ANON_MEMO = "Invoice-12345";

describe("Stellar Transaction History Service", () => {
  describe("isAnonChatTransaction", () => {
    it("identifies valid deterministic AnonChat memos", () => {
      expect(isAnonChatTransaction(VALID_MEMO)).toBe(true);
      expect(isAnonChatTransaction("grp_1234567890abcdef12345678")).toBe(true);
    });

    it("rejects non-AnonChat memos and empty values", () => {
      expect(isAnonChatTransaction(NON_ANON_MEMO)).toBe(false);
      expect(isAnonChatTransaction(null)).toBe(false);
      expect(isAnonChatTransaction(undefined)).toBe(false);
      expect(isAnonChatTransaction("")).toBe(false);
      expect(isAnonChatTransaction("stellar_payment")).toBe(false);
    });

    it("identifies AnonChat action memos used for group activity", () => {
      expect(isAnonChatTransaction("aca_c_123")).toBe(true);
      expect(isAnonChatTransaction("aca_j_456")).toBe(true);
      expect(isAnonChatTransaction("aca_m_789")).toBe(true);
      expect(isAnonChatTransaction("aca_x_abc")).toBe(true);
    });
  });

  describe("formatStroopsToXlm", () => {
    it("correctly converts base stroops to XLM format", () => {
      expect(formatStroopsToXlm(100)).toBe("0.0000100");
      expect(formatStroopsToXlm("100")).toBe("0.0000100");
      expect(formatStroopsToXlm(10_000_000)).toBe("1.0000000");
      expect(formatStroopsToXlm(500_000)).toBe("0.0500000");
      expect(formatStroopsToXlm(0)).toBe("0.0000100");
    });
  });

  describe("classifyActionType", () => {
    it("classifies AnonChat memo transactions as group_creation / anchoring", () => {
      const result = classifyActionType(VALID_MEMO, true, 1);
      expect(result.actionType).toBe("group_creation");
      expect(result.actionLabel).toBe("Group Anchoring / Audit");
    });

    it("classifies action memo prefixes into relevant categories", () => {
      expect(classifyActionType("aca_c_123", true, 1)).toEqual({
        actionType: "group_creation",
        actionLabel: "Group Action",
      });
      expect(classifyActionType("aca_j_123", true, 1)).toEqual({
        actionType: "audit_log",
        actionLabel: "Audit Event",
      });
      expect(classifyActionType("aca_m_123", true, 1)).toEqual({
        actionType: "metadata_anchor",
        actionLabel: "Metadata Anchor",
      });
      expect(classifyActionType("aca_p_123", true, 1)).toEqual({
        actionType: "payment",
        actionLabel: "Payment",
      });
      expect(classifyActionType("aca_x_123", true, 1)).toEqual({
        actionType: "contract_call",
        actionLabel: "Contract Call",
      });
    });

    it("classifies multi-operation transactions as batch", () => {
      const result = classifyActionType(null, true, 3);
      expect(result.actionType).toBe("general");
      expect(result.actionLabel).toBe("Batch (3 ops)");
    });

    it("classifies failed transactions clearly", () => {
      const result = classifyActionType(null, false, 1);
      expect(result.actionType).toBe("general");
      expect(result.actionLabel).toBe("Failed Transaction");
    });
  });

  describe("parseHorizonTransaction", () => {
    it("parses a successful Horizon record with AnonChat memo", () => {
      const rawRecord = {
        id: "tx-1",
        hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        ledger_attr: 1234567,
        created_at: "2026-08-27T10:00:00Z",
        successful: true,
        memo: VALID_MEMO,
        memo_type: "text",
        fee_charged: "100",
        source_account: TEST_WALLET,
        operation_count: 1,
        paging_token: "pt_12345",
      };

      const parsed = parseHorizonTransaction(rawRecord, "testnet");

      expect(parsed.hash).toBe(rawRecord.hash);
      expect(parsed.status).toBe("successful");
      expect(parsed.successful).toBe(true);
      expect(parsed.isAnonChat).toBe(true);
      expect(parsed.actionType).toBe("group_creation");
      expect(parsed.feeChargedXlm).toBe("0.0000100");
      expect(parsed.explorerUrl).toContain("stellar.expert/explorer/testnet/tx/");
      expect(parsed.errorMessage).toBeNull();
    });

    it("parses a failed Horizon record and extracts error message", () => {
      const rawRecord = {
        id: "tx-failed",
        hash: "f3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b899",
        ledger_attr: 1234568,
        created_at: "2026-08-27T10:05:00Z",
        successful: false,
        result_xdr: "AAAA...",
        memo: null,
        memo_type: "none",
        fee_charged: "200",
        source_account: TEST_WALLET,
        operation_count: 1,
        paging_token: "pt_12346",
      };

      const parsed = parseHorizonTransaction(rawRecord, "mainnet");

      expect(parsed.status).toBe("failed");
      expect(parsed.successful).toBe(false);
      expect(parsed.isAnonChat).toBe(false);
      expect(parsed.errorMessage).toBe("Transaction failed on Stellar network");
      expect(parsed.explorerUrl).toContain("stellar.expert/explorer/public/tx/");
    });

    it("uses Horizon result codes for failed transaction errors", () => {
      const rawRecord = {
        id: "tx-failed-codes",
        hash: "d3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b800",
        ledger_attr: 1234569,
        created_at: "2026-08-27T10:10:00Z",
        successful: false,
        result_codes: { transaction: "tx_bad_auth" },
        memo: null,
        memo_type: "none",
        fee_charged: "200",
        source_account: TEST_WALLET,
        operation_count: 1,
        paging_token: "pt_12347",
      };

      const parsed = parseHorizonTransaction(rawRecord, "testnet");

      expect(parsed.errorMessage).toBe("Transaction failed: tx_bad_auth");
    });

    it("marks action memo transactions as relevant AnonChat transactions", () => {
      const parsed = parseHorizonTransaction(
        {
          id: "tx-action",
          hash: "c3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b811",
          ledger_attr: 1234570,
          created_at: "2026-08-27T10:15:00Z",
          successful: true,
          memo: "aca_j_456",
          memo_type: "text",
          fee_charged: "100",
          source_account: TEST_WALLET,
          operation_count: 1,
          paging_token: "pt_12348",
        },
        "testnet",
      );

      expect(parsed.isAnonChat).toBe(true);
      expect(parsed.actionType).toBe("audit_log");
      expect(parsed.actionLabel).toBe("Audit Event");
      expect(isRelevantAnonChatTransaction(parsed)).toBe(true);
    });
  });

  describe("API Route GET /api/stellar/transactions/history", () => {
    it("returns 400 if walletAddress is missing", async () => {
      const req = new NextRequest("http://localhost:3000/api/stellar/transactions/history");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("walletAddress query parameter is required");
    });

    it("returns 400 if walletAddress is invalid", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/stellar/transactions/history?walletAddress=invalid_key",
      );
      const res = await GET(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid Stellar wallet address format");
    });
  });
});
