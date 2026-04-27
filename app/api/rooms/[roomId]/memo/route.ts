/**
 * GET  /api/rooms/[roomId]/memo
 *   Returns the memo record(s) linked to this group from the DB.
 *
 * POST /api/rooms/[roomId]/memo
 *   Submits a new Stellar transaction whose memo field carries the group ID,
 *   then persists the groupId ↔ transactionHash mapping in the DB.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { submitGroupMemoTransaction } from "@/lib/blockchain/memo-service";
import {
  validateGroupIdForMemo,
  validateMemoRequest,
  expectedMemoValue,
} from "@/lib/blockchain/memo-validation";
import { logBlockchainOperation, generateCorrelationId } from "@/lib/blockchain/logger";

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("group_memo_transactions")
      .select("*")
      .eq("group_id", roomId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Also return the expected memo value so clients can verify on-chain
    const { memoValue, memoType } = expectedMemoValue(roomId);

    return NextResponse.json({
      groupId: roomId,
      expectedMemo: { memoValue, memoType },
      records: data ?? [],
    });
  } catch (error) {
    console.error("[memo] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch memo records" }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const correlationId = generateCorrelationId();

  try {
    const supabase = await createClient();

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify the room exists
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("id")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    // Validate the group ID is suitable for a memo
    const idCheck = validateGroupIdForMemo(roomId);
    if (!idCheck.valid) {
      return NextResponse.json({ error: idCheck.reason }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { max_fee } = body;

    logBlockchainOperation(
      "info",
      "Submitting group memo transaction via API",
      { groupId: roomId },
      correlationId
    );

    // Submit the memo transaction to Stellar
    const result = await submitGroupMemoTransaction(roomId, max_fee);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? "Memo transaction failed" },
        { status: 502 }
      );
    }

    // Validate the memo before persisting
    const validation = validateMemoRequest({
      groupId: roomId,
      memoValue: result.memoValue!,
      memoType: result.memoType!,
      transactionHash: result.transactionHash,
    });

    if (!validation.valid) {
      // This should never happen if buildGroupMemo is correct, but guard anyway
      logBlockchainOperation(
        "error",
        "Memo integrity check failed after submission",
        { groupId: roomId, reason: validation.reason },
        correlationId
      );
      return NextResponse.json(
        { error: "Memo integrity check failed: " + validation.reason },
        { status: 500 }
      );
    }

    // Persist the groupId ↔ transactionHash mapping
    const { data: record, error: insertError } = await supabase
      .from("group_memo_transactions")
      .insert({
        group_id: roomId,
        transaction_hash: result.transactionHash,
        memo_value: result.memoValue,
        memo_type: result.memoType,
      })
      .select()
      .single();

    if (insertError) {
      logBlockchainOperation(
        "error",
        "Failed to persist memo record",
        { groupId: roomId, error: { type: "DBError", message: insertError.message } },
        correlationId
      );
      // Transaction is on-chain; return partial success with a warning
      return NextResponse.json(
        {
          warning: "Transaction submitted but DB record failed: " + insertError.message,
          transactionHash: result.transactionHash,
          memoValue: result.memoValue,
          memoType: result.memoType,
          explorerUrl: result.explorerUrl,
        },
        { status: 207 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        record,
        transactionHash: result.transactionHash,
        memoValue: result.memoValue,
        memoType: result.memoType,
        feeCharged: result.feeCharged,
        explorerUrl: result.explorerUrl,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[memo] POST error:", error);
    logBlockchainOperation(
      "error",
      "Memo API error",
      { groupId: roomId, error: { type: error.name, message: error.message } },
      correlationId
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
