import {
  getTransaction,
  getTransactionExplorerUrl,
} from "@/lib/blockchain/stellar-service";
import {
  generateCorrelationId,
  logBlockchainOperation,
} from "@/lib/blockchain/logger";
import type { SupabaseClientLike } from "@/lib/blockchain/stellar-service";
import type {
  StellarTransaction,
  StellarTransactionVerificationResult,
  StellarTransactionVerificationStatus,
} from "@/types/blockchain";
import { upsertTransactionReceipt } from "@/lib/blockchain/transaction-receipts";

export type VerifyStellarTransactionInput = {
  supabase?: SupabaseClientLike;
  transactionHash: string;
  groupActionEventId?: string | null;
  groupId?: string | null;
  expectedMemo?: string | null;
};

const STELLAR_TX_HASH_PATTERN = /^[a-fA-F0-9]{64}$/;

function verificationLogContext({
  transactionHash,
  groupActionEventId,
  groupId,
}: {
  transactionHash: string;
  groupActionEventId: string | null;
  groupId: string | null;
}) {
  return {
    transactionHash,
    groupActionEventId,
    ...(groupId ? { groupId } : {}),
  };
}

export function isValidTransactionHash(transactionHash: string): boolean {
  return STELLAR_TX_HASH_PATTERN.test(transactionHash);
}

export function classifyTransactionStatus(
  transaction: Pick<StellarTransaction, "successful"> | null,
): StellarTransactionVerificationStatus {
  if (!transaction) return "pending";
  return transaction.successful ? "successful" : "failed";
}

export function buildVerificationResult({
  transactionHash,
  transaction,
  groupActionEventId = null,
  groupId = null,
  expectedMemo = null,
  now = new Date(),
}: {
  transactionHash: string;
  transaction: StellarTransaction | null;
  groupActionEventId?: string | null;
  groupId?: string | null;
  expectedMemo?: string | null;
  now?: Date;
}): StellarTransactionVerificationResult {
  if (!isValidTransactionHash(transactionHash)) {
    return {
      transactionHash,
      status: "invalid",
      verified: false,
      groupActionEventId,
      groupId,
      ledger: null,
      memo: null,
      error: "Invalid Stellar transaction hash",
      verifiedAt: now.toISOString(),
      explorerUrl: null,
    };
  }

  const status = classifyTransactionStatus(transaction);
  const memoMatches =
    expectedMemo === null ||
    expectedMemo === undefined ||
    transaction?.memo === expectedMemo;
  const verified = status === "successful" && memoMatches;
  const memoError =
    status === "successful" && !memoMatches
      ? "Transaction memo does not match the expected group action"
      : null;
  const statusError =
    status === "failed"
      ? "Stellar transaction failed"
      : status === "pending"
        ? "Stellar transaction is pending or not found"
        : null;

  return {
    transactionHash,
    status,
    verified,
    groupActionEventId,
    groupId,
    ledger: transaction?.ledger ?? null,
    memo: transaction?.memo ?? null,
    error: memoError ?? statusError,
    verifiedAt: now.toISOString(),
    explorerUrl: getTransactionExplorerUrl(transactionHash),
  };
}

async function storeVerificationResult(
  supabase: SupabaseClientLike,
  result: StellarTransactionVerificationResult,
) {
  const { error } = await supabase.from("stellar_transaction_verifications").insert({
    transaction_hash: result.transactionHash,
    group_action_event_id: result.groupActionEventId,
    group_id: result.groupId,
    status: result.status,
    verified: result.verified,
    ledger: result.ledger,
    memo: result.memo,
    error_message: result.error,
    verified_at: result.verifiedAt,
  });

  if (error) throw error;
}

export async function verifyStellarTransaction({
  supabase,
  transactionHash,
  groupActionEventId = null,
  groupId = null,
  expectedMemo = null,
}: VerifyStellarTransactionInput): Promise<StellarTransactionVerificationResult> {
  const correlationId = generateCorrelationId();

  logBlockchainOperation(
    "info",
    "Starting Stellar transaction verification",
    verificationLogContext({
      transactionHash,
      groupActionEventId,
      groupId,
    }),
    correlationId,
  );

  const transaction = isValidTransactionHash(transactionHash)
    ? await getTransaction(transactionHash)
    : null;
  const result = buildVerificationResult({
    transactionHash,
    transaction,
    groupActionEventId,
    groupId,
    expectedMemo,
  });

  if (supabase) {
    try {
      await storeVerificationResult(supabase, result);
      if (groupActionEventId) {
        await upsertTransactionReceipt({
          supabase,
          transactionHash,
          operationId: groupActionEventId,
          status: result.status === "successful" ? "confirmed" : result.status === "failed" ? "failed" : "pending",
          ledgerSequence: result.ledger,
          blockTimestamp: transaction?.created_at ?? null,
          confirmedAt: result.status === "successful" ? result.verifiedAt : null,
          errorMessage: result.error,
          metadata: { group_id: groupId, memo: result.memo },
        });
      }
    } catch (error) {
      logBlockchainOperation(
        "error",
        "Failed to store Stellar transaction verification result",
        {
          ...verificationLogContext({
            transactionHash,
            groupActionEventId,
            groupId,
          }),
          error: {
            type: error instanceof Error ? error.name : "DatabaseError",
            message: error instanceof Error ? error.message : "Unknown database error",
          },
        },
        correlationId,
      );
      throw error;
    }
  }

  const logLevel = result.verified ? "info" : "warn";
  logBlockchainOperation(
    logLevel,
    "Completed Stellar transaction verification",
    {
      ...verificationLogContext({
        transactionHash,
        groupActionEventId,
        groupId,
      }),
      status: result.status,
      verified: result.verified,
      verificationError: result.error,
    },
    correlationId,
  );

  return result;
}
