/**
 * Memo validation middleware for Stellar group ID integrity checks.
 *
 * Use `withMemoValidation` to wrap any route handler that receives a
 * `memoGroupId` in the request body or query string.  The middleware
 * validates the memo format and — when a `groupId` is also present —
 * verifies that the memo matches the expected value for that group.
 *
 * Usage (in a route handler):
 *
 *   const validation = validateRequestMemo(body.memoGroupId, body.groupId);
 *   if (!validation.valid) {
 *     return NextResponse.json({ error: validation.reason }, { status: 400 });
 *   }
 */

import { NextResponse } from "next/server";
import {
  validateMemoGroupId,
  deriveMemoGroupId,
  memoMatchesGroup,
} from "./memo";

export interface MemoValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates a memo value from a request.
 *
 * When `groupId` is provided the memo is also checked against the expected
 * derived value so that callers cannot supply an arbitrary memo for a group.
 *
 * @param memo    - The memo string from the request (body or query param)
 * @param groupId - Optional room ID to cross-validate the memo against
 */
export function validateRequestMemo(
  memo: unknown,
  groupId?: string,
): MemoValidationResult {
  // Basic format validation
  const formatResult = validateMemoGroupId(memo);
  if (!formatResult.valid) {
    return formatResult;
  }

  // Cross-validate against the expected group memo when groupId is known
  if (groupId) {
    if (!memoMatchesGroup(groupId, memo as string)) {
      const expected = deriveMemoGroupId(groupId);
      return {
        valid: false,
        reason: `memo "${memo}" does not match expected value "${expected}" for group "${groupId}"`,
      };
    }
  }

  return { valid: true };
}

/**
 * Returns a 400 NextResponse with a structured error when memo validation fails,
 * or `null` when the memo is valid (allowing the caller to proceed).
 *
 * @param memo    - The memo string from the request
 * @param groupId - Optional room ID to cross-validate the memo against
 */
export function memoValidationError(
  memo: unknown,
  groupId?: string,
): NextResponse | null {
  const result = validateRequestMemo(memo, groupId);
  if (!result.valid) {
    return NextResponse.json(
      { error: result.reason ?? "Invalid memo" },
      { status: 400 },
    );
  }
  return null;
}
