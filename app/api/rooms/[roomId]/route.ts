import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consumeNonce, verifyWalletSignature } from "@/lib/auth/stellar-verify";
import { validateRequiredFields, validateStellarAddress } from "@/lib/auth/validation";
import { requireGroupOwner } from "@/lib/middleware/group-ownership";
import { computeHash } from "@/lib/blockchain/metadata-hash";
import {
  submitMetadataHash,
  getTransactionExplorerUrl,
  generateIdempotencyKey,
} from "@/lib/blockchain/stellar-service";
import { GroupMetadata } from "@/types/blockchain";
import { persistGroupTransactionMemo } from "@/lib/blockchain/memo-store";
import { type SupabaseClient } from "@supabase/supabase-js";
import { logBlockchainOperation, generateCorrelationId } from "@/lib/blockchain/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
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

    return NextResponse.json({ room }, { status: 200 });
  } catch (error) {
    console.error("[rooms/[roomId]] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch room" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const correlationId = generateCorrelationId();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { walletAddress, signature, name, description, is_private } = body ?? {};

    const errors = validateRequiredFields(body ?? {}, ["walletAddress", "signature"]);
    if (errors.length > 0) {
      return NextResponse.json(
        { error: errors.map((error) => error.message).join(", ") },
        { status: 400 },
      );
    }

    if (!validateStellarAddress(walletAddress)) {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }

    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("id, name, description, is_private, created_by, owner_wallet, stellar_tx_hash, metadata_hash, memo_group_id")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const ownerCheck = await requireGroupOwner({
      supabase,
      groupId: roomId,
      callerWallet: walletAddress,
      userId: user.id,
    });

    if (ownerCheck instanceof NextResponse) {
      return ownerCheck;
    }

    const nonce = await consumeNonce(walletAddress);
    if (!nonce) {
      return NextResponse.json(
        { error: "Nonce not found or expired. Request a new nonce." },
        { status: 401 },
      );
    }

    const isValidSignature = verifyWalletSignature(walletAddress, nonce, signature);
    if (!isValidSignature) {
      return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
    }

    const updates: Record<string, unknown> = {};
    if (typeof name === "string" && name.trim().length > 0) {
      updates.name = name.trim();
    }
    if (typeof description === "string") {
      updates.description = description.trim();
    }
    if (typeof is_private === "boolean") {
      updates.is_private = is_private;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid update fields provided" }, { status: 400 });
    }

    const { data: updatedRoom, error: updateError } = await supabase
      .from("rooms")
      .update(updates)
      .eq("id", roomId)
      .select()
      .single();

    if (updateError || !updatedRoom) {
      throw updateError || new Error("Failed to update room");
    }

    // Build metadata for blockchain submission
    const metadata: GroupMetadata = {
      id: updatedRoom.id,
      name: updatedRoom.name,
      description: updatedRoom.description,
      created_by: updatedRoom.created_by,
      created_at: updatedRoom.created_at,
      is_private: updatedRoom.is_private,
      owner_wallet: updatedRoom.owner_wallet || walletAddress,
    };

    const currentMetadataHash = computeHash(metadata);
    let stellarTxHash = updatedRoom.stellar_tx_hash ?? null;
    let metadataHash = updatedRoom.metadata_hash ?? null;
    let memoGroupId = updatedRoom.memo_group_id ?? null;
    let blockchainSubmitted = false;
    let explorerUrl: string | null = null;
    let actualFeeCharged: string | null = null;
    let blockchainError: string | null = null;
    let isDuplicate = false;
    let attemptId: string | null = null;

    // Generate idempotency key for this update
    const idempotencyKey = generateIdempotencyKey(
      roomId,
      "metadata_hash",
      `${currentMetadataHash}:${Date.now()}`
    );

    try {
      const result = await submitMetadataHash(roomId, currentMetadataHash, undefined, {
        supabase: supabase as any,
        idempotencyKey,
      });

      isDuplicate = result.isDuplicate ?? false;
      attemptId = result.attemptId ?? null;

      if (result.success && result.transactionHash) {
        stellarTxHash = result.transactionHash;
        metadataHash = currentMetadataHash;
        actualFeeCharged = result.feeCharged || null;
        blockchainSubmitted = true;
        explorerUrl = getTransactionExplorerUrl(result.transactionHash);
        memoGroupId = result.memoGroupId ?? null;

        await supabase
          .from("rooms")
          .update({
            stellar_tx_hash: stellarTxHash,
            metadata_hash: metadataHash,
            blockchain_submitted_at: new Date().toISOString(),
            memo_group_id: result.memoGroupId ?? null,
          })
          .eq("id", roomId);

        if (result.memoGroupId) {
          await persistGroupTransactionMemo(supabase as unknown as SupabaseClient, {
            groupId: roomId,
            memoGroupId: result.memoGroupId,
            txHash: stellarTxHash,
          });
        }

        logBlockchainOperation(
          "info",
          "Room update blockchain submission successful",
          {
            roomId,
            transactionHash: stellarTxHash,
            isDuplicate,
            attemptId,
          },
          correlationId,
        );
      } else {
        blockchainError = result.error || "Blockchain submission failed";
        logBlockchainOperation(
          "warn",
          "Room update blockchain submission failed",
          {
            roomId,
            error: { type: "BlockchainError", message: blockchainError },
            attemptId,
          },
          correlationId,
        );
      }
    } catch (blockchainErrorObj: any) {
      blockchainError = blockchainErrorObj.message || "Unknown blockchain error";
      logBlockchainOperation(
        "error",
        "Room update blockchain submission error",
        {
          roomId,
          error: {
            type: blockchainErrorObj.name || "UnknownError",
            message: blockchainErrorObj.message || "Unknown error",
          },
        },
        correlationId,
      );
    }

    return NextResponse.json(
      {
        success: true,
        room: {
          ...updatedRoom,
          stellar_tx_hash: stellarTxHash,
          metadata_hash: metadataHash,
          memo_group_id: memoGroupId,
        },
        blockchain: {
          submitted: blockchainSubmitted,
          transactionHash: stellarTxHash || undefined,
          feeCharged: actualFeeCharged || undefined,
          explorerUrl: explorerUrl || undefined,
          memoGroupId: memoGroupId || undefined,
          error: blockchainError,
          isDuplicate,
          attemptId,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[rooms/[roomId]] PATCH error:", error);
    logBlockchainOperation(
      "error",
      "Room update failed",
      {
        roomId,
        error: {
          type: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      },
      correlationId,
    );
    return NextResponse.json({ error: "Failed to update room" }, { status: 500 });
  }
}
