import * as StellarSdk from "@stellar/stellar-sdk";
import { createHash, randomUUID } from "crypto";
import {
  AuditEventType,
  StellarTransactionResult,
  StellarTransaction,
} from "@/types/blockchain";
import { loadStellarConfig, isConfigured, getExplorerUrl } from "./stellar-config";
import { logBlockchainOperation, generateCorrelationId } from "./logger";
import { deriveMemoGroupId, validateMemoGroupId, STELLAR_MEMO_MAX_BYTES } from "./memo";

// Retry configuration
const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;

/**
 * Determines if an error is retryable based on its type and content.
 */
function isRetryableError(error: any): boolean {
  if (!error) return false;

  const message = (error.message || "").toLowerCase();
  const name = (error.name || "").toLowerCase();

  // Retry on timeout, network errors, and rate limiting
  if (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("socket") ||
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("504") ||
    name.includes("timeouterror") ||
    name.includes("networkerror")
  ) {
    return true;
  }

  // Check for Horizon-specific error codes
  if (error.response) {
    const status = error.response.status;
    if (status === 429 || status === 502 || status === 503 || status === 504) {
      return true;
    }
  }

  // Stellar SDK BadResponseError for retryable status codes
  if (name.includes("badresponseerror")) {
    const status = error.response?.status;
    if (status === 429 || status === 502 || status === 503 || status === 504) {
      return true;
    }
  }

  return false;
}

/**
 * Calculates exponential backoff delay with jitter.
 */
function calculateBackoffDelay(attempt: number): number {
  const exponentialDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 1000;
  return Math.min(exponentialDelay + jitter, MAX_RETRY_DELAY_MS);
}

/**
 * Generates a deterministic idempotency key for a submission.
 * Same payload will always produce the same key.
 */
export function generateIdempotencyKey(
  groupId: string,
  submissionType: "metadata_hash" | "audit_event",
  payload: string
): string {
  const hash = createHash("sha256")
    .update(`${groupId}:${submissionType}:${payload}`)
    .digest("hex");
  return `stellar_attempt_${hash.slice(0, 32)}`;
}

/**
 * Supabase client interface for database operations
 */
type SupabaseInsertResult = PromiseLike<{ error: any; data?: any }> & {
  select: (columns?: string) => SupabaseInsertResult;
  single: () => PromiseLike<{ error: any; data: any }>;
};

type SupabaseSelectResult = PromiseLike<{ data: any; error: any }> & {
  eq: (column: string, value: string) => SupabaseSelectResult;
  in: (column: string, values: any[]) => SupabaseSelectResult;
  order: (column: string, options: { ascending: boolean }) => SupabaseSelectResult;
  limit: (count: number) => SupabaseSelectResult;
  single: () => PromiseLike<{ data: any; error: any }>;
  maybeSingle: () => PromiseLike<{ data: any; error: any }>;
};

type SupabaseTableLike = {
  insert: (values: Record<string, unknown>) => SupabaseInsertResult;
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: string) => PromiseLike<{ error: any }>;
    match: (values: Record<string, unknown>) => PromiseLike<{ error: any }>;
  };
  select: (columns?: string) => SupabaseSelectResult;
};

export type SupabaseClientLike = {
  from: (table: string) => SupabaseTableLike;
};

export type RecordAttemptInput = {
  supabase: SupabaseClientLike;
  idempotencyKey: string;
  submissionType: "metadata_hash" | "audit_event";
  groupId: string;
  payloadHash: string;
  auditEventId?: string;
  maxAttempts?: number;
};

/**
 * Records a transaction attempt in the database.
 * Returns existing attempt if idempotency key already exists.
 */
export async function recordTransactionAttempt({
  supabase,
  idempotencyKey,
  submissionType,
  groupId,
  payloadHash,
  auditEventId,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}: RecordAttemptInput): Promise<{ attempt: any; isDuplicate: boolean } | null> {
  // Check for existing attempt with same idempotency key
  const { data: existing } = await supabase
    .from("stellar_transaction_attempts")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    // If previous attempt was successful, return as duplicate
    if (existing.status === "submitted") {
      return { attempt: existing, isDuplicate: true };
    }
    // If previous attempt failed but retries remain, we can retry
    if (existing.status === "failed" && existing.attempt_count < existing.max_attempts) {
      return { attempt: existing, isDuplicate: false };
    }
    // If max attempts reached, mark as expired
    if (existing.status === "failed" && existing.attempt_count >= existing.max_attempts) {
      await supabase
        .from("stellar_transaction_attempts")
        .update({ status: "expired" })
        .eq("id", existing.id);
      return { attempt: existing, isDuplicate: true };
    }
    return { attempt: existing, isDuplicate: false };
  }

  // Create new attempt record
  const { data: created, error } = await supabase
    .from("stellar_transaction_attempts")
    .insert({
      idempotency_key: idempotencyKey,
      submission_type: submissionType,
      group_id: groupId,
      audit_event_id: auditEventId ?? null,
      payload_hash: payloadHash,
      status: "pending",
      attempt_count: 0,
      max_attempts: maxAttempts,
    })
    .select()
    .single();

  if (error) {
    logBlockchainOperation("warn", "Failed to record transaction attempt", {
      idempotencyKey,
      groupId,
      error: { type: "DatabaseError", message: error.message },
    });
    return null;
  }

  return { attempt: created, isDuplicate: false };
}

/**
 * Updates a transaction attempt with submission result.
 */
export async function updateTransactionAttemptStatus(
  supabase: SupabaseClientLike,
  attemptId: string,
  updates: {
    status?: string;
    stellarTxHash?: string;
    stellarMemo?: string;
    feeCharged?: string;
    ledger?: number;
    lastError?: string;
    lastErrorType?: string;
    lastErrorCode?: string;
    submittedAt?: string;
    confirmedAt?: string;
    failedAt?: string;
    incrementAttempt?: boolean;
    nextRetryAt?: string;
  }
): Promise<void> {
  const dbUpdates: Record<string, unknown> = { ...updates };
  delete dbUpdates.incrementAttempt;

  if (updates.incrementAttempt) {
    // Atomic increment via raw SQL would be better, but for now fetch and update
    const { data: current } = await supabase
      .from("stellar_transaction_attempts")
      .select("attempt_count")
      .eq("id", attemptId)
      .single();

    if (current) {
      dbUpdates.attempt_count = (current.attempt_count || 0) + 1;
    }
  }

  const { error } = await supabase
    .from("stellar_transaction_attempts")
    .update(dbUpdates)
    .eq("id", attemptId);

  if (error) {
    logBlockchainOperation("warn", "Failed to update transaction attempt", {
      attemptId,
      error: { type: "DatabaseError", message: error.message },
    });
  }
}

/**
 * Submits a transaction to Stellar with retry logic and exponential backoff.
 */
async function submitWithRetry(
  server: StellarSdk.Horizon.Server,
  transaction: StellarSdk.Transaction,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  correlationId?: string
): Promise<{ result: any; attempts: number }> {
  let lastError: any;
  let attempts: number;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;

    try {
      logBlockchainOperation("info", `Transaction submission attempt ${attempt}/${maxAttempts}`, {
        attempt,
        maxAttempts,
      }, correlationId);

      const result = await server.submitTransaction(transaction);

      if (attempt > 1) {
        logBlockchainOperation("info", `Transaction succeeded after ${attempt} attempts`, {
          attempt,
          transactionHash: result.hash,
        }, correlationId);
      }

      return { result, attempts };
    } catch (error: any) {
      lastError = error;
      const retryable = isRetryableError(error);

      logBlockchainOperation(
        retryable && attempt < maxAttempts ? "warn" : "error",
        `Transaction submission failed (attempt ${attempt}/${maxAttempts})`,
        {
          attempt,
          maxAttempts,
          retryable,
          error: {
            type: error.name || "UnknownError",
            message: error.message || "Unknown error",
          },
        },
        correlationId
      );

      // Don't retry non-retryable errors
      if (!retryable || attempt >= maxAttempts) {
        break;
      }

      // Calculate backoff delay
      const delay = calculateBackoffDelay(attempt);
      logBlockchainOperation("info", `Retrying in ${Math.round(delay)}ms`, {
        delay,
        attempt,
      }, correlationId);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Submits a metadata hash to the Stellar blockchain with idempotency and retry.
 */
export async function submitMetadataHash(
  groupId: string,
  metadataHash: string,
  maxFee?: string | number,
  options?: {
    supabase?: SupabaseClientLike;
    idempotencyKey?: string;
    maxAttempts?: number;
    skipDuplicateCheck?: boolean;
  }
): Promise<StellarTransactionResult & { attemptId?: string; isDuplicate?: boolean }> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  // Check configuration
  if (!isConfigured()) {
    logBlockchainOperation("warn", "Skipping blockchain submission - configuration missing", {
      groupId,
      metadataHash,
      configured: false,
    }, correlationId);

    return {
      success: false,
      error: "Stellar configuration not available",
    };
  }

  const config = loadStellarConfig();
  if (!config) {
    return {
      success: false,
      error: "Failed to load Stellar configuration",
    };
  }

  // Derive the group memo from the room ID
  const memoGroupId = deriveMemoGroupId(groupId);

  // Validate the derived memo before building the transaction
  const memoValidation = validateMemoGroupId(memoGroupId);
  if (!memoValidation.valid) {
    logBlockchainOperation("error", "Invalid memo derived for group", {
      groupId,
      memoGroupId,
      reason: memoValidation.reason,
    }, correlationId);
    return {
      success: false,
      error: `Memo validation failed: ${memoValidation.reason}`,
    };
  }

  // Idempotency check
  let attemptId: string | undefined;
  let isDuplicate = false;

  if (options?.supabase && !options?.skipDuplicateCheck) {
    const idempotencyKey = options.idempotencyKey || generateIdempotencyKey(groupId, "metadata_hash", metadataHash);
    const attemptResult = await recordTransactionAttempt({
      supabase: options.supabase,
      idempotencyKey,
      submissionType: "metadata_hash",
      groupId,
      payloadHash: metadataHash,
      maxAttempts: options.maxAttempts,
    });

    if (attemptResult) {
      if (attemptResult.isDuplicate) {
        const existing = attemptResult.attempt;
        logBlockchainOperation("info", "Duplicate submission detected, skipping", {
          groupId,
          idempotencyKey,
          existingStatus: existing.status,
          existingTxHash: existing.stellar_tx_hash,
        }, correlationId);

        return {
          success: existing.status === "submitted",
          transactionHash: existing.stellar_tx_hash ?? undefined,
          memoGroupId: existing.stellar_memo ?? undefined,
          feeCharged: existing.fee_charged ?? undefined,
          attemptId: existing.id,
          isDuplicate: true,
        };
      }
      attemptId = attemptResult.attempt?.id;
    }
  }

  logBlockchainOperation("info", "Initiating blockchain transaction", {
    groupId,
    metadataHash,
    network: config.network,
    attemptId,
  }, correlationId);

  try {
    // Initialize Stellar SDK
    const server = new StellarSdk.Horizon.Server(config.horizonUrl);
    const sourceKeypair = StellarSdk.Keypair.fromSecret(config.sourceSecret);
    const sourcePublicKey = sourceKeypair.publicKey();

    // Load source account with retry
    let account;
    try {
      account = await Promise.race([
        server.loadAccount(sourcePublicKey),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout loading account")), config.transactionTimeout)
        ),
      ]);
    } catch (loadError: any) {
      // Check if account needs funding
      if (loadError.response?.status === 404) {
        const errorMsg = "Stellar source account not found. Account may need funding.";
        logBlockchainOperation("error", errorMsg, {
          groupId,
          sourcePublicKey,
        }, correlationId);

        if (attemptId && options?.supabase) {
          await updateTransactionAttemptStatus(options.supabase, attemptId, {
            status: "failed",
            lastError: errorMsg,
            lastErrorType: "AccountNotFoundError",
            failedAt: new Date().toISOString(),
            incrementAttempt: true,
          });
        }

        return {
          success: false,
          error: errorMsg,
          attemptId,
        };
      }
      throw loadError;
    }

    logBlockchainOperation("info", "Derived group memo for transaction", {
      groupId,
      memoGroupId,
      memoByteLength: Buffer.byteLength(memoGroupId, "utf8"),
      memoMaxBytes: STELLAR_MEMO_MAX_BYTES,
    }, correlationId);

    const feeToUse = maxFee ? maxFee.toString() : StellarSdk.BASE_FEE;

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: feeToUse,
      networkPassphrase: config.network === "testnet"
        ? StellarSdk.Networks.TESTNET
        : StellarSdk.Networks.PUBLIC,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: sourcePublicKey,
          asset: StellarSdk.Asset.native(),
          amount: "0.0000001",
        })
      )
      .addMemo(StellarSdk.Memo.text(memoGroupId))
      .setTimeout(30)
      .build();

    // Sign transaction
    transaction.sign(sourceKeypair);

    // Submit with retry logic
    const maxAttempts = options?.maxAttempts || DEFAULT_MAX_ATTEMPTS;
    const { result, attempts } = await submitWithRetry(
      server,
      transaction,
      maxAttempts,
      correlationId
    );

    const duration = Date.now() - startTime;
    const feeCharged = (result as any).fee_charged ? (result as any).fee_charged.toString() : feeToUse.toString();

    logBlockchainOperation("info", "Blockchain transaction successful", {
      groupId,
      metadataHash,
      memoGroupId,
      transactionHash: result.hash,
      feeCharged,
      duration,
      ledger: result.ledger,
      attempts,
    }, correlationId);

    // Update attempt record with success
    if (attemptId && options?.supabase) {
      await updateTransactionAttemptStatus(options.supabase, attemptId, {
        status: "submitted",
        stellarTxHash: result.hash,
        stellarMemo: memoGroupId,
        feeCharged,
        ledger: result.ledger,
        submittedAt: new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
        incrementAttempt: true,
      });
    }

    return {
      success: true,
      transactionHash: result.hash,
      feeCharged,
      memoGroupId,
      attemptId,
      isDuplicate: false,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const retryable = isRetryableError(error);
    const errorType = error.name || "UnknownError";
    const errorMessage = error.message || "Transaction failed";
    const errorCode = error.response?.status?.toString() || error.extras?.result_codes?.operations?.join(",");

    logBlockchainOperation("error", "Blockchain transaction failed", {
      groupId,
      metadataHash,
      duration,
      retryable,
      error: {
        type: errorType,
        message: errorMessage,
      },
    }, correlationId);

    // Update attempt record with failure
    if (attemptId && options?.supabase) {
      const nextRetryAt = retryable
        ? new Date(Date.now() + calculateBackoffDelay(1)).toISOString()
        : undefined;

      await updateTransactionAttemptStatus(options.supabase, attemptId, {
        status: "failed",
        lastError: errorMessage,
        lastErrorType: errorType,
        lastErrorCode: errorCode,
        failedAt: new Date().toISOString(),
        incrementAttempt: true,
        nextRetryAt,
      });
    }

    // Provide user-friendly error messages
    let userError = errorMessage;
    if (errorMessage.includes("op_underfunded")) {
      userError = "Insufficient XLM balance to complete the transaction. Please fund your account.";
    } else if (errorMessage.includes("tx_insufficient_fee")) {
      userError = "Network fee too low. Please try again with a higher fee.";
    } else if (errorMessage.includes("tx_bad_seq")) {
      userError = "Transaction sequence error. Please try again.";
    } else if (errorMessage.includes("timeout")) {
      userError = "The network request timed out. Please try again.";
    } else if (!retryable && errorMessage === "Transaction failed") {
      userError = "Transaction was rejected by the network. Please check your account and try again.";
    }

    return {
      success: false,
      error: userError,
      attemptId,
      isDuplicate: false,
    };
  }
}

/**
 * Submits an immutable audit marker to Stellar with idempotency and retry.
 */
export async function submitAuditEvent(
  groupId: string,
  eventId: string,
  eventType: AuditEventType,
  metadataHash: string,
  maxFee?: string | number,
  options?: {
    supabase?: SupabaseClientLike;
    idempotencyKey?: string;
    maxAttempts?: number;
    skipDuplicateCheck?: boolean;
  }
): Promise<StellarTransactionResult & { attemptId?: string; isDuplicate?: boolean }> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  if (!isConfigured()) {
    logBlockchainOperation("warn", "Skipping audit transaction - configuration missing", {
      groupId,
      eventId,
      eventType,
      metadataHash,
      configured: false,
    }, correlationId);

    return {
      success: false,
      error: "Stellar configuration not available",
    };
  }

  const config = loadStellarConfig();
  if (!config) {
    return {
      success: false,
      error: "Failed to load Stellar configuration",
    };
  }

  const auditMemo = deriveMemoGroupId(groupId);
  const memoValidation = validateMemoGroupId(auditMemo);
  if (!memoValidation.valid) {
    return {
      success: false,
      error: `Audit memo validation failed: ${memoValidation.reason}`,
    };
  }

  // Idempotency check
  let attemptId: string | undefined;
  let isDuplicate = false;

  if (options?.supabase && !options?.skipDuplicateCheck) {
    const idempotencyKey = options.idempotencyKey || generateIdempotencyKey(groupId, "audit_event", `${eventId}:${metadataHash}`);
    const attemptResult = await recordTransactionAttempt({
      supabase: options.supabase,
      idempotencyKey,
      submissionType: "audit_event",
      groupId,
      payloadHash: `${eventId}:${metadataHash}`,
      auditEventId: eventId,
      maxAttempts: options.maxAttempts,
    });

    if (attemptResult) {
      if (attemptResult.isDuplicate) {
        const existing = attemptResult.attempt;
        return {
          success: existing.status === "submitted",
          transactionHash: existing.stellar_tx_hash ?? undefined,
          auditMemo: existing.stellar_memo ?? undefined,
          feeCharged: existing.fee_charged ?? undefined,
          attemptId: existing.id,
          isDuplicate: true,
        };
      }
      attemptId = attemptResult.attempt?.id;
    }
  }

  try {
    const server = new StellarSdk.Horizon.Server(config.horizonUrl);
    const sourceKeypair = StellarSdk.Keypair.fromSecret(config.sourceSecret);
    const sourcePublicKey = sourceKeypair.publicKey();

    const account = await Promise.race([
      server.loadAccount(sourcePublicKey),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout loading account")), config.transactionTimeout)
      ),
    ]);

    const feeToUse = maxFee ? maxFee.toString() : StellarSdk.BASE_FEE;
    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: feeToUse,
      networkPassphrase: config.network === "testnet"
        ? StellarSdk.Networks.TESTNET
        : StellarSdk.Networks.PUBLIC,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: sourcePublicKey,
          asset: StellarSdk.Asset.native(),
          amount: "0.0000001",
        })
      )
      .addMemo(StellarSdk.Memo.text(auditMemo))
      .setTimeout(30)
      .build();

    transaction.sign(sourceKeypair);

    // Submit with retry logic
    const maxAttempts = options?.maxAttempts || DEFAULT_MAX_ATTEMPTS;
    const { result, attempts } = await submitWithRetry(
      server,
      transaction,
      maxAttempts,
      correlationId
    );

    const duration = Date.now() - startTime;
    const feeCharged = (result as any).fee_charged ? (result as any).fee_charged.toString() : feeToUse.toString();

    logBlockchainOperation("info", "Audit transaction successful", {
      groupId,
      eventId,
      eventType,
      metadataHash,
      auditMemo,
      transactionHash: result.hash,
      feeCharged,
      duration,
      ledger: result.ledger,
      attempts,
    }, correlationId);

    // Update attempt record with success
    if (attemptId && options?.supabase) {
      await updateTransactionAttemptStatus(options.supabase, attemptId, {
        status: "submitted",
        stellarTxHash: result.hash,
        stellarMemo: auditMemo,
        feeCharged,
        ledger: result.ledger,
        submittedAt: new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
        incrementAttempt: true,
      });
    }

    return {
      success: true,
      transactionHash: result.hash,
      feeCharged,
      auditMemo,
      attemptId,
      isDuplicate: false,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const retryable = isRetryableError(error);
    const errorType = error.name || "UnknownError";
    const errorMessage = error.message || "Transaction failed";
    const errorCode = error.response?.status?.toString() || error.extras?.result_codes?.operations?.join(",");

    logBlockchainOperation("error", "Audit transaction failed", {
      groupId,
      eventId,
      eventType,
      metadataHash,
      auditMemo,
      duration,
      retryable,
      error: {
        type: errorType,
        message: errorMessage,
      },
    }, correlationId);

    // Update attempt record with failure
    if (attemptId && options?.supabase) {
      const nextRetryAt = retryable
        ? new Date(Date.now() + calculateBackoffDelay(1)).toISOString()
        : undefined;

      await updateTransactionAttemptStatus(options.supabase, attemptId, {
        status: "failed",
        lastError: errorMessage,
        lastErrorType: errorType,
        lastErrorCode: errorCode,
        failedAt: new Date().toISOString(),
        incrementAttempt: true,
        nextRetryAt,
      });
    }

    // User-friendly error messages
    let userError = errorMessage;
    if (errorMessage.includes("op_underfunded")) {
      userError = "Insufficient XLM balance for audit transaction.";
    } else if (errorMessage.includes("timeout")) {
      userError = "Network request timed out. Please try again.";
    }

    return {
      success: false,
      auditMemo,
      error: userError,
      attemptId,
      isDuplicate: false,
    };
  }
}

/**
 * Retrieves a transaction from the Stellar blockchain with retry.
 */
export async function getTransaction(
  txHash: string,
  maxAttempts: number = 2
): Promise<StellarTransaction | null> {
  const correlationId = generateCorrelationId();

  if (!isConfigured()) {
    logBlockchainOperation("warn", "Cannot retrieve transaction - configuration missing", {
      transactionHash: txHash,
    }, correlationId);
    return null;
  }

  const config = loadStellarConfig();
  if (!config) {
    return null;
  }

  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const server = new StellarSdk.Horizon.Server(config.horizonUrl);

      const transaction = await Promise.race([
        server.transactions().transaction(txHash).call(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout retrieving transaction")), config.transactionTimeout)
        ),
      ]);

      const ledger = (transaction as { ledger_attr?: number }).ledger_attr;

      return {
        hash: transaction.hash,
        memo: transaction.memo || "",
        memoType: (transaction as any).memo_type,
        ledger: ledger ?? 0,
        created_at: transaction.created_at,
        successful: Boolean(transaction.successful),
        source_account: transaction.source_account,
        operation_count: transaction.operation_count,
      };
    } catch (error: any) {
      lastError = error;
      const retryable = isRetryableError(error);

      if (attempt < maxAttempts && retryable) {
        const delay = calculateBackoffDelay(attempt);
        logBlockchainOperation("warn", `Retrying getTransaction (attempt ${attempt}/${maxAttempts})`, {
          transactionHash: txHash,
          delay,
          error: error.message,
        }, correlationId);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  logBlockchainOperation("error", "Failed to retrieve transaction", {
    transactionHash: txHash,
    error: {
      type: lastError?.name || "UnknownError",
      message: lastError?.message || "Unknown error occurred",
    },
  }, correlationId);

  return null;
}

/**
 * Gets the explorer URL for a transaction.
 */
export function getTransactionExplorerUrl(txHash: string): string | null {
  const config = loadStellarConfig();
  if (!config) {
    return null;
  }

  return getExplorerUrl(txHash, config.network);
}

/**
 * Retries a previously failed transaction attempt.
 */
export async function retryFailedAttempt(
  supabase: SupabaseClientLike,
  attemptId: string
): Promise<StellarTransactionResult & { attemptId?: string }> {
  const correlationId = generateCorrelationId();

  // Fetch the attempt
  const { data: attempt, error } = await supabase
    .from("stellar_transaction_attempts")
    .select("*")
    .eq("id", attemptId)
    .single();

  if (error || !attempt) {
    return {
      success: false,
      error: "Transaction attempt not found",
    };
  }

  if (attempt.status === "submitted") {
    return {
      success: true,
      transactionHash: attempt.stellar_tx_hash,
      memoGroupId: attempt.stellar_memo,
      feeCharged: attempt.fee_charged,
      attemptId,
    };
  }

  if (attempt.attempt_count >= attempt.max_attempts) {
    return {
      success: false,
      error: `Maximum retry attempts (${attempt.max_attempts}) exceeded. Please try again later.`,
      attemptId,
    };
  }

  logBlockchainOperation("info", "Retrying failed transaction attempt", {
    attemptId,
    submissionType: attempt.submission_type,
    groupId: attempt.group_id,
    previousAttempts: attempt.attempt_count,
    lastError: attempt.last_error,
  }, correlationId);

  // Retry based on submission type
  if (attempt.submission_type === "metadata_hash") {
    // For metadata hash, we need the original payload - reconstruct from group
    const { data: room } = await supabase
      .from("rooms")
      .select("metadata_hash")
      .eq("id", attempt.group_id)
      .single();

    if (!room?.metadata_hash) {
      return {
        success: false,
        error: "Cannot retry: original metadata hash not found",
        attemptId,
      };
    }

    return submitMetadataHash(attempt.group_id, room.metadata_hash, undefined, {
      supabase,
      idempotencyKey: attempt.idempotency_key,
      skipDuplicateCheck: true, // Already have the attempt record
    });
  } else if (attempt.submission_type === "audit_event") {
    // For audit events, re-submit with stored info
    const { data: auditEvent } = await supabase
      .from("group_audit_events")
      .select("event_type, metadata_hash")
      .eq("event_id", attempt.audit_event_id)
      .single();

    if (!auditEvent) {
      return {
        success: false,
        error: "Cannot retry: original audit event not found",
        attemptId,
      };
    }

    return submitAuditEvent(
      attempt.group_id,
      attempt.audit_event_id,
      auditEvent.event_type,
      auditEvent.metadata_hash,
      undefined,
      {
        supabase,
        idempotencyKey: attempt.idempotency_key,
        skipDuplicateCheck: true,
      }
    );
  }

  return {
    success: false,
    error: "Unknown submission type",
    attemptId,
  };
}

/**
 * Lists failed transaction attempts eligible for retry for a group.
 */
export async function getRetryableAttempts(
  supabase: SupabaseClientLike,
  groupId: string
): Promise<any[]> {
  // Fetch failed/pending attempts and filter in memory for retryable ones
  const { data, error } = await supabase
    .from("stellar_transaction_attempts")
    .select("*")
    .eq("group_id", groupId)
    .in("status", ["failed", "pending"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    logBlockchainOperation("error", "Failed to fetch retryable attempts", {
      groupId,
      error: { type: "DatabaseError", message: error.message },
    });
    return [];
  }

  // Filter to only include attempts that haven't exceeded max_attempts
  return (data || []).filter((attempt: any) => attempt.attempt_count < attempt.max_attempts);
}
