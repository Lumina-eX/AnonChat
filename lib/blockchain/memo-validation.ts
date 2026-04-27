/**
 * Memo Validation Middleware
 *
 * Provides request-level validation helpers that verify a Stellar transaction
 * memo is correctly linked to a group ID before any processing occurs.
 *
 * Usage in an API route:
 *
 *   const validation = await validateMemoRequest({ groupId, transactionHash });
 *   if (!validation.valid) {
 *     return NextResponse.json({ error: validation.reason }, { status: 400 });
 *   }
 */

import { createHash } from "crypto";
import { MemoValidationResult } from "@/types/blockchain";
import { MEMO_TEXT_MAX_BYTES, validateMemoForGroup } from "./memo-service";
import { logBlockchainOperation, generateCorrelationId } from "./logger";

// ── Input validation ──────────────────────────────────────────────────────────

/**
 * Validates that a group ID is suitable for use as a Stellar memo.
 *
 * Rules:
 *  - Must be a non-empty string
 *  - Must not contain null bytes (Stellar memo_text restriction)
 *  - If > 28 bytes UTF-8, a hash memo will be used (still valid, just noted)
 */
export function validateGroupIdForMemo(groupId: unknown): {
  valid: boolean;
  willUseHash: boolean;
  reason?: string;
} {
  if (!groupId || typeof groupId !== "string" || groupId.trim() === "") {
    return { valid: false, willUseHash: false, reason: "groupId must be a non-empty string" };
  }

  if (groupId.includes("\0")) {
    return { valid: false, willUseHash: false, reason: "groupId must not contain null bytes" };
  }

  const bytes = Buffer.byteLength(groupId, "utf8");
  const willUseHash = bytes > MEMO_TEXT_MAX_BYTES;

  return { valid: true, willUseHash };
}

// ── DB-backed memo record validation ─────────────────────────────────────────

export interface MemoRequestValidationInput {
  /** The AnonChat group / room ID to validate against */
  groupId: string;
  /** The memo value extracted from the transaction (or provided by caller) */
  memoValue: string;
  /** The memo type ("text" | "hash") */
  memoType: "text" | "hash";
  /** Optional: Stellar transaction hash for logging */
  transactionHash?: string;
}

/**
 * Validates that a memo value is correctly linked to a group ID.
 *
 * This is the primary middleware check:
 *  1. Ensures groupId and memoValue are present
 *  2. Delegates to validateMemoForGroup for cryptographic consistency check
 *  3. Logs the result with a correlation ID
 *
 * @returns MemoValidationResult
 */
export function validateMemoRequest(
  input: MemoRequestValidationInput
): MemoValidationResult {
  const correlationId = generateCorrelationId();
  const { groupId, memoValue, memoType, transactionHash } = input;

  // Basic presence checks
  if (!groupId || groupId.trim() === "") {
    logBlockchainOperation(
      "warn",
      "Memo validation failed – missing groupId",
      { transactionHash },
      correlationId
    );
    return { valid: false, reason: "groupId is required" };
  }

  if (!memoValue || memoValue.trim() === "") {
    logBlockchainOperation(
      "warn",
      "Memo validation failed – missing memoValue",
      { groupId, transactionHash },
      correlationId
    );
    return { valid: false, reason: "memoValue is required" };
  }

  if (memoType !== "text" && memoType !== "hash") {
    return { valid: false, reason: 'memoType must be "text" or "hash"' };
  }

  // Cryptographic consistency check
  const result = validateMemoForGroup(groupId, memoValue, memoType);

  logBlockchainOperation(
    result.valid ? "info" : "warn",
    result.valid ? "Memo validation passed" : "Memo validation failed",
    {
      groupId,
      memoValue,
      memoType,
      transactionHash,
      reason: result.reason,
    },
    correlationId
  );

  return result;
}

// ── Convenience: derive expected memo value ───────────────────────────────────

/**
 * Returns the memo value that should appear on-chain for a given group ID.
 *
 * - If groupId ≤ 28 bytes → returns groupId as-is (text memo)
 * - Otherwise             → returns SHA-256 hex of groupId (hash memo)
 */
export function expectedMemoValue(groupId: string): {
  memoValue: string;
  memoType: "text" | "hash";
} {
  const bytes = Buffer.byteLength(groupId, "utf8");
  if (bytes <= MEMO_TEXT_MAX_BYTES) {
    return { memoValue: groupId, memoType: "text" };
  }
  const memoValue = createHash("sha256").update(groupId).digest("hex");
  return { memoValue, memoType: "hash" };
}
