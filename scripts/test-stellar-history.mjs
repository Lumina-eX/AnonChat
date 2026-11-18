#!/usr/bin/env node
/**
 * Unit tests for Stellar transaction history parsing, classification, and filtering.
 * Run with: node --test scripts/test-stellar-history.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";

const ANONCHAT_MEMO_PATTERN = /^grp_[a-f0-9]{24}$/;
const STROOPS_PER_XLM = 10_000_000;

function deriveMemoGroupId(roomId) {
  const normalizedRoomId = roomId.trim();
  const hash = createHash("sha256").update(normalizedRoomId).digest("hex");
  return `grp_${hash.substring(0, 24)}`;
}

function isAnonChatTransaction(memo) {
  if (!memo || typeof memo !== "string") return false;
  const trimmed = memo.trim();
  return ANONCHAT_MEMO_PATTERN.test(trimmed) || trimmed.startsWith("grp_");
}

function formatStroopsToXlm(stroops) {
  const stroopsNum = typeof stroops === "string" ? parseInt(stroops, 10) : stroops;
  if (isNaN(stroopsNum) || stroopsNum <= 0) return "0.0000100";
  const xlm = stroopsNum / STROOPS_PER_XLM;
  return xlm.toFixed(7);
}

function classifyActionType(memo, successful, operationCount) {
  if (isAnonChatTransaction(memo)) {
    return {
      actionType: "group_creation",
      actionLabel: "Group Anchoring / Audit",
    };
  }

  if (operationCount > 1) {
    return {
      actionType: "general",
      actionLabel: `Batch (${operationCount} ops)`,
    };
  }

  return {
    actionType: "general",
    actionLabel: successful ? "Stellar Transaction" : "Failed Transaction",
  };
}

function getExplorerUrl(txHash, network) {
  const baseUrl =
    network === "testnet"
      ? "https://stellar.expert/explorer/testnet/tx"
      : "https://stellar.expert/explorer/public/tx";
  return `${baseUrl}/${txHash}`;
}

function parseHorizonTransaction(tx, network) {
  const hash = tx.hash || "";
  const ledger = tx.ledger_attr || tx.ledger || 0;
  const createdAt = tx.created_at || new Date().toISOString();
  const successful = Boolean(tx.successful);
  const status = successful ? "successful" : "failed";
  const memo = tx.memo || null;
  const memoType = tx.memo_type || null;
  const isAnon = isAnonChatTransaction(memo);
  const operationCount = tx.operation_count || 1;
  const { actionType, actionLabel } = classifyActionType(memo, successful, operationCount);

  const feeChargedStroops = String(tx.fee_charged || "100");
  const feeChargedXlm = formatStroopsToXlm(feeChargedStroops);
  const sourceAccount = tx.source_account || "";
  const explorerUrl = getExplorerUrl(hash, network);
  const pagingToken = tx.paging_token || "";

  let errorMessage = null;
  if (!successful) {
    errorMessage = tx.result_xdr
      ? "Transaction execution rejected on ledger"
      : "Transaction failed on Stellar network";
  }

  return {
    id: tx.id || hash,
    hash,
    ledger,
    createdAt,
    status,
    successful,
    memo,
    memoType,
    isAnonChat: isAnon,
    actionType,
    actionLabel,
    feeChargedXlm,
    feeChargedStroops,
    sourceAccount,
    operationCount,
    explorerUrl,
    errorMessage,
    pagingToken,
  };
}

const TEST_WALLET = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const VALID_MEMO = deriveMemoGroupId("room_1714000000000_abc123xyz");

describe("Stellar Transaction History Service", () => {
  describe("isAnonChatTransaction", () => {
    it("identifies valid deterministic AnonChat memos", () => {
      assert.equal(isAnonChatTransaction(VALID_MEMO), true);
      assert.equal(isAnonChatTransaction("grp_1234567890abcdef12345678"), true);
    });

    it("rejects non-AnonChat memos and empty values", () => {
      assert.equal(isAnonChatTransaction("Invoice-12345"), false);
      assert.equal(isAnonChatTransaction(null), false);
      assert.equal(isAnonChatTransaction(undefined), false);
      assert.equal(isAnonChatTransaction(""), false);
      assert.equal(isAnonChatTransaction("stellar_payment"), false);
    });
  });

  describe("formatStroopsToXlm", () => {
    it("correctly converts base stroops to XLM format", () => {
      assert.equal(formatStroopsToXlm(100), "0.0000100");
      assert.equal(formatStroopsToXlm("100"), "0.0000100");
      assert.equal(formatStroopsToXlm(10_000_000), "1.0000000");
      assert.equal(formatStroopsToXlm(500_000), "0.0500000");
      assert.equal(formatStroopsToXlm(0), "0.0000100");
    });
  });

  describe("classifyActionType", () => {
    it("classifies AnonChat memo transactions as group_creation / anchoring", () => {
      const result = classifyActionType(VALID_MEMO, true, 1);
      assert.equal(result.actionType, "group_creation");
      assert.equal(result.actionLabel, "Group Anchoring / Audit");
    });

    it("classifies multi-operation transactions as batch", () => {
      const result = classifyActionType(null, true, 3);
      assert.equal(result.actionType, "general");
      assert.equal(result.actionLabel, "Batch (3 ops)");
    });

    it("classifies failed transactions clearly", () => {
      const result = classifyActionType(null, false, 1);
      assert.equal(result.actionType, "general");
      assert.equal(result.actionLabel, "Failed Transaction");
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

      assert.equal(parsed.hash, rawRecord.hash);
      assert.equal(parsed.status, "successful");
      assert.equal(parsed.successful, true);
      assert.equal(parsed.isAnonChat, true);
      assert.equal(parsed.actionType, "group_creation");
      assert.equal(parsed.feeChargedXlm, "0.0000100");
      assert.ok(parsed.explorerUrl.includes("stellar.expert/explorer/testnet/tx/"));
      assert.equal(parsed.errorMessage, null);
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

      assert.equal(parsed.status, "failed");
      assert.equal(parsed.successful, false);
      assert.equal(parsed.isAnonChat, false);
      assert.equal(parsed.errorMessage, "Transaction execution rejected on ledger");
      assert.ok(parsed.explorerUrl.includes("stellar.expert/explorer/public/tx/"));
    });
  });
});
