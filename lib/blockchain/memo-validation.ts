/**
 * Memo Validation Middleware
 *
 * Provides request-level validation for memo-related payloads before
 * they reach controllers. Checks:
 *  - Presence of required fields (groupId, txHash)
 *  - Group ID existence in the DB
 *  - Memo value integrity (format + DB record consistency)
 *  - Memo type validity
 */

import { NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { validateGroupMemo, getMemoStrategy, STELLAR_MEMO_TEXT_MAX_BYTES } from "./memo";
import { getMemoByTxHash, getMemosByGroupId } from "./memo-service";

export type MemoValidationError =
  | { valid: false; response: NextResponse }
  | { valid: true };

/**
 * Validates that a groupId is non-empty and exists in the rooms table.
 */
export async function validateGroupIdExists(
  groupId: string,
  supabase: SupabaseClient
): Promise<MemoValidationError> {
  if (!groupId || typeof groupId !== "string" || groupId.trim() === "") {
    return {
      valid: false,
      response: NextResponse.json(
        { error: "groupId is required and must be a non-empty string" },
        { status: 400 }
      ),
    };
  }

  const { data, error } = await supabase
    .from("rooms")
    .select("id")
    .eq("id", groupId)
    .maybeSingle();

  if (error) {
    return {
      valid: false,
      response: NextResponse.json(
        { error: "Failed to validate group ID" },
        { status: 500 }
      ),
    };
  }

  if (!data) {
    return {
      valid: false,
      response: NextResponse.json(
        { error: `Group '${groupId}' does not exist` },
        { status: 404 }
      ),
    };
  }

  return { valid: true };
}

/**
 * Validates a memo value against a known group ID.
 * Checks format correctness and byte-length constraints.
 */
export function validateMemoValue(
  memoValue: string,
  memoType: string,
  groupId: string
): MemoValidationError {
  if (!memoValue || typeof memoValue !== "string") {
    return {
      valid: false,
      response: NextResponse.json(
        { error: "memoValue is required" },
        { status: 400 }
      ),
    };
  }

  if (!["text", "hash", "id", "return"].includes(memoType)) {
    return {
      valid: false,
      response: NextResponse.json(
        { error: "memoType must be one of: text, hash, id, return" },
        { status: 400 }
      ),
    };
  }

  // For text memos, enforce byte-length limit
  if (memoType === "text") {
    const byteLen = Buffer.byteLength(memoValue, "utf8");
    if (byteLen > STELLAR_MEMO_TEXT_MAX_BYTES) {
      return {
        valid: false,
        response: NextResponse.json(
          {
            error: `Memo text exceeds ${STELLAR_MEMO_TEXT_MAX_BYTES}-byte limit (got ${byteLen} bytes)`,
          },
          { status: 400 }
        ),
      };
    }
  }

  // Validate memo integrity against the group ID
  if (memoType === "text" || memoType === "hash") {
    const isValid = validateGroupMemo(
      memoValue,
      memoType as "text" | "hash",
      groupId
    );
    if (!isValid) {
      return {
        valid: false,
        response: NextResponse.json(
          {
            error: "Memo value does not match the expected format for this group ID",
            hint:
              memoType === "text"
                ? `Expected: grp:${groupId}`
                : "Expected: SHA-256 hex of the group ID",
          },
          { status: 422 }
        ),
      };
    }
  }

  return { valid: true };
}

/**
 * Validates that a txHash has a corresponding memo record in the DB
 * and that the record's memo is consistent with the given groupId.
 */
export async function validateTxMemoRecord(
  txHash: string,
  groupId: string,
  supabase: SupabaseClient
): Promise<MemoValidationError> {
  if (!txHash || typeof txHash !== "string" || txHash.trim() === "") {
    return {
      valid: false,
      response: NextResponse.json(
        { error: "txHash is required" },
        { status: 400 }
      ),
    };
  }

  const record = await getMemoByTxHash(txHash, supabase);

  if (!record) {
    return {
      valid: false,
      response: NextResponse.json(
        { error: `No memo record found for transaction '${txHash}'` },
        { status: 404 }
      ),
    };
  }

  if (record.group_id !== groupId) {
    return {
      valid: false,
      response: NextResponse.json(
        {
          error: "Transaction memo is linked to a different group ID",
          expected: groupId,
          found: record.group_id,
        },
        { status: 409 }
      ),
    };
  }

  if (!record.is_valid) {
    return {
      valid: false,
      response: NextResponse.json(
        { error: "Memo record exists but failed integrity validation" },
        { status: 422 }
      ),
    };
  }

  return { valid: true };
}

/**
 * Checks whether a group already has at least one valid memo transaction.
 * Useful to prevent duplicate submissions.
 */
export async function groupHasValidMemo(
  groupId: string,
  supabase: SupabaseClient
): Promise<boolean> {
  const records = await getMemosByGroupId(groupId, supabase);
  return records.some((r) => r.is_valid);
}

/**
 * Determines the recommended memo strategy for a group ID and returns
 * a human-readable explanation. Useful for client-side guidance.
 */
export function getMemoStrategyInfo(groupId: string): {
  strategy: "text" | "hash";
  explanation: string;
  byteLength: number;
} {
  const candidate = `grp:${groupId}`;
  const byteLength = Buffer.byteLength(candidate, "utf8");
  const strategy = getMemoStrategy(groupId);

  return {
    strategy,
    byteLength,
    explanation:
      strategy === "text"
        ? `Group ID fits in 28 bytes as text memo: "${candidate}"`
        : `Group ID (${byteLength} bytes) exceeds 28-byte limit; SHA-256 hash memo will be used`,
  };
}
