/**
 * Stellar Memo — Group ID Utilities
 *
 * Stellar's native memo field supports several types:
 *   - MEMO_TEXT  : UTF-8 string, max 28 bytes
 *   - MEMO_HASH  : 32-byte hash (opaque binary)
 *   - MEMO_ID    : uint64 integer
 *   - MEMO_RETURN: 32-byte hash (return payment)
 *
 * We use MEMO_TEXT for human-readable group references and MEMO_HASH
 * when the group ID exceeds 28 bytes (we hash it to a fixed 32 bytes).
 *
 * Memo format for text:  "grp:<groupId>"  (prefix makes intent clear)
 * Memo format for hash:  SHA-256(groupId) as raw 32-byte Buffer
 */

import { createHash } from "crypto";
import * as StellarSdk from "@stellar/stellar-sdk";

/** Maximum byte length for a Stellar MEMO_TEXT value */
export const STELLAR_MEMO_TEXT_MAX_BYTES = 28;

/** Prefix used to namespace group memos */
const GROUP_MEMO_PREFIX = "grp:";

export type MemoStrategy = "text" | "hash";

export interface GroupMemoResult {
  memo: StellarSdk.Memo;
  memoValue: string;   // human-readable representation stored in DB
  memoType: MemoStrategy;
}

/**
 * Builds a Stellar Memo that encodes the given groupId.
 *
 * Strategy selection:
 *  - If "grp:<groupId>" fits within 28 bytes → MEMO_TEXT
 *  - Otherwise → MEMO_HASH (SHA-256 of the groupId, 32 bytes)
 *
 * @param groupId - The group/room ID to embed
 * @returns GroupMemoResult with the Memo object and metadata for DB storage
 */
export function buildGroupMemo(groupId: string): GroupMemoResult {
  const candidate = `${GROUP_MEMO_PREFIX}${groupId}`;
  const byteLength = Buffer.byteLength(candidate, "utf8");

  if (byteLength <= STELLAR_MEMO_TEXT_MAX_BYTES) {
    return {
      memo: StellarSdk.Memo.text(candidate),
      memoValue: candidate,
      memoType: "text",
    };
  }

  // Fall back to MEMO_HASH: SHA-256 of the groupId (32 bytes)
  const hashBuffer = createHash("sha256").update(groupId, "utf8").digest();
  return {
    memo: StellarSdk.Memo.hash(hashBuffer.toString("hex")),
    memoValue: hashBuffer.toString("hex"),
    memoType: "hash",
  };
}

/**
 * Extracts the group ID from a raw memo value stored in the DB.
 *
 * For text memos: strips the "grp:" prefix.
 * For hash memos: returns the hex string as-is (cannot reverse a hash).
 *
 * @param memoValue - The stored memo value
 * @param memoType  - The memo type ("text" | "hash")
 * @returns The group ID string, or null if the memo doesn't match our format
 */
export function extractGroupIdFromMemo(
  memoValue: string,
  memoType: MemoStrategy
): string | null {
  if (memoType === "text") {
    if (memoValue.startsWith(GROUP_MEMO_PREFIX)) {
      return memoValue.slice(GROUP_MEMO_PREFIX.length);
    }
    return null;
  }

  // For hash memos we cannot reverse, so return the hash itself
  return memoValue;
}

/**
 * Validates that a memo value is consistent with the expected group ID.
 *
 * For text memos: checks the "grp:<groupId>" format.
 * For hash memos: recomputes SHA-256(groupId) and compares.
 *
 * @param memoValue - The memo value to validate
 * @param memoType  - The memo type
 * @param groupId   - The expected group ID
 * @returns true if the memo is valid for the given group
 */
export function validateGroupMemo(
  memoValue: string,
  memoType: MemoStrategy,
  groupId: string
): boolean {
  if (memoType === "text") {
    return memoValue === `${GROUP_MEMO_PREFIX}${groupId}`;
  }

  // Hash memo: recompute and compare
  const expected = createHash("sha256").update(groupId, "utf8").digest("hex");
  return memoValue === expected;
}

/**
 * Determines the appropriate memo strategy for a given group ID without
 * building the full Memo object. Useful for pre-flight checks.
 *
 * @param groupId - The group ID to evaluate
 * @returns "text" if it fits in 28 bytes, "hash" otherwise
 */
export function getMemoStrategy(groupId: string): MemoStrategy {
  const candidate = `${GROUP_MEMO_PREFIX}${groupId}`;
  return Buffer.byteLength(candidate, "utf8") <= STELLAR_MEMO_TEXT_MAX_BYTES
    ? "text"
    : "hash";
}
