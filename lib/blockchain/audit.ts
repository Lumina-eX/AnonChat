import { createHash, randomUUID } from "crypto";
import type { AuditEventType } from "@/types/blockchain";
import {
  submitAuditEvent,
  generateIdempotencyKey,
} from "@/lib/blockchain/stellar-service";
import { getExplorerUrl, loadStellarConfig } from "@/lib/blockchain/stellar-config";
import { logBlockchainOperation, generateCorrelationId } from "@/lib/blockchain/logger";
import { verifyStellarTransaction } from "@/lib/blockchain/transaction-verification";

type AuditStatus = "pending" | "submitted" | "failed";

export type RecordAuditEventInput = {
  supabase: any;
  groupId: string;
  eventType: AuditEventType;
  actorUserId?: string | null;
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
  maxFee?: string | number;
};

export type RecordedAuditEvent = {
  eventId: string;
  eventType: AuditEventType;
  transactionHash: string | null;
  status: AuditStatus;
  explorerUrl: string | null;
  error: string | null;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
}

function computeAuditMetadataHash(metadata: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(metadata)))
    .digest("hex");
}

function getAuditExplorerUrl(transactionHash: string | null): string | null {
  if (!transactionHash) return null;

  const config = loadStellarConfig();
  if (!config) return null;

  return getExplorerUrl(transactionHash, config.network);
}

export async function recordGroupAuditEvent({
  supabase,
  groupId,
  eventType,
  actorUserId,
  targetUserId,
  metadata = {},
  maxFee,
}: RecordAuditEventInput): Promise<RecordedAuditEvent | null> {
  const correlationId = generateCorrelationId();
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const eventMetadata = {
    ...metadata,
    group_id: groupId,
    event_id: eventId,
    event_type: eventType,
    actor_user_id: actorUserId ?? null,
    target_user_id: targetUserId ?? null,
    occurred_at: occurredAt,
  };
  const metadataHash = computeAuditMetadataHash(eventMetadata);

  // Generate idempotency key for this audit event
  const idempotencyKey = generateIdempotencyKey(groupId, "audit_event", `${eventId}:${metadataHash}`);

  const { error: insertError } = await supabase
    .from("group_audit_events")
    .insert({
      event_id: eventId,
      group_id: groupId,
      event_type: eventType,
      actor_user_id: actorUserId ?? null,
      target_user_id: targetUserId ?? null,
      status: "pending",
      metadata: eventMetadata,
      metadata_hash: metadataHash,
      created_at: occurredAt,
    });

  if (insertError) {
    logBlockchainOperation("error", "Failed to persist audit event before submission", {
      groupId,
      eventId,
      eventType,
      error: {
        type: "DatabaseError",
        message: insertError.message,
      },
    }, correlationId);
    return null;
  }

  // Submit with idempotency and retry logic
  const result = await submitAuditEvent(
    groupId,
    eventId,
    eventType,
    metadataHash,
    maxFee,
    {
      supabase,
      idempotencyKey,
    }
  );

  // Handle duplicate detection
  if (result.isDuplicate) {
    logBlockchainOperation("info", "Duplicate audit event detected, using existing result", {
      groupId,
      eventId,
      eventType,
      existingTxHash: result.transactionHash,
    }, correlationId);

    return {
      eventId,
      eventType,
      transactionHash: result.transactionHash ?? null,
      status: result.success ? "submitted" : "failed",
      explorerUrl: getAuditExplorerUrl(result.transactionHash ?? null),
      error: result.error ?? null,
    };
  }

  if (result.success && result.transactionHash) {
    const verification = await verifyStellarTransaction({
      supabase,
      transactionHash: result.transactionHash,
      groupActionEventId: eventId,
      groupId,
      expectedMemo: result.auditMemo ?? null,
    });

    if (!verification.verified) {
      logBlockchainOperation("warn", "Rejecting group audit event after failed transaction verification", {
        groupId,
        eventId,
        eventType,
        transactionHash: result.transactionHash,
        status: verification.status,
        error: verification.error ? { type: "VerificationError", message: verification.error } : undefined,
      }, correlationId);

      await supabase
        .from("group_audit_events")
        .update({
          status: "failed",
          transaction_hash: result.transactionHash,
          stellar_memo: result.auditMemo ?? null,
          submitted_at: new Date().toISOString(),
          error_message: verification.error ?? "Stellar transaction verification failed",
        })
        .eq("event_id", eventId);

      return {
        eventId,
        eventType,
        transactionHash: result.transactionHash,
        status: "failed",
        explorerUrl: getAuditExplorerUrl(result.transactionHash),
        error: verification.error ?? "Stellar transaction verification failed",
      };
    }

    const { error: updateError } = await supabase
      .from("group_audit_events")
      .update({
        status: "submitted",
        transaction_hash: result.transactionHash,
        stellar_memo: result.auditMemo ?? null,
        submitted_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("event_id", eventId);

    if (updateError) {
      logBlockchainOperation("warn", "Audit transaction verified but database update failed", {
        groupId,
        eventId,
        eventType,
        transactionHash: result.transactionHash,
        error: {
          type: "DatabaseError",
          message: updateError.message,
        },
      }, correlationId);
    }

    if (result.auditMemo) {
      const { error: memoInsertError } = await supabase
        .from("group_tx_memos")
        .insert({
          group_id: groupId,
          memo_group_id: result.auditMemo,
          tx_hash: result.transactionHash,
        });

      if (memoInsertError) {
        logBlockchainOperation("warn", "Audit transaction memo mapping failed", {
          groupId,
          eventId,
          eventType,
          transactionHash: result.transactionHash,
          error: {
            type: "DatabaseError",
            message: memoInsertError.message,
          },
        }, correlationId);
      }
    }

    return {
      eventId,
      eventType,
      transactionHash: result.transactionHash,
      status: "submitted",
      explorerUrl: getAuditExplorerUrl(result.transactionHash),
      error: null,
    };
  }

  const errorMessage = result.error ?? "Audit transaction failed";
  await supabase
    .from("group_audit_events")
    .update({
      status: "failed",
      stellar_memo: result.auditMemo ?? null,
      error_message: errorMessage,
    })
    .eq("event_id", eventId);

  return {
    eventId,
    eventType,
    transactionHash: null,
    status: "failed",
    explorerUrl: null,
    error: errorMessage,
  };
}
