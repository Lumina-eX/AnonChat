/**
 * Stellar memo utilities for group identification.
 *
 * Stellar's TEXT memo is limited to 28 bytes. We derive a compact deterministic
 * memo from the room ID so every on-chain transaction can be traced back to a
 * specific group without custom contracts or extra fields.
 *
 * Memo format: "grp_<24 lowercase hex chars>"
 */

import { createHash, timingSafeEqual } from "crypto";

/** Maximum byte length allowed by Stellar for TEXT memos. */
export const STELLAR_MEMO_MAX_BYTES = 28;

/** Prefix that identifies AnonChat group memos on-chain. */
const MEMO_PREFIX = "grp_";
const MEMO_HASH_HEX_LENGTH = 24;
const MEMO_PATTERN = /^grp_[a-f0-9]{24}$/;

/**
 * Derives a deterministic memo string from a room ID.
 *
 * @param roomId - The room's primary key (e.g. "room_1714000000000_abc123xyz")
 * @returns A memo string safe to pass to `StellarSdk.Memo.text()`
 */
export function deriveMemoGroupId(roomId: string): string {
  const normalizedRoomId = roomId.trim();
  const hash = createHash("sha256").update(normalizedRoomId).digest("hex");
  return `${MEMO_PREFIX}${hash.substring(0, MEMO_HASH_HEX_LENGTH)}`;
}

/**
 * Validates that a memo string is safe to embed in a Stellar TEXT memo.
 *
 * Rules:
 *  - Must be a non-empty string
 *  - Must be 28 bytes or less when encoded as UTF-8
 *  - Must match AnonChat's "grp_<24 lowercase hex chars>" convention
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

  if (!MEMO_PATTERN.test(memo)) {
    return {
      valid: false,
      reason: 'memo must match "grp_<24 lowercase hex chars>"',
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
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(onChainMemo, "utf8");

  const expectedUint8 = Uint8Array.from(expectedBuffer);
  const actualUint8 = Uint8Array.from(actualBuffer);

  return (
    expectedUint8.length === actualUint8.length &&
    timingSafeEqual(expectedUint8, actualUint8)
  );
}
