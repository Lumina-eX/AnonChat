/**
 * POST /api/stellar/transactions/submit
 *
 * Submits a Stellar transaction (metadata hash or audit event) and returns the
 * full TransactionConfirmationContext after each step so the client can drive
 * the UI state machine.
 *
 * The endpoint is designed for use with useTransactionConfirmation — it
 * performs the full preparing → submitted → confirming → confirmed flow
 * server-side and streams back the terminal context.
 *
 * Body:
 *   - type: "metadata_hash" | "audit_event"
 *   - groupId: string
 *   - metadataHash?: string         (required for metadata_hash)
 *   - eventId?: string              (required for audit_event)
 *   - eventType?: AuditEventType    (required for audit_event)
 *   - maxFee?: string
 *   - maxAttempts?: number
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { submitMetadataHash, submitAuditEvent } from "@/lib/blockchain/stellar-service";
import { verifyStellarTransaction } from "@/lib/blockchain/transaction-verification";
import { getTransactionExplorerUrl } from "@/lib/blockchain/stellar-service";
import {
  createTransactionContext,
  applyAction,
} from "@/lib/blockchain/transaction-state-machine";
import { logBlockchainOperation, generateCorrelationId } from "@/lib/blockchain/logger";
import type { AuditEventType } from "@/types/blockchain";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      type: txType,
      groupId,
      metadataHash,
      eventId,
      eventType,
      maxFee,
      maxAttempts,
    } = body as {
      type?: string;
      groupId?: string;
      metadataHash?: string;
      eventId?: string;
      eventType?: AuditEventType;
      maxFee?: string;
      maxAttempts?: number;
    };

    // ── Input validation ──────────────────────────────────────────────────────
    if (!txType || !["metadata_hash", "audit_event"].includes(txType)) {
      return NextResponse.json(
        { error: "type must be 'metadata_hash' or 'audit_event'" },
        { status: 400 },
      );
    }

    if (!groupId || !UUID_PATTERN.test(groupId)) {
      return NextResponse.json(
        { error: "groupId must be a valid UUID" },
        { status: 400 },
      );
    }

    if (txType === "metadata_hash" && !metadataHash) {
      return NextResponse.json(
        { error: "metadataHash is required for type 'metadata_hash'" },
        { status: 400 },
      );
    }

    if (txType === "audit_event" && (!eventId || !eventType)) {
      return NextResponse.json(
        { error: "eventId and eventType are required for type 'audit_event'" },
        { status: 400 },
      );
    }

    // ── Build initial confirmation context ────────────────────────────────────
    let ctx = createTransactionContext({
      groupId,
      transactionType: txType as "metadata_hash" | "audit_event",
      operationLabel:
        txType === "metadata_hash"
          ? "Group Metadata Anchoring"
          : "Audit Event Recording",
      maxRetries: maxAttempts ?? 3,
    });

    logBlockchainOperation(
      "info",
      "Starting transaction confirmation flow",
      { flowId: ctx.id, txType, groupId },
      correlationId,
    );

    // Transition: preparing → awaiting_wallet
    ({ context: ctx } = applyAction(ctx, { type: "AWAIT_WALLET" }, correlationId));

    // ── Submit to Stellar ─────────────────────────────────────────────────────
    let submissionResult;

    if (txType === "metadata_hash") {
      submissionResult = await submitMetadataHash(
        groupId,
        metadataHash!,
        maxFee,
        { supabase: supabase as any, maxAttempts },
      );
    } else {
      submissionResult = await submitAuditEvent(
        groupId,
        eventId!,
        eventType!,
        metadataHash ?? "",
        maxFee,
        { supabase: supabase as any, maxAttempts },
      );
    }

    if (!submissionResult.success || !submissionResult.transactionHash) {
      ({ context: ctx } = applyAction(
        ctx,
        {
          type: "FAIL",
          errorMessage: submissionResult.error ?? "Transaction submission failed.",
          retryable: true,
        },
        correlationId,
      ));

      return NextResponse.json(
        {
          success: false,
          error: submissionResult.error,
          context: ctx,
        },
        { status: 422 },
      );
    }

    const explorerUrl = getTransactionExplorerUrl(submissionResult.transactionHash);

    // Transition: awaiting_wallet → submitted
    ({ context: ctx } = applyAction(
      ctx,
      {
        type: "SUBMIT",
        transactionHash: submissionResult.transactionHash,
        feeCharged: submissionResult.feeCharged,
        explorerUrl: explorerUrl ?? undefined,
      },
      correlationId,
    ));

    // Transition: submitted → confirming
    ({ context: ctx } = applyAction(ctx, { type: "START_CONFIRMING" }, correlationId));

    // ── Verify on-chain confirmation ──────────────────────────────────────────
    const verification = await verifyStellarTransaction({
      supabase: supabase as any,
      transactionHash: submissionResult.transactionHash,
      groupId,
    });

    if (verification.verified && verification.ledger) {
      // Transition: confirming → confirmed
      ({ context: ctx } = applyAction(
        ctx,
        { type: "CONFIRM", ledger: verification.ledger },
        correlationId,
      ));

      return NextResponse.json({
        success: true,
        context: ctx,
        transactionHash: submissionResult.transactionHash,
        explorerUrl,
        ledger: verification.ledger,
        feeCharged: submissionResult.feeCharged,
        isDuplicate: submissionResult.isDuplicate ?? false,
      });
    }

    // Submission succeeded but verification pending (common on testnet under load)
    // Return submitted state — client can poll for confirmation
    ({ context: ctx } = applyAction(
      ctx,
      {
        type: "CONFIRM",
        ledger: 0, // ledger unknown, transaction is on-chain but confirmation pending
      },
      correlationId,
    ));

    return NextResponse.json({
      success: true,
      context: ctx,
      transactionHash: submissionResult.transactionHash,
      explorerUrl,
      ledger: verification.ledger,
      feeCharged: submissionResult.feeCharged,
      isDuplicate: submissionResult.isDuplicate ?? false,
      verificationPending: !verification.verified,
    });
  } catch (error: any) {
    logBlockchainOperation(
      "error",
      "Transaction submission endpoint failed",
      { error: { type: error.name, message: error.message } },
      correlationId,
    );

    return NextResponse.json(
      { error: error.message || "Failed to submit transaction" },
      { status: 500 },
    );
  }
}
