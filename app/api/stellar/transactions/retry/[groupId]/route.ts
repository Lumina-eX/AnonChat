import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { retryFailedAttempt, getRetryableAttempts } from "@/lib/blockchain/stellar-service";
import { logBlockchainOperation, generateCorrelationId } from "@/lib/blockchain/logger";
import { requireGroupAccess } from "@/lib/middleware/group-access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const correlationId = generateCorrelationId();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accessCheck = await requireGroupAccess({ supabase, groupId, userId: user.id });
    if (accessCheck instanceof NextResponse) {
      return accessCheck;
    }

    const attempts = await getRetryableAttempts(supabase as any, groupId);

    return NextResponse.json({
      groupId,
      retryableAttempts: attempts.map((a) => ({
        id: a.id,
        submissionType: a.submission_type,
        status: a.status,
        attemptCount: a.attempt_count,
        maxAttempts: a.max_attempts,
        lastError: a.last_error,
        lastErrorType: a.last_error_type,
        nextRetryAt: a.next_retry_at,
        createdAt: a.created_at,
      })),
    });
  } catch (error: any) {
    logBlockchainOperation("error", "Failed to fetch retryable attempts", {
      groupId,
      error: { type: error.name || "UnknownError", message: error.message },
    }, correlationId);

    return NextResponse.json(
      { error: "Failed to fetch retryable attempts" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const correlationId = generateCorrelationId();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accessCheck = await requireGroupAccess({ supabase, groupId, userId: user.id });
    if (accessCheck instanceof NextResponse) {
      return accessCheck;
    }

    const body = await request.json();
    const { attemptId } = body;

    if (!attemptId) {
      return NextResponse.json(
        { error: "attemptId is required" },
        { status: 400 }
      );
    }

    logBlockchainOperation("info", "Manual retry requested", {
      groupId,
      attemptId,
      userId: user.id,
    }, correlationId);

    const result = await retryFailedAttempt(supabase as any, attemptId);

    if (result.success && result.transactionHash) {
      // Update the room record if this was a metadata hash submission
      const { data: attempt } = await supabase
        .from("stellar_transaction_attempts")
        .select("submission_type, stellar_tx_hash, stellar_memo, fee_charged, ledger")
        .eq("id", attemptId)
        .single();

      if (attempt?.submission_type === "metadata_hash") {
        await supabase
          .from("rooms")
          .update({
            stellar_tx_hash: attempt.stellar_tx_hash,
            memo_group_id: attempt.stellar_memo,
            blockchain_submitted_at: new Date().toISOString(),
          })
          .eq("id", groupId);
      }

      return NextResponse.json({
        success: true,
        transactionHash: result.transactionHash,
        feeCharged: result.feeCharged,
        explorerUrl: result.transactionHash
          ? `https://stellar.expert/explorer/testnet/tx/${result.transactionHash}`
          : null,
        message: "Transaction submitted successfully",
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: result.error || "Transaction retry failed",
        attemptId: result.attemptId,
      },
      { status: 422 }
    );
  } catch (error: any) {
    logBlockchainOperation("error", "Transaction retry failed", {
      groupId,
      error: { type: error.name || "UnknownError", message: error.message },
    }, correlationId);

    return NextResponse.json(
      { error: error.message || "Failed to retry transaction" },
      { status: 500 }
    );
  }
}
