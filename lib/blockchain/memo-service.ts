/**
 * Stellar Memo ↔ Group ID Service
 *
 * Leverages Stellar's native memo field to embed a group reference ID in
 * every on-chain interaction.  The memo is the canonical link between an
 * AnonChat group and its Stellar transaction history.
 *
 * Memo constraints (Stellar protocol):
 *   - MEMO_TEXT  : UTF-8, max 28 bytes
 *   - MEMO_HASH  : 32-byte binary (hex-encoded SHA-256 of the group ID)
 *
 * Strategy used here:
 *   - If the group ID fits in 28 bytes → MEMO_TEXT  (human-readable)
 *   - Otherwise                        → MEMO_HASH  (SHA-256 of group ID)
 *
 * A DB mapping (group_memo_transactions table) is maintained so that any
 * transaction hash can be resolved back to its group ID without hitting
 * the Stellar network.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { createHash } from "crypto";
import { loadStellarConfig, isConfigured, getExplorerUrl } from "./stellar-config";
import { logBlockchainOperation, generateCorrelationId } from "./logger";
import {
  MemoTransactionResult,
  MemoValidationResult,
  GroupMemoRecord,
} from "@/types/blockchain";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum byte length for MEMO_TEXT on Stellar */
export const MEMO_TEXT_MAX_BYTES = 28;

// ── Memo helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the byte length of a UTF-8 string.
 */
function byteLength(str: string): number {
  return Buffer.byteLength(str, "utf8");
}

/**
 * Builds the appropriate Stellar Memo for a given group ID.
 *
 * - If the group ID is ≤ 28 bytes (UTF-8) → Memo.text
 * - Otherwise → Memo.hash (SHA-256 of the group ID, 32 bytes)
 *
 * @returns { memo, memoValue, memoType }
 */
export function buildGroupMemo(groupId: string): {
  memo: StellarSdk.Memo;
  memoValue: string;
  memoType: "text" | "hash";
} {
  if (byteLength(groupId) <= MEMO_TEXT_MAX_BYTES) {
    return {
      memo: StellarSdk.Memo.text(groupId),
      memoValue: groupId,
      memoType: "text",
    };
  }

  // Fall back to SHA-256 hash (32 bytes binary → Memo.hash)
  const hashHex = createHash("sha256").update(groupId).digest("hex");
  const hashBuffer = Buffer.from(hashHex, "hex");

  return {
    memo: StellarSdk.Memo.hash(hashBuffer.toString("base64")),
    memoValue: hashHex,
    memoType: "hash",
  };
}

/**
 * Validates that a raw memo value is consistent with a given group ID.
 *
 * - For text memos  : memoValue must equal groupId
 * - For hash memos  : memoValue must equal SHA-256(groupId)
 */
export function validateMemoForGroup(
  groupId: string,
  memoValue: string,
  memoType: "text" | "hash"
): MemoValidationResult {
  if (!groupId || !memoValue) {
    return { valid: false, reason: "groupId and memoValue are required" };
  }

  if (memoType === "text") {
    const valid = memoValue === groupId;
    return valid
      ? { valid: true, groupId, memoValue }
      : {
          valid: false,
          reason: `Memo text "${memoValue}" does not match group ID "${groupId}"`,
        };
  }

  // hash memo: compare against SHA-256 of groupId
  const expected = createHash("sha256").update(groupId).digest("hex");
  const valid = memoValue.toLowerCase() === expected.toLowerCase();
  return valid
    ? { valid: true, groupId, memoValue }
    : {
        valid: false,
        reason: "Memo hash does not match SHA-256 of the group ID",
      };
}

// ── On-chain submission ───────────────────────────────────────────────────────

/**
 * Submits a Stellar transaction whose memo field is the group ID (or its
 * SHA-256 hash when the ID exceeds 28 bytes).
 *
 * This is a lightweight self-payment (0.0000001 XLM) whose sole purpose is
 * to anchor the group ID on-chain.
 *
 * @param groupId  - The AnonChat group / room ID
 * @param maxFee   - Optional fee override in stroops
 */
export async function submitGroupMemoTransaction(
  groupId: string,
  maxFee?: string | number
): Promise<MemoTransactionResult> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  if (!groupId || groupId.trim() === "") {
    return { success: false, error: "groupId is required" };
  }

  if (!isConfigured()) {
    logBlockchainOperation(
      "warn",
      "Skipping memo transaction – Stellar config missing",
      { groupId },
      correlationId
    );
    return { success: false, error: "Stellar configuration not available" };
  }

  const config = loadStellarConfig();
  if (!config) {
    return { success: false, error: "Failed to load Stellar configuration" };
  }

  const { memo, memoValue, memoType } = buildGroupMemo(groupId);

  logBlockchainOperation(
    "info",
    "Submitting group memo transaction",
    { groupId, memoValue, memoType, network: config.network },
    correlationId
  );

  try {
    const server = new StellarSdk.Horizon.Server(config.horizonUrl);
    const sourceKeypair = StellarSdk.Keypair.fromSecret(config.sourceSecret);
    const sourcePublicKey = sourceKeypair.publicKey();

    const account = await Promise.race([
      server.loadAccount(sourcePublicKey),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout loading account")),
          config.transactionTimeout
        )
      ),
    ]);

    const feeToUse = maxFee ? maxFee.toString() : StellarSdk.BASE_FEE;

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: feeToUse,
      networkPassphrase:
        config.network === "testnet"
          ? StellarSdk.Networks.TESTNET
          : StellarSdk.Networks.PUBLIC,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: sourcePublicKey, // self-payment
          asset: StellarSdk.Asset.native(),
          amount: "0.0000001",
        })
      )
      .addMemo(memo)
      .setTimeout(30)
      .build();

    transaction.sign(sourceKeypair);

    const result = await Promise.race([
      server.submitTransaction(transaction),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Transaction submission timeout")),
          config.transactionTimeout
        )
      ),
    ]);

    const duration = Date.now() - startTime;
    const feeCharged =
      (result as any).fee_charged?.toString() ?? feeToUse.toString();

    logBlockchainOperation(
      "info",
      "Group memo transaction successful",
      {
        groupId,
        memoValue,
        memoType,
        transactionHash: result.hash,
        feeCharged,
        duration,
      },
      correlationId
    );

    return {
      success: true,
      transactionHash: result.hash,
      memoValue,
      memoType,
      feeCharged,
      explorerUrl: getExplorerUrl(result.hash, config.network),
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;

    logBlockchainOperation(
      "error",
      "Group memo transaction failed",
      {
        groupId,
        memoValue,
        memoType,
        duration,
        error: {
          type: error.name ?? "UnknownError",
          message: error.message ?? "Unknown error",
        },
      },
      correlationId
    );

    return { success: false, error: error.message ?? "Transaction failed" };
  }
}

/**
 * Resolves a Stellar transaction hash back to its embedded memo value.
 * Fetches the transaction from Horizon and returns the memo.
 *
 * @param txHash - Stellar transaction hash
 */
export async function resolveMemoFromTransaction(
  txHash: string
): Promise<{ memoValue: string | null; memoType: string | null }> {
  const correlationId = generateCorrelationId();

  if (!isConfigured()) {
    return { memoValue: null, memoType: null };
  }

  const config = loadStellarConfig();
  if (!config) return { memoValue: null, memoType: null };

  try {
    const server = new StellarSdk.Horizon.Server(config.horizonUrl);
    const tx = await Promise.race([
      server.transactions().transaction(txHash).call(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout")),
          config.transactionTimeout
        )
      ),
    ]);

    return {
      memoValue: tx.memo ?? null,
      memoType: tx.memo_type ?? null,
    };
  } catch (error: any) {
    logBlockchainOperation(
      "error",
      "Failed to resolve memo from transaction",
      {
        transactionHash: txHash,
        error: { type: error.name, message: error.message },
      },
      correlationId
    );
    return { memoValue: null, memoType: null };
  }
}
