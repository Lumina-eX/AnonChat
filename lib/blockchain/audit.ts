import { createHash, randomUUID } from "crypto";
import type { AuditEventType } from "@/types/blockchain";
import { submitAuditEvent } from "@/lib/blockchain/stellar-service";
import { getExplorerUrl, loadStellarConfig } from "@/lib/blockchain/stellar-config";
import { logBlockchainOperation, generateCorrelationId } from "@/lib/blockchain/logger";

type SupabaseErrorLike = { message: string };
type SupabaseMutationResult = PromiseLike<{ error: SupabaseErrorLike | null }>;
type SupabaseUpdateBuilder = {
  eq: (column: string, value: string) => SupabaseMutationResult;
};
type SupabaseTableLike = {
  insert: (values: Record<string, unknown>) => SupabaseMutationResult;
  update: (values: Record<string, unknown>) => SupabaseUpdateBuilder;
};
type SupabaseClientLike = {
  from: (table: string) => SupabaseTableLike;
};

type AuditStatus = "pending" | "submitted" | "failed";

export type RecordAuditEventInput = {
  supabase: SupabaseClientLike;
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

  const result = await submitAuditEvent(groupId, eventId, eventType, metadataHash, maxFee);

  if (result.success && result.transactionHash) {
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
      logBlockchainOperation("warn", "Audit transaction submitted but database update failed", {
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
