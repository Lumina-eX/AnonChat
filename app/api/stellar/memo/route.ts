/**
 * GET /api/stellar/memo?memo=grp_abc123xyz
 *
 * Looks up a group by its Stellar memo identifier.
 * Returns the room record and the associated transaction hash.
 *
 * This endpoint enables lightweight group identification from on-chain data:
 * given a memo read from a Stellar transaction, callers can resolve the
 * corresponding group without knowing the internal room ID.
 */

import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import { validateMemoGroupId } from "@/lib/blockchain/memo";
import { getTransactionExplorerUrl } from "@/lib/blockchain/stellar-service";
import {
  logBlockchainOperation,
  generateCorrelationId,
} from "@/lib/blockchain/logger";

export async function GET(request: NextRequest) {
  const correlationId = generateCorrelationId();
  const { searchParams } = new URL(request.url);
  const memo = searchParams.get("memo");

  // ── 1. Validate memo parameter ──────────────────────────────────────────────
  if (!memo) {
    return NextResponse.json(
      { error: "memo query parameter is required" },
      { status: 400 },
    );
  }

  const memoValidation = validateMemoGroupId(memo);
  if (!memoValidation.valid) {
    return NextResponse.json(
      { error: `Invalid memo: ${memoValidation.reason}` },
      { status: 400 },
    );
  }

  logBlockchainOperation(
    "info",
    "Looking up group by memo",
    { memoGroupId: memo },
    correlationId,
  );

  try {
    const supabase = await createClient();

    // ── 2. Look up via the fast lookup table first ──────────────────────────
    const { data: memoRecord, error: memoError } = await supabase
      .from("group_tx_memos")
      .select("group_id, tx_hash, created_at")
      .eq("memo_group_id", memo)
      .maybeSingle();

    if (memoError) {
      logBlockchainOperation(
        "error",
        "Database error looking up group_tx_memos",
        {
          memoGroupId: memo,
          error: { type: "DatabaseError", message: memoError.message },
        },
        correlationId,
      );
      return NextResponse.json(
        { error: "Failed to look up memo" },
        { status: 500 },
      );
    }

    if (!memoRecord) {
      // ── 3. Fallback: query rooms table directly ─────────────────────────
      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .select(
          "id, name, description, is_private, created_at, stellar_tx_hash, memo_group_id",
        )
        .eq("memo_group_id", memo)
        .maybeSingle();

      if (roomError) {
        logBlockchainOperation(
          "error",
          "Database error looking up room by memo_group_id",
          {
            memoGroupId: memo,
            error: { type: "DatabaseError", message: roomError.message },
          },
          correlationId,
        );
        return NextResponse.json(
          { error: "Failed to look up memo" },
          { status: 500 },
        );
      }

      if (!room) {
        return NextResponse.json(
          { error: "No group found for the provided memo" },
          { status: 404 },
        );
      }

      return NextResponse.json({
        groupId: room.id,
        memoGroupId: memo,
        transactionHash: room.stellar_tx_hash ?? null,
        explorerUrl: room.stellar_tx_hash
          ? getTransactionExplorerUrl(room.stellar_tx_hash)
          : null,
        room: {
          id: room.id,
          name: room.name,
          description: room.description,
          is_private: room.is_private,
          created_at: room.created_at,
        },
      });
    }

    // ── 4. Fetch the full room record ───────────────────────────────────────
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("id, name, description, is_private, created_at")
      .eq("id", memoRecord.group_id)
      .maybeSingle();

    if (roomError || !room) {
      return NextResponse.json(
        { error: "Group not found" },
        { status: 404 },
      );
    }

    logBlockchainOperation(
      "info",
      "Group resolved from memo",
      {
        memoGroupId: memo,
        groupId: room.id,
        transactionHash: memoRecord.tx_hash,
      },
      correlationId,
    );

    return NextResponse.json({
      groupId: room.id,
      memoGroupId: memo,
      transactionHash: memoRecord.tx_hash,
      explorerUrl: getTransactionExplorerUrl(memoRecord.tx_hash),
      room: {
        id: room.id,
        name: room.name,
        description: room.description,
        is_private: room.is_private,
        created_at: room.created_at,
      },
    });
  } catch (error: any) {
    logBlockchainOperation(
      "error",
      "Memo lookup failed",
      {
        memoGroupId: memo,
        error: {
          type: error.name || "UnknownError",
          message: error.message || "Unknown error",
        },
      },
      correlationId,
    );

    return NextResponse.json(
      { error: "Failed to resolve memo" },
      { status: 500 },
    );
  }
}
