// Stellar transaction audit verification service.
import {
  getTransaction,
  getTransactionExplorerUrl,
  getTransactionOperations,
} from "@/lib/blockchain/stellar-service";
import {
  generateCorrelationId,
  logBlockchainOperation,
} from "@/lib/blockchain/logger";
import { loadStellarConfig } from "@/lib/blockchain/stellar-config";
import type { SupabaseClientLike } from "@/lib/blockchain/stellar-service";
import type {
  StellarTransaction,
  StellarTransactionVerificationResult,
  StellarTransactionVerificationStatus,
} from "@/types/blockchain";

export type VerifyStellarTransactionInput = {
  supabase?: SupabaseClientLike;
  transactionHash: string;
  groupActionEventId?: string | null;
  groupId?: string | null;
  expectedMemo?: string | null;
  expectedOperationType?: string | null;
  expectedSourceAccount?: string | null;
  expectedDestinationAccount?: string | null;
  expectedAsset?: string | null;
  expectedAmount?: string | null;
  maxRetries?: number;
  retryDelayMs?: number;
};

const STELLAR_TX_HASH_PATTERN = /^[a-fA-F0-9]{64}$/;
const VERIFICATION_TABLE = "stellar_transaction_verifications";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

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

export type ExpectedOperation = {
  type?: string | null;
  sourceAccount?: string | null;
  destinationAccount?: string | null;
  asset?: string | null;
  amount?: string | null;
};

export type OperationValidationResult = {
  matched: boolean;
  error: string | null;
  details: Record<string, unknown> | null;
};

export function validateOperationsAgainstExpected(
  operations: Array<Record<string, unknown>> | null | undefined,
  expected: ExpectedOperation | null,
): OperationValidationResult {
  if (!expected) {
    return { matched: true, error: null, details: null };
  }

  const hasExpectation =
    Boolean(expected.type) ||
    Boolean(expected.sourceAccount) ||
    Boolean(expected.destinationAccount) ||
    Boolean(expected.asset) ||
    Boolean(expected.amount);

  if (!hasExpectation) {
    return { matched: true, error: null, details: null };
  }

  if (!operations || operations.length === 0) {
    return {
      matched: false,
      error: "Transaction has no operations to validate",
      details: null,
    };
  }

  const matchedOperation = operations.find((op) => {
    if (expected.type) {
      const opType = String(op.type ?? "").toLowerCase();
      if (opType !== expected.type.toLowerCase()) return false;
    }
    if (expected.sourceAccount) {
      const source = String(op.source_account ?? op.sourceAccount ?? "");
      if (source !== expected.sourceAccount) return false;
    }
    if (expected.destinationAccount) {
      const dest = String(
        op.destination_account ?? op.destinationAccount ?? op.account ?? "",
      );
      if (dest !== expected.destinationAccount) return false;
    }
    if (expected.asset) {
      const asset = String(op.asset ?? op.asset_code ?? "");
      if (asset !== expected.asset) return false;
    }
    if (expected.amount) {
      const amount = String(op.amount ?? "");
      if (amount !== expected.amount) return false;
    }
    return true;
  });

  if (!matchedOperation) {
    return {
      matched: false,
      error: "Transaction operations do not match the expected group action",
      details: { expected, operationCount: operations.length },
    };
  }

  return {
    matched: true,
    error: null,
    details: { expected, matchedOperation: matchedOperation },
  };
}

export function buildVerificationResult({
  transactionHash,
  transaction,
  groupActionEventId = null,
  groupId = null,
  expectedMemo = null,
  expectedNetwork = null,
  operationValidation = null,
  now = new Date(),
}: {
  transactionHash: string;
  transaction: StellarTransaction | null;
  groupActionEventId?: string | null;
  groupId?: string | null;
  expectedMemo?: string | null;
  expectedNetwork?: "testnet" | "mainnet" | null;
  operationValidation?: OperationValidationResult | null;
  now?: Date;
}): StellarTransactionVerificationResult {
  if (!isValidTransactionHash(transactionHash)) {
    return {
      transactionHash,
      status: "invalid",
      verified: false,
      groupActionEventId,
      groupId,
      ledge: null,
      memo: null,
      error: "Invalid Stellar transaction hash",
      verifiedAt: now.toISOString(),
      explorerUrl: null,
    };
  }

  // Network validation - reject transactions from a different network.
  if (expectedNetwork && transaction) {
    const txNetwork = (transaction.network ?? null) as "testnet" | "mainnet" | null;
    if (txNetwork && txNetwork !== expectedNetwork) {
      return {
        transactionHash,
        status: "failed",
        verified: false,
        groupActionEventId,
        groupId,
        ledge: transaction.ledge ?? null,
        memo: transaction.memo ?? null,
        error: "Transaction was retrieved from a different Stellar network",
        verifiedAt: now.toISOString(),
        explorerUrl: getTransactionExplorerUrl(transactionHash),
      };
    }
  }

  const status = classifyTransactionStatus(transaction);
  const memoMatches =
    expectedMemo === null ||
    expectedMemo === undefined ||
    transaction?.memo === expectedMemo;
  const operationMatches = operationValidation ? operationValidation.matched : true;
  const verified = status === "successful" && memoMatches && operationMatches;
  const memoError =
    status === "successful" && !memoMatches
      ? "Transaction memo does not match the expected group action"
      : null;
  const operationError =
    status === "successful" && memoMatches && !operationMatches
      ? (operationValidation?.error ?? "Transaction operations do not match the expected group action")
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
    ledge: transaction?.ledge ?? null,
    memo: transaction?.memo ?? null,
    error: memoError ?? operationError ?? statusError,
    verifiedAt: now.toISOString(),
    explorerUrl: getTransactionExplorerUrl(transactionHash),
  };
}

function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("timeout") ||
    lower.includes("network") ||
    lower.includes("econn") ||
    lower.includes("fetch") ||
    lower.includes("rate limit") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("service unavailable")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTransactionWithRetry(
  transactionHash: string,
  maxRetries: number,
  retryDelayMs: number,
  correlationId: string,
): Promise<StellarTransaction | null> {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= maxRetries) {
    try {
      const tx = await getTransaction(transactionHash);
      return tx ?? null;
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error;
      }
      logBlockchainOperation(
        "warn",
        "Retryable Horizon transaction retrieval failure",
        {
          transactionHash,
          attempt,
          maxRetries,
          error: {
            type: error instanceof Error ? error.name : "HorizonError",
            message: error instanceof Error ? error.message : String(error),
          },
        },
        correlationId,
      );
      attempt += 1;
      await sleep(retryDelayMs * attempt);
    }
  }

  throw lastError ?? new Error("Unknown Horizon transaction retrieval error");
}

async function fetchOperationsWithRetry(
  transactionHash: string,
  maxRetries: number,
  retryDelayMs: number,
  correlationId: string,
): Promise<Array<Record<string, unknown>> | null> {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= maxRetries) {
    try {
      const ops = await getTransactionOperations(transactionHash);
      return ops ?? null;
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error;
      }
      logBlockchainOperation(
        "warn",
        "Retryable Horizon operations retrieval failure",
        {
          transactionHash,
          attempt,
          maxRetries,
          error: {
            type: error instanceof Error ? error.name : "HorizonError",
            message: error instanceof Error ? error.message : String(error),
          },
        },
        correlationId,
      );
      attempt += 1;
      await sleep(retryDelayMs * attempt);
    }
  }

  throw lastError ?? new Error("Unknown Horizon operations retrieval error");
}

async function storeVerificationResult(
  supabase: SupabaseClientLike,
  result: StellarTransactionVerificationResult,
  extra: {
    network: string | null;
    ledgeCloseTime: string | null;
    transactionResult: string | null;
    validationDetails: Record<string, unknown> | null;
  },
) {
  // Idempotent write: delete existing row for this tx + action combination, then insert.
  // This prevents duplicate audit records for repeated verification requests.
  let deleteQuery = supabase
    .from(VERIFICATION_TABLE)
    .delete()
    .eq("transaction_hash", result.transactionHash);

  if (result.groupActionEventId) {
    deleteQuery = deleteQuery.eq(
      "group_action_event_id",
      result.groupActionEventId,
    );
  } else {
    deleteQuery = deleteQuery.is("group_action_event_id", null);
  }

  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw deleteError;

  const { error } = await supabase.from(VERIFICATION_TABLE).insert({
    transaction_hash: result.transactionHash,
    group_action_event_id: result.groupActionEventId,
    group_id: result.groupId,
    status: result.status,
    verified: result.verified,
    ledge: result.ledge,
    memo: result.memo,
    error_message: result.error,
    verified_at: result.verifiedAt,
    network: extra.network,
    ledger_close_time: extra.ledgeCloseTime,
    transaction_result: extra.transactionResult,
    validation_details: extra.validationDetails,
  });

  if (error) throw error;
}

export async function verifyStellarTransaction({
  supabase,
  transactionHash,
  groupActionEventId = null,
  groupId = null,
  expectedMemo = null,
  expectedOperationType = null,
  expectedSourceAccount = null,
  expectedDestinationAccount = null,
  expectedAsset = null,
  expectedAmount = null,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}: VerifyStellarTransactionInput): Promise<StellarTransactionVerificationResult> {
  const correlationId = generateCorrelationId();
  const config = loadStellarConfig();
  const expectedNetwork = config?.network ?? null;

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

  if (!isValidTransactionHash(transactionHash)) {
    return buildVerificationResult({
      transactionHash,
      transaction: null,
      groupActionEventId,
      groupId,
      expectedMemo,
      expectedNetwork,
    });
  }

  const transaction = await fetchTransactionWithRetry(
    transactionHash,
    maxRetries,
    retryDelayMs,
    correlationId,
  );

  let operationValidation: OperationValidationResult | null = null;
  if (transaction && transaction.successful) {
    const operations = await fetchOperationsWithRetry(
      transactionHash,
      maxRetries,
      retryDelayMs,
      correlationId,
    );
    operationValidation = validateOperationsAgainstExpected(operations, {
      type: expectedOperationType,
      sourceAccount: expectedSourceAccount,
      destinationAccount: expectedDestinationAccount,
      asset: expectedAsset,
      amount: expectedAmount,
    });
  }

  const result = buildVerificationResult({
    transactionHash,
    transaction,
    groupActionEventId,
    groupId,
    expectedMemo,
    expectedNetwork,
    operationValidation,
  });

  if (supabase) {
    await storeVerificationResult(supabase, result, {
      network: expectedNetwork,
      ledgeCloseTime: transaction?.createdAt ?? null,
      transactionResult: transaction
        ? transaction.successful
          ? "success"
          : "failed"
        : null,
      validationDetails: operationValidation?.details ?? null,
    });
  }

  logBlockchainOperation(
    result.verified ? "info" : "warn",
    "Stellar transaction verification completed",
    verificationLogContext({
      transactionHash,
      groupActionEventId,
      groupId,
    }),
    correlationId,
  );

  return result;
}
