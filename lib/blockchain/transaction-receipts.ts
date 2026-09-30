import type { SupabaseClientLike } from "@/lib/blockchain/stellar-service";

export const TRANSACTION_RECEIPT_STATUSES = ["pending", "confirmed", "failed"] as const;
export type TransactionReceiptStatus = (typeof TRANSACTION_RECEIPT_STATUSES)[number];

export type TransactionReceipt = {
  id: string;
  transaction_hash: string;
  operation_id: string;
  ledger_sequence: number | null;
  block_timestamp: string | null;
  confirmed_at: string | null;
  status: TransactionReceiptStatus;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type UpsertTransactionReceiptInput = {
  supabase: SupabaseClientLike;
  transactionHash: string;
  operationId: string;
  status?: TransactionReceiptStatus;
  ledgerSequence?: number | null;
  blockTimestamp?: string | null;
  confirmedAt?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
};

function receiptUpdates(input: UpsertTransactionReceiptInput) {
  const status = input.status ?? "pending";
  return {
    operation_id: input.operationId,
    ledger_sequence: input.ledgerSequence ?? null,
    block_timestamp: input.blockTimestamp ?? null,
    confirmed_at: input.confirmedAt ?? (status === "confirmed" ? new Date().toISOString() : null),
    status,
    error_message: input.errorMessage ?? null,
    metadata: input.metadata ?? {},
  };
}

/**
 * Creates or updates the single receipt for a transaction hash and records
 * every status transition in the append-only audit table.
 */
export async function upsertTransactionReceipt(
  input: UpsertTransactionReceiptInput,
): Promise<TransactionReceipt> {
  const updates = receiptUpdates(input);
  const { data: existing, error: lookupError } = await input.supabase
    .from("transaction_receipts")
    .select("*")
    .eq("transaction_hash", input.transactionHash)
    .maybeSingle();

  if (lookupError) throw lookupError;

  let receipt = existing as TransactionReceipt | null;
  if (receipt) {
    const { error } = await input.supabase
      .from("transaction_receipts")
      .update(updates)
      .eq("id", receipt.id);
    if (error) throw error;
    const { data, error: fetchError } = await input.supabase
      .from("transaction_receipts")
      .select("*")
      .eq("id", receipt.id)
      .single();
    if (fetchError) throw fetchError;
    receipt = data as TransactionReceipt;
  } else {
    const { data, error } = await input.supabase
      .from("transaction_receipts")
      .insert({ transaction_hash: input.transactionHash, ...updates })
      .select("*")
      .single();
    if (error) {
      // A concurrent retry may have won the unique hash constraint.
      const { data: concurrent, error: concurrentError } = await input.supabase
        .from("transaction_receipts")
        .select("*")
        .eq("transaction_hash", input.transactionHash)
        .single();
      if (concurrentError) throw error;
      receipt = concurrent as TransactionReceipt;
      const { error: updateError } = await input.supabase
        .from("transaction_receipts")
        .update(updates)
        .eq("id", receipt.id);
      if (updateError) throw updateError;
    } else {
      receipt = data as TransactionReceipt;
    }
  }

  const { error: auditError } = await input.supabase
    .from("transaction_receipt_events")
    .insert({
      receipt_id: receipt.id,
      status: updates.status,
      details: {
        operation_id: input.operationId,
        ledger_sequence: input.ledgerSequence ?? null,
        error_message: input.errorMessage ?? null,
      },
    });
  if (auditError) throw auditError;

  return receipt;
}

export async function getTransactionReceiptsByOperation(
  supabase: SupabaseClientLike,
  operationId: string,
): Promise<TransactionReceipt[]> {
  const { data, error } = await supabase
    .from("transaction_receipts")
    .select("*")
    .eq("operation_id", operationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TransactionReceipt[];
}