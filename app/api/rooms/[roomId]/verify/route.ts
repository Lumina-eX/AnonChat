import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import { computeHash } from "@/lib/blockchain/metadata-hash";
import {
  getTransaction,
  getTransactionExplorerUrl,
} from "@/lib/blockchain/stellar-service";
import { GroupMetadata, VerificationResponse } from "@/types/blockchain";
import {
  logBlockchainOperation,
  generateCorrelationId,
} from "@/lib/blockchain/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  const correlationId = generateCorrelationId();
  const roomId = params.roomId;

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

    const currentMetadata: GroupMetadata = {
      id: room.id,
      name: room.name,
      description: room.description,
      created_by: room.created_by,
      created_at: room.created_at,
      is_private: room.is_private,
    };

    const currentMetadataHash = computeHash(currentMetadata);

    logBlockchainOperation(
      "info",
      "Verifying room metadata",
      {
        groupId: roomId,
        currentMetadataHash,
        storedTxHash: room.stellar_tx_hash,
      },
      correlationId
    );

    if (!room.stellar_tx_hash) {
      const response: VerificationResponse = {
        groupId: roomId,
        currentMetadataHash,
        blockchainMetadataHash: null,
        transactionHash: null,
        verified: false,
        explorerUrl: null,
      };

      return NextResponse.json(response);
    }

    const transaction = await getTransaction(room.stellar_tx_hash);

    if (!transaction) {
      const response: VerificationResponse = {
        groupId: roomId,
        currentMetadataHash,
        blockchainMetadataHash: null,
        transactionHash: room.stellar_tx_hash,
        verified: false,
        explorerUrl: getTransactionExplorerUrl(room.stellar_tx_hash),
      };

      return NextResponse.json(response);
    }

    const blockchainMetadataHash = transaction.memo;
    const verified = currentMetadataHash === blockchainMetadataHash;

    const response: VerificationResponse = {
      groupId: roomId,
      currentMetadataHash,
      blockchainMetadataHash,
      transactionHash: room.stellar_tx_hash,
      verified,
      explorerUrl: getTransactionExplorerUrl(room.stellar_tx_hash),
    };

    return NextResponse.json(response);
  } catch (error: any) {
    logBlockchainOperation(
      "error",
      "Verification failed",
      {
        groupId: roomId,
        error: {
          type: error?.name || "UnknownError",
          message: error?.message || "Unknown error",
        },
      },
      correlationId
    );

    return NextResponse.json(
      { error: "Failed to verify room metadata" },
      { status: 500 }
    );
  }
}