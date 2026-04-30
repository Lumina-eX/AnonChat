/**
 * Stellar memo utilities for group identification.
 *
 * Stellar's TEXT memo is limited to 28 bytes (UTF-8).  We derive a compact,
 * deterministic memo from the room ID so that every on-chain transaction can
 * be traced back to a specific group without requiring custom contracts or
 * extra fields.
 *
 * Memo format:  "grp_<12-char-slug>"   (17 bytes, well within the 28-byte cap)
 *
 * The 12-char slug is the first 12 characters of the base-36 representation of
 * the room's creation timestamp + random suffix, extracted directly from the
 * existing room ID format:  room_{timestamp}_{random9chars}
 *
 * If the room ID does not follow that pattern we fall back to a truncated
 * SHA-256 hex of the full room ID (first 24 hex chars → 12 bytes of entropy).
 */

import { createHash } from "crypto";

/** Maximum byte length allowed by Stellar for TEXT memos. */
export const STELLAR_MEMO_MAX_BYTES = 28;

/** Prefix that identifies AnonChat group memos on-chain. */
const MEMO_PREFIX = "grp_";

/**
 * Derives a deterministic, ≤28-byte memo string from a room ID.
 *
 * @param roomId - The room's primary key (e.g. "room_1714000000000_abc123xyz")
 * @returns A memo string safe to pass to `StellarSdk.Memo.text()`
 */
export function deriveMemoGroupId(roomId: string): string {
  // Try to extract the random suffix from the canonical room ID format
  const match = roomId.match(/^room_\d+_([a-z0-9]+)$/i);
  if (match) {
    // Use up to 12 chars of the random suffix for the slug
    const slug = match[1].substring(0, 12).toLowerCase();
    const memo = `${MEMO_PREFIX}${slug}`;
    return memo.substring(0, STELLAR_MEMO_MAX_BYTES);
  }

  // Fallback: SHA-256 of the room ID, take first 24 hex chars
  const hash = createHash("sha256").update(roomId).digest("hex");
  const memo = `${MEMO_PREFIX}${hash.substring(0, 24)}`;
  return memo.substring(0, STELLAR_MEMO_MAX_BYTES);
}

/**
 * Validates that a memo string is safe to embed in a Stellar TEXT memo.
 *
 * Rules:
 *  - Must be a non-empty string
 *  - Must be ≤28 bytes when encoded as UTF-8
 *  - Must start with the "grp_" prefix (AnonChat convention)
 *  - Must contain only printable ASCII characters (Stellar SDK requirement)
 *
 * @param memo - The memo string to validate
 * @returns `{ valid: true }` or `{ valid: false, reason: string }`
 */
export function validateMemoGroupId(
  memo: unknown,
): { valid: true } | { valid: false; reason: string } {
  if (typeof memo !== "string" || memo.trim() === "") {
    return { valid: false, reason: "memo must be a non-empty string" };
  }

  const byteLength = Buffer.byteLength(memo, "utf8");
  if (byteLength > STELLAR_MEMO_MAX_BYTES) {
    return {
      valid: false,
      reason: `memo exceeds ${STELLAR_MEMO_MAX_BYTES}-byte Stellar limit (got ${byteLength} bytes)`,
    };
  }

  if (!memo.startsWith(MEMO_PREFIX)) {
    return {
      valid: false,
      reason: `memo must start with "${MEMO_PREFIX}" prefix`,
    };
  }

  // Stellar SDK rejects non-printable ASCII in text memos
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7E]/.test(memo)) {
    return {
      valid: false,
      reason: "memo must contain only printable ASCII characters",
    };
  }

  return { valid: true };
}

/**
 * Checks whether a raw memo string from a retrieved Stellar transaction
 * matches the expected memo for a given room ID.
 *
 * @param roomId       - The room's primary key
 * @param onChainMemo  - The memo value read back from the blockchain
 * @returns true if the memos match
 */
export function memoMatchesGroup(roomId: string, onChainMemo: string): boolean {
  const expected = deriveMemoGroupId(roomId);
  return expected === onChainMemo;
}
