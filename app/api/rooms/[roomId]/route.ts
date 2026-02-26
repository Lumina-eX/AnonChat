import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { computeHash } from "@/lib/blockchain/metadata-hash";
import {
  submitMetadataHash,
  getTransactionExplorerUrl,
} from "@/lib/blockchain/stellar-service";
import { verifyWalletSignature } from "@/lib/auth/stellar-verify";
import { GroupMetadata } from "@/types/blockchain";
import {
  logBlockchainOperation,
  generateCorrelationId,
} from "@/lib/blockchain/logger";

// GET /api/rooms/[roomId] - fetch basic room record
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const correlationId = generateCorrelationId();
  const { roomId } = await params;

  try {
    const supabase = await createClient();
    const { data: room, error } = await supabase
      .from("rooms")
      .select("*")
      .eq("id", roomId)
      .single();

    if (error || !room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    return NextResponse.json({ room });
  } catch (err: any) {
    console.error(`[v0] GET /api/rooms/${roomId} error:`, err);
    logBlockchainOperation(
      "error",
      "Failed to fetch room",
      { groupId: roomId, error: err },
      correlationId,
    );
    return NextResponse.json(
      { error: "Failed to fetch room" },
      { status: 500 },
    );
  }
}

// PATCH /api/rooms/[roomId] - update metadata, requires owner signature
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const correlationId = generateCorrelationId();
  const { roomId } = await params;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const walletAddress =
      (user.user_metadata as any)?.wallet_address as string | undefined;
    if (!walletAddress) {
      return NextResponse.json(
        { error: "Wallet address not available for user" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { name, description, is_private, max_fee, signature } = body;

    // signature must be provided
    if (!signature || typeof signature !== "string") {
      return NextResponse.json(
        { error: "signature is required" },
        { status: 400 },
      );
    }

    // fetch existing room to confirm ownership
    const { data: room, error: fetchError } = await supabase
      .from("rooms")
      .select("*")
      .eq("id", roomId)
      .single();

    if (fetchError || !room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    if (room.owner_wallet !== walletAddress) {
      return NextResponse.json({ error: "Wallet not owner" }, { status: 403 });
    }

    // compute the expected metadata hash for the updated values
    const newMetadata: GroupMetadata = {
      id: room.id,
      name: name !== undefined ? name : room.name,
      description:
        description !== undefined ? description : room.description,
      created_by: room.created_by,
      created_at: room.created_at,
      is_private: is_private !== undefined ? is_private : room.is_private,
      owner_wallet: walletAddress,
    };

    const newHash = computeHash(newMetadata);

    // verify the signature over the hash
    const validSig = verifyWalletSignature(walletAddress, newHash, signature);
    if (!validSig) {
      return NextResponse.json(
        { error: "Signature verification failed" },
        { status: 403 },
      );
    }

    // perform update
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (is_private !== undefined) updates.is_private = is_private;

    const { data: updatedRows, error: updateError } = await supabase
      .from("rooms")
      .update(updates)
      .eq("id", roomId)
      .select();

    if (updateError) throw updateError;
    const updatedRoom = updatedRows[0];

    // Optionally re-submit to blockchain in background
    let blockchainSubmitted = false;
    let stellarTxHash: string | null = null;
    let explorerUrl: string | null = null;
    let actualFeeCharged: string | null = null;

    try {
      const result = await submitMetadataHash(room.id, newHash, max_fee);
      if (result.success && result.transactionHash) {
        blockchainSubmitted = true;
        stellarTxHash = result.transactionHash;
        actualFeeCharged = result.feeCharged || null;
        explorerUrl = getTransactionExplorerUrl(result.transactionHash);
        await supabase
          .from("rooms")
          .update({
            stellar_tx_hash: stellarTxHash,
            metadata_hash: newHash,
            blockchain_submitted_at: new Date().toISOString(),
          })
          .eq("id", roomId);

        logBlockchainOperation(
          "info",
          "Room metadata updated on-chain",
          { groupId: roomId, transactionHash: stellarTxHash },
          correlationId,
        );
      }
    } catch (err: any) {
      logBlockchainOperation(
        "warn",
        "On-chain update failed, continuing without it",
        { groupId: roomId, error: err.message },
        correlationId,
      );
    }

    return NextResponse.json(
      {
        room: {
          ...updatedRoom,
          stellar_tx_hash: stellarTxHash,
          metadata_hash: newHash,
        },
        success: true,
        blockchain: {
          submitted: blockchainSubmitted,
          transactionHash: stellarTxHash || undefined,
          feeCharged: actualFeeCharged || undefined,
          explorerUrl: explorerUrl || undefined,
        },
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error(`[v0] PATCH /api/rooms/${roomId} error:`, error);
    logBlockchainOperation(
      "error",
      "Room update failed",
      {
        groupId: roomId,
        error: {
          type: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      },
      correlationId,
    );
    return NextResponse.json(
      { error: "Failed to update room" },
      { status: 500 },
    );
  }
}
