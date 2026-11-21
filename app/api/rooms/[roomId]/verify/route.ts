import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import {
  evaluateGroupVerification,
  toVerificationRecord,
  toVerificationResponse,
} from "@/lib/blockchain/group-verification";
import {
  getTransaction,
  getTransactionExplorerUrl,
} from "@/lib/blockchain/stellar-service";
import {
  logBlockchainOperation,
  generateCorrelationId,
} from "@/lib/blockchain/logger";

async function syncVerificationRecord(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roomId: string,
  record: ReturnType<typeof toVerificationRecord>,
) {
  const { error } = await supabase.from("group_verifications").upsert(record, {
    onConflict: "group_id",
  });

  if (error) {
    logBlockchainOperation(
      "warn",
      "Failed to sync group_verifications record",
      {
        groupId: roomId,
        error: { type: "DatabaseError", message: error.message },
      },
      generateCorrelationId(),
    );
  }
}

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

    const transaction = room.stellar_tx_hash
      ? await getTransaction(room.stellar_tx_hash)
      : null;

    const evaluation = evaluateGroupVerification(room, transaction);
    const explorerUrl = room.stellar_tx_hash
      ? getTransactionExplorerUrl(room.stellar_tx_hash)
      : null;

    logBlockchainOperation(
      evaluation.verified ? "info" : "warn",
      "Group verification evaluated",
      {
        groupId: roomId,
        verified: evaluation.verified,
        memoVerified: evaluation.memoVerified,
        walletOwnershipVerified: evaluation.walletOwnershipVerified,
        ...(evaluation.error
          ? {
              error: {
                type: "VerificationError",
                message: evaluation.error,
              },
            }
          : {}),
      },
      correlationId,
    );

    await syncVerificationRecord(
      supabase,
      roomId,
      toVerificationRecord(roomId, evaluation),
    );

    const response = toVerificationResponse(
      roomId,
      evaluation,
      explorerUrl,
      transaction?.memo ?? null,
    );

    return NextResponse.json(response);
  } catch (error: unknown) {
    const err = error as Error;
    logBlockchainOperation(
      "error",
      "Verification failed",
      {
        groupId: roomId,
        error: {
          type: err.name || "UnknownError",
          message: err.message || "Unknown error",
        },
      },
      correlationId,
    );

    return NextResponse.json(
      {
        error: "Failed to verify group on-chain status",
        message:
          "An unexpected error occurred while checking blockchain verification",
      },
      { status: 500 },
    );
  }
}
