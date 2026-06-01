import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import { computeHash } from "@/lib/blockchain/metadata-hash";
import {
  submitMetadataHash,
  getTransactionExplorerUrl,
} from "@/lib/blockchain/stellar-service";
import { GroupMetadata } from "@/types/blockchain";
import {
  logBlockchainOperation,
  generateCorrelationId,
} from "@/lib/blockchain/logger";
import { recordGroupAuditEvent } from "@/lib/blockchain/audit";
import { insertRoomActivity } from "@/lib/activity/room-activity";
import { type SupabaseClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  try {
    // Check if Supabase is configured (not dummy)
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co";
    if (supabaseUrl.includes("dummy")) {
      // Return empty rooms for demo mode without Supabase
      return NextResponse.json({ rooms: [] });
    }

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // If user signed in, include unread counts from view
    if (user) {
      const { data, error } = await supabase
        .from("rooms")
        .select(`*, user_room_unreads(unread_count)`)
        .eq("is_private", false)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // map unread_count from nested user_room_unreads if present
      const mapped = (data || []).map((r: any) => ({
        ...r,
        unread_count: r.user_room_unreads?.[0]?.unread_count ?? 0,
      }));

      return NextResponse.json({ rooms: mapped });
    }

    const { data, error } = await supabase
      .from("rooms")
      .select("*")
      .eq("is_private", false)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ rooms: data });
  } catch (error) {
    console.error("[v0] GET /api/rooms error:", error);
    return NextResponse.json(
      { error: "Failed to fetch rooms" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // Check if Supabase is configured (not dummy)
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co";
    if (supabaseUrl.includes("dummy")) {
      // Return error in demo mode without Supabase
      return NextResponse.json(
        {
          error:
            "Room creation not available in demo mode. Please configure Supabase.",
        },
        { status: 503 },
      );
    }

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, is_private, max_fee } = body;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const roomId = `room_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const createdAt = new Date().toISOString();

    // Insert group into database first
    const walletAddress = (user as any)?.user_metadata?.wallet_address;
    if (!walletAddress) {
      return NextResponse.json(
        { error: "Cannot determine owner wallet from authenticated session" },
        { status: 401 },
      );
    }

    const { data, error } = await supabase
      .from("rooms")
      .insert({
        id: roomId,
        name,
        description,
        is_private: is_private || false,
        created_by: user.id,
        owner_wallet: walletAddress,
      })
      .select();

    if (error) throw error;

    const room = data[0];

    // Log group creation as a separate activity record (not a chat message)
    try {
      await insertRoomActivity(supabase as unknown as SupabaseClient, {
        room_id: room.id,
        event_type: "group_created",
        actor_user_id: user.id,
        metadata: { name: room.name, is_private: room.is_private },
      });
    } catch (e) {
      // Non-fatal: group creation should succeed even if activity logging fails
      console.warn("[activity] failed to insert group_created log", e);
    }

    // Prepare metadata for blockchain submission
    const metadata: GroupMetadata = {
      id: room.id,
      name: room.name,
      description: room.description,
      created_by: room.created_by,
      created_at: room.created_at,
      is_private: room.is_private,
      owner_wallet: room.owner_wallet,
    };

    // Compute metadata hash
    const metadataHash = computeHash(metadata);

    logBlockchainOperation(
      "info",
      "Group created, initiating blockchain submission",
      {
        groupId: room.id,
        metadataHash,
      },
      correlationId,
    );

    // Submit to blockchain (non-blocking, graceful degradation)
    let stellarTxHash: string | null = null;
    let blockchainSubmitted = false;
    let explorerUrl: string | null = null;
    let actualFeeCharged: string | null = null;
    let memoGroupId: string | null = null;
    let auditEvent = null;

    try {
      const result = await submitMetadataHash(room.id, metadataHash, max_fee);

      if (result.success && result.transactionHash) {
        stellarTxHash = result.transactionHash;
        actualFeeCharged = result.feeCharged || null;
        blockchainSubmitted = true;
        explorerUrl = getTransactionExplorerUrl(result.transactionHash);
        memoGroupId = result.memoGroupId ?? null;

        // Update room record with blockchain info, including the memo group ID
        await supabase
          .from("rooms")
          .update({
            stellar_tx_hash: stellarTxHash,
            metadata_hash: metadataHash,
            blockchain_submitted_at: new Date().toISOString(),
            memo_group_id: result.memoGroupId ?? null,
          })
          .eq("id", room.id);

        // Persist the groupId <-> transactionId mapping for fast lookups
        if (result.memoGroupId) {
          const { error: memoInsertError } = await supabase
            .from("group_tx_memos")
            .insert({
              group_id: room.id,
              memo_group_id: result.memoGroupId,
              tx_hash: stellarTxHash,
            });

          if (memoInsertError) {
            // Non-fatal: log but don't fail the request
            logBlockchainOperation(
              "warn",
              "Failed to persist group_tx_memos record",
              {
                groupId: room.id,
                memoGroupId: result.memoGroupId,
                transactionHash: stellarTxHash,
                error: {
                  type: "DatabaseError",
                  message: memoInsertError.message,
                },
              },
              correlationId,
            );
          }
        }

        logBlockchainOperation(
          "info",
          "Room record updated with blockchain info",
          {
            groupId: room.id,
            transactionHash: stellarTxHash,
            memoGroupId: result.memoGroupId,
          },
          correlationId,
        );
      } else {
        logBlockchainOperation(
          "warn",
          "Blockchain submission failed, continuing without it",
          {
            groupId: room.id,
            error: result.error
              ? { type: "BlockchainError", message: result.error }
              : undefined,
          },
          correlationId,
        );
      }
    } catch (blockchainError: any) {
      // Log error but don't fail the request
      logBlockchainOperation(
        "error",
        "Blockchain submission error",
        {
          groupId: room.id,
          error: {
            type: blockchainError.name || "UnknownError",
            message: blockchainError.message || "Unknown error",
          },
        },
        correlationId,
      );
    }

    auditEvent = await recordGroupAuditEvent({
      supabase,
      groupId: room.id,
      eventType: "group_created",
      actorUserId: user.id,
      targetUserId: user.id,
      maxFee: max_fee,
      metadata: {
        room_name: room.name,
        is_private: room.is_private,
        metadata_hash: metadataHash,
        group_creation_transaction_hash: stellarTxHash,
      },
    });

    // Return success response with blockchain info
    return NextResponse.json(
      {
        room: {
          ...room,
          owner_wallet: walletAddress,
          stellar_tx_hash: stellarTxHash,
          metadata_hash: metadataHash,
          memo_group_id: memoGroupId,
        },
        success: true,
        blockchain: {
          submitted: blockchainSubmitted,
          transactionHash: stellarTxHash || undefined,
          feeCharged: actualFeeCharged || undefined,
          explorerUrl: explorerUrl || undefined,
          memoGroupId: memoGroupId || undefined,
        },
        audit: auditEvent || undefined,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[v0] POST /api/rooms error:", error);
    logBlockchainOperation(
      "error",
      "Room creation failed",
      {
        error: {
          type: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : "Unknown error",
          stack: error instanceof Error ? error.stack : undefined,
        },
      },
      correlationId,
    );
    return NextResponse.json(
      { error: "Failed to create room" },
      { status: 500 },
    );
  }
}
