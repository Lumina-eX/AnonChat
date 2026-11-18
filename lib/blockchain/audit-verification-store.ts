/**
 * Supabase storage layer for transaction audit verification records.
 *
 * All writes are idempotent: a record for a given (transaction_hash, expected_action)
 * pair is inserted once. Subsequent verification runs for the same pair return the
 * existing record rather than creating a duplicate. When a re-verification reaches a
 * more definitive state (e.g. successful replaces pending), the existing row is updated
 * instead.
 *
 * Table: transaction_audit_verifications
 * Migration: scripts/020_transaction_audit_verifications.sql
 */

import type {
  AuditVerificationResult,
  AnonChatAction,
  StellarTransactionVerificationStatus,
  TransactionAuditRecord,
} from "@/types/blockchain";
import { logBlockchainOperation } from "@/lib/blockchain/logger";

// ── Supabase type shims ───────────────────────────────────────────────────────

type SupabaseErrorLike = { message: string; code?: string };

type SelectResult<T> = PromiseLike<{ data: T | null; error: SupabaseErrorLike | null }>;
type MutationResult = PromiseLike<{ error: SupabaseErrorLike | null }>;
type UpsertResult = PromiseLike<{
  data: TransactionAuditRecord[] | null;
  error: SupabaseErrorLike | null;
}>;

type SupabaseClientLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        eq: (col: string, val: unknown) => {
          order?: (col: string, opts?: { ascending?: boolean }) => {
            limit: (n: number) => SelectResult<TransactionAuditRecord[]>;
          };
          limit?: (n: number) => SelectResult<TransactionAuditRecord[]>;
          maybeSingle: () => SelectResult<TransactionAuditRecord>;
        };
        maybeSingle: () => SelectResult<TransactionAuditRecord>;
        order: (col: string, opts?: { ascending?: boolean }) => {
          limit: (n: number) => SelectResult<TransactionAuditRecord[]>;
        };
      };
    };
    upsert: (
      values: Partial<TransactionAuditRecord>,
      opts: { onConflict: string; ignoreDuplicates?: boolean },
    ) => UpsertResult;
    update: (values: Partial<TransactionAuditRecord>) => {
      eq: (col: string, val: unknown) => MutationResult;
    };
  };
};

const TABLE = "transaction_audit_verifications";

/**
 * State precedence — higher numbers represent more definitive states.
 * We only write an update when the new state is more definitive than the
 * currently stored state, preventing a pending retry from overwriting a
 * previously resolved successful record.
 */
const STATUS_RANK: Record<StellarTransactionVerificationStatus, number> = {
  pending: 0,
  unverifiable: 1,
  invalid: 2,
  failed: 3,
  successful: 4,
};

function isMoreDefinitive(
  incoming: StellarTransactionVerificationStatus,
  current: StellarTransactionVerificationStatus,
): boolean {
  return STATUS_RANK[incoming] > STATUS_RANK[current];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Finds an existing audit record for the (transactionHash, expectedAction) pair.
 * Returns null when no record exists.
 */
export async function findAuditRecord(
  supabase: SupabaseClientLike,
  transactionHash: string,
  expectedAction: AnonChatAction,
  correlationId?: string,
): Promise<TransactionAuditRecord | null> {
  try {
    const { data, error } = await (supabase
      .from(TABLE)
      .select("*")
      .eq("transaction_hash", transactionHash)
      .eq("expected_action", expectedAction) as any).maybeSingle();

    if (error) {
      logBlockchainOperation(
        "warn",
        "audit-store: lookup query failed",
        { transactionHash, expectedAction, error: { type: "DatabaseError", message: error.message } },
        correlationId,
      );
      return null;
    }

    return data ?? null;
  } catch (err) {
    logBlockchainOperation(
      "warn",
      "audit-store: unexpected error during lookup",
      { transactionHash, expectedAction, error: { type: "UnknownError", message: String(err) } },
      correlationId,
    );
    return null;
  }
}

/**
 * Stores a new audit verification record, or updates the existing row when
 * the incoming status is more definitive than the stored status.
 *
 * Returns `{ written: true }` when the row was inserted or updated,
 * `{ written: false }` when the existing record was left unchanged.
 */
export async function saveAuditRecord(
  supabase: SupabaseClientLike,
  result: AuditVerificationResult,
  correlationId?: string,
): Promise<{ written: boolean; existing: boolean }> {
  // 1. Check for an existing record first (idempotency guard).
  const existing = await findAuditRecord(
    supabase,
    result.transactionHash,
    result.expectedAction,
    correlationId,
  );

  if (existing) {
    // Only update when the incoming status is strictly more informative.
    if (!isMoreDefinitive(result.status, existing.status as StellarTransactionVerificationStatus)) {
      logBlockchainOperation(
        "info",
        "audit-store: skipping update — existing record is equally or more definitive",
        {
          transactionHash: result.transactionHash,
          existingStatus: existing.status,
          incomingStatus: result.status,
        },
        correlationId,
      );
      return { written: false, existing: true };
    }

    // Promote the record to the more definitive state.
    const updatePayload: Partial<TransactionAuditRecord> = {
      status: result.status,
      verified: result.verified,
      ledger: result.ledger ?? undefined,
      ledger_close_time: result.ledgerCloseTime ?? undefined,
      source_account: result.sourceAccount ?? undefined,
      operation_count: result.operationCount ?? undefined,
      operation_type: result.operationType ?? undefined,
      error_message: result.error ?? undefined,
      diagnostic_details: result.diagnosticDetails ?? undefined,
      verified_at: result.verifiedAt,
      retry_count: result.retryCount,
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from(TABLE)
      .update(updatePayload)
      .eq("transaction_hash", result.transactionHash)
      .eq("expected_action", result.expectedAction);

    if (updateError) {
      logBlockchainOperation(
        "error",
        "audit-store: failed to update record",
        {
          transactionHash: result.transactionHash,
          error: { type: "DatabaseError", message: updateError.message },
        },
        correlationId,
      );
      throw new Error(`Failed to update audit record: ${updateError.message}`);
    }

    logBlockchainOperation(
      "info",
      "audit-store: updated existing record to more definitive state",
      {
        transactionHash: result.transactionHash,
        previousStatus: existing.status,
        newStatus: result.status,
      },
      correlationId,
    );

    return { written: true, existing: true };
  }

  // 2. No existing record — insert fresh.
  const record: Omit<TransactionAuditRecord, "id" | "created_at" | "updated_at"> = {
    transaction_hash: result.transactionHash,
    network_identifier: result.networkIdentifier,
    ledger: result.ledger,
    ledger_close_time: result.ledgerCloseTime,
    source_account: result.sourceAccount,
    operation_count: result.operationCount,
    operation_type: result.operationType,
    expected_action: result.expectedAction,
    group_id: result.groupId,
    status: result.status,
    verified: result.verified,
    retry_count: result.retryCount,
    error_message: result.error,
    diagnostic_details: result.diagnosticDetails,
    verified_at: result.verifiedAt,
  };

  const { error: insertError } = await supabase
    .from(TABLE)
    .upsert(record as any, {
      onConflict: "transaction_hash,expected_action",
      ignoreDuplicates: false,
    });

  if (insertError) {
    // Conflict on unique key means a concurrent request won the race — not an error.
    if (insertError.code === "23505") {
      logBlockchainOperation(
        "info",
        "audit-store: concurrent insert detected, record already exists",
        { transactionHash: result.transactionHash },
        correlationId,
      );
      return { written: false, existing: true };
    }

    logBlockchainOperation(
      "error",
      "audit-store: insert failed",
      {
        transactionHash: result.transactionHash,
        error: { type: "DatabaseError", message: insertError.message },
      },
      correlationId,
    );
    throw new Error(`Failed to save audit record: ${insertError.message}`);
  }

  logBlockchainOperation(
    "info",
    "audit-store: inserted new audit record",
    {
      transactionHash: result.transactionHash,
      status: result.status,
      expectedAction: result.expectedAction,
    },
    correlationId,
  );

  return { written: true, existing: false };
}
