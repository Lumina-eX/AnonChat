/**
 * Memo Service — Group ID ↔ Transaction Mapping
 *
 * Responsibilities:
 *  1. Submit a Stellar transaction whose memo encodes the group ID
 *  2. Persist the groupId ↔ txHash mapping in the DB
 *  3. Validate memo integrity on retrieval
 *  4. Provide lookup helpers for controllers
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { SupabaseClient } from "@supabase/supabase-js";
import { loadStellarConfig, isConfigured, getExplorerUrl } from "./stellar-config";
import { logBlockchainOperation, generateCorrelationId } from "./logger";
import { buildGroupMemo, validateGroupMemo, MemoStrategy } from "./memo";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MemoSubmissionResult {
  success: boolean;
  txHash?: string;
  memoValue?: string;
  memoType?: MemoStrategy;
  explorerUrl?: string;
  feeCharged?: string;
  error?: string;
}

export interface MemoRecord {
  id: string;
  group_id: string;
  tx_hash: string;
  memo_value: string;
  memo_type: MemoStrategy;
  submitted_at: string;
  verified_at: string | null;
  is_valid: boolean;
}

export interface MemoValidationResult {
  groupId: string;
  txHash: string;
  memoValue: string;
  memoType: MemoStrategy;
  isValid: boolean;
  verifiedAt: string | null;
}

// ── Core service functions ────────────────────────────────────────────────────

/**
 * Submits a Stellar transaction with the group ID embedded in the memo field,
 * then persists the groupId ↔ txHash mapping in the database.
 *
 * @param groupId   - The room/group ID to embed
 * @param supabase  - Supabase client (service-role recommended for DB writes)
 * @param userId    - Optional user ID for audit trail
 * @param maxFee    - Optional custom fee in stroops
 */
export async function submitGroupMemoTransaction(
  groupId: string,
  supabase: SupabaseClient,
  userId?: string,
  maxFee?: string | number
): Promise<MemoSubmissionResult> {
  const correlationId = generateCorrelationId();

  if (!isConfigured()) {
    logBlockchainOperation(
      "warn",
      "Skipping memo transaction — Stellar config missing",
      { groupId },
      correlationId
    );
    return { success: false, error: "Stellar configuration not available" };
  }

  const config = loadStellarConfig();
  if (!config) {
    return { success: false, error: "Failed to load Stellar configuration" };
  }

  // Build the memo
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
          destination: sourcePublicKey, // self-payment — minimal cost
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

    const txHash = result.hash;
    const feeCharged = (result as any).fee_charged?.toString() ?? feeToUse.toString();
    const explorerUrl = getExplorerUrl(txHash, config.network);

    logBlockchainOperation(
      "info",
      "Group memo transaction submitted",
      { groupId, txHash, memoValue, memoType, feeCharged },
      correlationId
    );

    // Persist the mapping in the DB
    const { error: dbError } = await supabase.from("group_tx_memo_map").insert({
      group_id: groupId,
      tx_hash: txHash,
      memo_value: memoValue,
      memo_type: memoType,
      is_valid: true,
      verified_at: new Date().toISOString(),
      created_by: userId ?? null,
    });

    if (dbError) {
      // Non-fatal: log but still return success since the tx is on-chain
      logBlockchainOperation(
        "warn",
        "Failed to persist memo mapping in DB",
        { groupId, txHash, error: { type: "DBError", message: dbError.message } },
        correlationId
      );
    }

    return {
      success: true,
      txHash,
      memoValue,
      memoType,
      explorerUrl,
      feeCharged,
    };
  } catch (error: any) {
    logBlockchainOperation(
      "error",
      "Group memo transaction failed",
      {
        groupId,
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
 * Validates the memo integrity of a stored mapping record.
 * Re-checks that the stored memo_value is consistent with the group_id.
 *
 * @param record - A row from group_tx_memo_map
 * @returns MemoValidationResult
 */
export function validateMemoRecord(record: MemoRecord): MemoValidationResult {
  const isValid = validateGroupMemo(
    record.memo_value,
    record.memo_type as MemoStrategy,
    record.group_id
  );

  return {
    groupId: record.group_id,
    txHash: record.tx_hash,
    memoValue: record.memo_value,
    memoType: record.memo_type as MemoStrategy,
    isValid,
    verifiedAt: record.verified_at,
  };
}

/**
 * Looks up all memo mappings for a given group ID.
 *
 * @param groupId  - The room/group ID
 * @param supabase - Supabase client
 * @returns Array of MemoRecord rows, newest first
 */
export async function getMemosByGroupId(
  groupId: string,
  supabase: SupabaseClient
): Promise<MemoRecord[]> {
  const { data, error } = await supabase
    .from("group_tx_memo_map")
    .select("*")
    .eq("group_id", groupId)
    .order("submitted_at", { ascending: false });

  if (error) {
    logBlockchainOperation("error", "Failed to fetch memo mappings", {
      groupId,
      error: { type: "DBError", message: error.message },
    });
    return [];
  }

  return (data ?? []) as MemoRecord[];
}

/**
 * Looks up the memo mapping for a specific transaction hash.
 *
 * @param txHash   - Stellar transaction hash
 * @param supabase - Supabase client
 * @returns MemoRecord or null
 */
export async function getMemoByTxHash(
  txHash: string,
  supabase: SupabaseClient
): Promise<MemoRecord | null> {
  const { data, error } = await supabase
    .from("group_tx_memo_map")
    .select("*")
    .eq("tx_hash", txHash)
    .maybeSingle();

  if (error) {
    logBlockchainOperation("error", "Failed to fetch memo by tx hash", {
      transactionHash: txHash,
      error: { type: "DBError", message: error.message },
    });
    return null;
  }

  return data as MemoRecord | null;
}

/**
 * Validates memo integrity for all records belonging to a group and
 * updates the is_valid flag in the DB accordingly.
 *
 * @param groupId  - The room/group ID
 * @param supabase - Supabase client (service-role for updates)
 * @returns Array of validation results
 */
export async function revalidateGroupMemos(
  groupId: string,
  supabase: SupabaseClient
): Promise<MemoValidationResult[]> {
  const records = await getMemosByGroupId(groupId, supabase);
  const results: MemoValidationResult[] = [];

  for (const record of records) {
    const validation = validateMemoRecord(record);
    results.push(validation);

    // Update DB if validity changed
    if (validation.isValid !== record.is_valid) {
      await supabase
        .from("group_tx_memo_map")
        .update({
          is_valid: validation.isValid,
          verified_at: new Date().toISOString(),
        })
        .eq("id", record.id);
    }
  }

  return results;
}
