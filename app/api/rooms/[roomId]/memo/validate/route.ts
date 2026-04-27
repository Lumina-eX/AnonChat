/**
 * POST /api/rooms/[roomId]/memo/validate
 *
 * Validation middleware endpoint.  Accepts a memo value + type and verifies
 * it is correctly linked to the group ID before any downstream processing.
 *
 * Body: { memoValue: string, memoType: "text" | "hash", transactionHash?: string }
 *
 * Returns 200 if valid, 400 if invalid.
 */

import { type NextRequest, NextResponse } from "next/server";
import { validateMemoRequest } from "@/lib/blockchain/memo-validation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { memoValue, memoType, transactionHash } = body ?? {};

  if (!memoValue || typeof memoValue !== "string") {
    return NextResponse.json({ error: "memoValue is required" }, { status: 400 });
  }

  if (memoType !== "text" && memoType !== "hash") {
    return NextResponse.json(
      { error: 'memoType must be "text" or "hash"' },
      { status: 400 }
    );
  }

  const result = validateMemoRequest({
    groupId: roomId,
    memoValue,
    memoType,
    transactionHash,
  });

  if (!result.valid) {
    return NextResponse.json(
      { valid: false, reason: result.reason },
      { status: 400 }
    );
  }

  return NextResponse.json({ valid: true, groupId: roomId, memoValue, memoType });
}
