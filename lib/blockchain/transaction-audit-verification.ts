/**
 * Transaction Audit Verification Service
 *
 * Verifies that a Stellar transaction hash corresponds to the expected AnonChat
 * action before that action is treated as confirmed. The pipeline is:
 *
 *  1. Validate the transaction hash format.
 *  2. Retrieve the transaction from the configured Stellar network with retry.
 *  3. Verify the transaction belongs to the expected Stellar network (testnet vs mainnet).
 *  4. Verify the transaction succeeded on-chain.
 *  5. Validate operation details against the expected AnonChat action.
 *  6. Store the outcome idempotently in the audit table.
 *  7. Return a structured result.
 *
 * Security properties:
 * - Application actions are never marked verified solely because a hash was provided.
 * - Network validation runs before any state transition.
 * - Verification logic relies exclusively on authoritative Horizon data.
 * - Diagnostic details are sanitised — no secrets or credentials are logged.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { loadStellarConfig } from "@/lib/blockchain/stellar-config";
import { isValidTransactionHash } from "@/lib/blockchain/transaction-verification";
import { logBlockchainOperation, generateCorrelationId } from "@/lib/blockchain/logger";
import { getExplorerUrl } from "@/lib/blockchain/stellar-config";
import { withRetry, isHorizonRetryable, type RetryOptions } from "@/lib/blockchain/retry";
import { saveAuditRecord, findAuditRecord } from "@/lib/blockchain/audit-verification-store";
import type {
  AnonChatAction,
  AuditVerificationInput,
  AuditVerificationResult,
  StellarTransactionVerificationStatus,
  StellarTransaction,
} from "@/types/blockchain";

// ── Supabase type shim ────────────────────────────────────────────────────────

type SupabaseClientLike = Parameters<typeof saveAuditRecord>[0];

// ── Network passphrase map ────────────────────────────────────────────────────

const NETWORK_PASSPHRASES: Record<"testnet" | "mainnet", string> = {
  testnet: StellarSdk.Networks.TESTNET,
  mainnet: StellarSdk.Networks.PUBLIC,
};

/**
 * Derives a human-readable network identifier from the Stellar network passphrase
 * embedded in a transaction envelope.
 */
function resolveNetworkIdentifier(passphrase: string): string {
  if (passphrase === StellarSdk.Networks.TESTNET) return "testnet";
  if (passphrase === StellarSdk.Networks.PUBLIC) return "mainnet";
  return passphrase.slice(0, 32); // unknown — truncated for logging
}

// ── Operation extraction ──────────────────────────────────────────────────────

type StellarOperation = {
  type: string;
  source?: string;
  destination?: string;
  asset?: { code?: string; issuer?: string };
  amount?: string;
};

/** Extracts the first operation type from a decoded transaction envelope. */
function extractFirstOperationType(tx: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction): string | null {
  if ("operations" in tx && Array.isArray(tx.operations) && tx.operations.length > 0) {
    return (tx.operations[0] as StellarOperation).type ?? null;
  }
  return null;
}

/** Extracts the source account of the first operation (falls back to tx source). */
function extractOperationSource(tx: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction): string | null {
  if ("operations" in tx && Array.isArray(tx.operations) && tx.operations.length > 0) {
    const op = tx.operations[0] as StellarOperation;
    return op.source ?? (tx as StellarSdk.Transaction).source ?? null;
  }
  return null;
}

// ── Action → operation validation ────────────────────────────────────────────

/**
 * Validates that the decoded transaction operations are consistent with the
 * expected AnonChat action. Returns null on success, or a human-readable
 * rejection reason.
 */
function validateActionOperation(
  tx: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction,
  expectedAction: AnonChatAction,
): string | null {
  const ops = "operations" in tx ? (tx.operations as StellarOperation[]) : [];

  if (ops.length === 0) {
    return "Transaction contains no operations";
  }

  const firstOp = ops[0];
  const opType = firstOp.type;

  switch (expectedAction) {
    case "group_creation":
    case "audit_event":
    case "group_join":
    case "group_leave":
    case "member_removal":
    case "wallet_auth":
      // These actions use a minimal self-payment to anchor a memo on-chain.
      if (opType !== "payment") {
        return `Expected payment operation for action '${expectedAction}', found '${opType}'`;
      }
      break;

    case "ownership_transfer":
      // Ownership transfer may use a payment or change trust operation.
      if (opType !== "payment" && opType !== "changeTrust" && opType !== "setOptions") {
        return `Expected payment, changeTrust, or setOptions operation for action '${expectedAction}', found '${opType}'`;
      }
      break;

    default: {
      const _exhaustiveCheck: never = expectedAction;
      return `Unknown expected action: ${_exhaustiveCheck}`;
    }
  }

  return null;
}

// ── Horizon retrieval ─────────────────────────────────────────────────────────

type HorizonTransactionRecord = {
  hash: string;
  memo?: string;
  memo_type?: string;
  ledger_attr?: number;
  ledger?: number;
  created_at: string;
  successful: boolean;
  source_account: string;
  operation_count: number;
  envelope_xdr?: string;
  network_passphrase?: string;
};

/**
 * Retrieves a transaction from Horizon, returning the raw record or null on 404.
 * Throws on retryable errors so `withRetry` can handle them.
 */
async function fetchTransactionFromHorizon(
  txHash: string,
  horizonUrl: string,
  timeoutMs: number,
): Promise<HorizonTransactionRecord> {
  const server = new StellarSdk.Horizon.Server(horizonUrl);

  const record = await Promise.race([
    server.transactions().transaction(txHash).call(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout retrieving transaction after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);

  return record as unknown as HorizonTransactionRecord;
}

// ── Main verification function ────────────────────────────────────────────────

export interface AuditVerifyOptions {
  /** Supabase client for idempotent audit persistence. When omitted, storage is skipped. */
  supabase?: SupabaseClientLike;
  /** Override retry options (useful in tests). */
  retryOptions?: RetryOptions;
}

/**
 * Verifies a Stellar transaction against an expected AnonChat action and stores
 * an auditable record of the outcome.
 *
 * The function is idempotent: calling it again with the same hash and action
 * returns the stored result without creating a duplicate record (unless the new
 * verification reaches a more definitive state).
 */
export async function verifyTransactionForAudit(
  input: AuditVerificationInput,
  options: AuditVerifyOptions = {},
): Promise<AuditVerificationResult> {
  const correlationId = input.correlationId ?? generateCorrelationId();
  const now = new Date().toISOString();
  const { supabase, retryOptions } = options;

  const { transactionHash, expectedAction, groupId = null, expectedMemo = null, expectedSourceAccount = null } = input;

  logBlockchainOperation(
    "info",
    "audit-verify: starting",
    { transactionHash, expectedAction, groupId: groupId ?? undefined },
    correlationId,
  );

  // ── Step 0: Idempotency check — return existing successful record immediately ──
  if (supabase) {
    const cached = await findAuditRecord(supabase, transactionHash, expectedAction, correlationId);
    if (cached && cached.status === "successful" && cached.verified) {
      logBlockchainOperation(
        "info",
        "audit-verify: returning cached successful record (idempotent)",
        { transactionHash, expectedAction },
        correlationId,
      );
      return buildResultFromRecord(cached, correlationId, true);
    }
  }

  // ── Step 1: Validate transaction hash format ──────────────────────────────
  if (!isValidTransactionHash(transactionHash)) {
    return finalize(
      {
        transactionHash,
        status: "invalid",
        verified: false,
        networkIdentifier: "unknown",
        ledger: null,
        ledgerCloseTime: null,
        sourceAccount: null,
        operationCount: null,
        operationType: null,
        expectedAction,
        groupId,
        error: "Invalid Stellar transaction hash format",
        diagnosticDetails: { reason: "hash_format_invalid" },
        verifiedAt: now,
        explorerUrl: null,
        idempotent: false,
        retryCount: 0,
        correlationId,
      },
      supabase,
      correlationId,
    );
  }

  // ── Step 2: Load Stellar config ───────────────────────────────────────────
  const config = loadStellarConfig();
  if (!config) {
    return finalize(
      {
        transactionHash,
        status: "unverifiable",
        verified: false,
        networkIdentifier: "unknown",
        ledger: null,
        ledgerCloseTime: null,
        sourceAccount: null,
        operationCount: null,
        operationType: null,
        expectedAction,
        groupId,
        error: "Stellar configuration unavailable — cannot verify network",
        diagnosticDetails: { reason: "config_missing" },
        verifiedAt: now,
        explorerUrl: null,
        idempotent: false,
        retryCount: 0,
        correlationId,
      },
      supabase,
      correlationId,
    );
  }

  const expectedNetworkPassphrase = NETWORK_PASSPHRASES[config.network];
  const explorerUrl = getExplorerUrl(transactionHash, config.network);

  // ── Step 3: Retrieve transaction from Horizon with retry ─────────────────
  let retryCount = 0;
  const retryResult = await withRetry(
    () => fetchTransactionFromHorizon(transactionHash, config.horizonUrl, config.transactionTimeout),
    {
      maxRetries: 3,
      baseDelayMs: 500,
      jitterMs: 200,
      maxDelayMs: 15_000,
      isRetryable: isHorizonRetryable,
      onRetry: (err, attempt, delayMs) => {
        retryCount = attempt + 1;
        logBlockchainOperation(
          "warn",
          "audit-verify: Horizon retrieval failed, will retry",
          {
            transactionHash,
            attempt: attempt + 1,
            delayMs,
            error: { type: "RetryableError", message: err instanceof Error ? err.message : String(err) },
          },
          correlationId,
        );
      },
      ...retryOptions,
    },
  );

  if (!retryResult.success) {
    const err = retryResult.error;
    const errMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = errMsg.toLowerCase().includes("timeout");
    const is404 = errMsg.toLowerCase().includes("not found") || errMsg.toLowerCase().includes("404");

    // 404 → transaction does not exist
    if (is404) {
      return finalize(
        {
          transactionHash,
          status: "pending",
          verified: false,
          networkIdentifier: config.network,
          ledger: null,
          ledgerCloseTime: null,
          sourceAccount: null,
          operationCount: null,
          operationType: null,
          expectedAction,
          groupId,
          error: "Transaction not found on the Stellar network",
          diagnosticDetails: { reason: "transaction_not_found", retryCount },
          verifiedAt: now,
          explorerUrl,
          idempotent: false,
          retryCount,
          correlationId,
        },
        supabase,
        correlationId,
      );
    }

    // Timeout / service failure → unverifiable (not failed — the tx may still succeed)
    return finalize(
      {
        transactionHash,
        status: "unverifiable",
        verified: false,
        networkIdentifier: config.network,
        ledger: null,
        ledgerCloseTime: null,
        sourceAccount: null,
        operationCount: null,
        operationType: null,
        expectedAction,
        groupId,
        error: isTimeout
          ? "Horizon timed out — cannot confirm transaction status"
          : "Horizon temporarily unavailable — transaction status is unknown",
        diagnosticDetails: { reason: isTimeout ? "horizon_timeout" : "horizon_unavailable", retryCount },
        verifiedAt: now,
        explorerUrl,
        idempotent: false,
        retryCount,
        correlationId,
      },
      supabase,
      correlationId,
    );
  }

  const record = retryResult.value;
  retryCount = retryResult.attempts - 1;

  // ── Step 4: Verify transaction success ────────────────────────────────────
  if (!record.successful) {
    return finalize(
      {
        transactionHash,
        status: "failed",
        verified: false,
        networkIdentifier: config.network,
        ledger: record.ledger_attr ?? record.ledger ?? null,
        ledgerCloseTime: record.created_at ?? null,
        sourceAccount: record.source_account ?? null,
        operationCount: record.operation_count ?? null,
        operationType: null,
        expectedAction,
        groupId,
        error: "Stellar transaction failed on-chain",
        diagnosticDetails: { reason: "transaction_failed", retryCount },
        verifiedAt: now,
        explorerUrl,
        idempotent: false,
        retryCount,
        correlationId,
      },
      supabase,
      correlationId,
    );
  }

  // ── Step 5: Network validation ────────────────────────────────────────────
  // Decode the transaction envelope to extract the network passphrase.
  if (record.envelope_xdr) {
    try {
      const decoded = StellarSdk.TransactionBuilder.fromXDR(
        record.envelope_xdr,
        expectedNetworkPassphrase,
      );

      // If fromXDR succeeds with our expected passphrase, the network matches.
      // We additionally check the passphrase field when present.
      const embeddedPassphrase = (decoded as any).networkPassphrase as string | undefined;
      if (embeddedPassphrase && embeddedPassphrase !== expectedNetworkPassphrase) {
        const foundNetwork = resolveNetworkIdentifier(embeddedPassphrase);
        return finalize(
          {
            transactionHash,
            status: "failed",
            verified: false,
            networkIdentifier: foundNetwork,
            ledger: record.ledger_attr ?? record.ledger ?? null,
            ledgerCloseTime: record.created_at ?? null,
            sourceAccount: record.source_account ?? null,
            operationCount: record.operation_count ?? null,
            operationType: null,
            expectedAction,
            groupId,
            error: `Network mismatch: transaction belongs to '${foundNetwork}', expected '${config.network}'`,
            diagnosticDetails: {
              reason: "network_mismatch",
              expectedNetwork: config.network,
              foundNetwork,
            },
            verifiedAt: now,
            explorerUrl,
            idempotent: false,
            retryCount,
            correlationId,
          },
          supabase,
          correlationId,
        );
      }

      // ── Step 6: Operation validation ───────────────────────────────────────
      const opError = validateActionOperation(decoded, expectedAction);
      const operationType = extractFirstOperationType(decoded);
      const operationSource = extractOperationSource(decoded);

      if (opError) {
        return finalize(
          {
            transactionHash,
            status: "failed",
            verified: false,
            networkIdentifier: config.network,
            ledger: record.ledger_attr ?? record.ledger ?? null,
            ledgerCloseTime: record.created_at ?? null,
            sourceAccount: operationSource ?? record.source_account ?? null,
            operationCount: record.operation_count ?? null,
            operationType,
            expectedAction,
            groupId,
            error: opError,
            diagnosticDetails: { reason: "operation_mismatch", detail: opError },
            verifiedAt: now,
            explorerUrl,
            idempotent: false,
            retryCount,
            correlationId,
          },
          supabase,
          correlationId,
        );
      }

      // ── Step 7: Memo validation (when expectedMemo provided) ──────────────
      if (expectedMemo !== null && expectedMemo !== undefined) {
        const actualMemo = record.memo ?? "";
        if (actualMemo !== expectedMemo) {
          return finalize(
            {
              transactionHash,
              status: "failed",
              verified: false,
              networkIdentifier: config.network,
              ledger: record.ledger_attr ?? record.ledger ?? null,
              ledgerCloseTime: record.created_at ?? null,
              sourceAccount: operationSource ?? record.source_account ?? null,
              operationCount: record.operation_count ?? null,
              operationType,
              expectedAction,
              groupId,
              error: "Transaction memo does not match expected value",
              diagnosticDetails: { reason: "memo_mismatch" },
              verifiedAt: now,
              explorerUrl,
              idempotent: false,
              retryCount,
              correlationId,
            },
            supabase,
            correlationId,
          );
        }
      }

      // ── Step 8: Source account validation (when expectedSourceAccount provided) ──
      if (expectedSourceAccount !== null && expectedSourceAccount !== undefined) {
        const actualSource = operationSource ?? record.source_account ?? null;
        if (actualSource !== expectedSourceAccount) {
          return finalize(
            {
              transactionHash,
              status: "failed",
              verified: false,
              networkIdentifier: config.network,
              ledger: record.ledger_attr ?? record.ledger ?? null,
              ledgerCloseTime: record.created_at ?? null,
              sourceAccount: actualSource,
              operationCount: record.operation_count ?? null,
              operationType,
              expectedAction,
              groupId,
              error: "Source account does not match expected wallet address",
              diagnosticDetails: { reason: "source_account_mismatch" },
              verifiedAt: now,
              explorerUrl,
              idempotent: false,
              retryCount,
              correlationId,
            },
            supabase,
            correlationId,
          );
        }
      }

      // ── Success ────────────────────────────────────────────────────────────
      return finalize(
        {
          transactionHash,
          status: "successful",
          verified: true,
          networkIdentifier: config.network,
          ledger: record.ledger_attr ?? record.ledger ?? null,
          ledgerCloseTime: record.created_at ?? null,
          sourceAccount: operationSource ?? record.source_account ?? null,
          operationCount: record.operation_count ?? null,
          operationType,
          expectedAction,
          groupId,
          error: null,
          diagnosticDetails: null,
          verifiedAt: now,
          explorerUrl,
          idempotent: false,
          retryCount,
          correlationId,
        },
        supabase,
        correlationId,
      );
    } catch (xdrError) {
      // XDR decode failed with our expected passphrase → network mismatch
      const errMsg = xdrError instanceof Error ? xdrError.message : String(xdrError);
      return finalize(
        {
          transactionHash,
          status: "failed",
          verified: false,
          networkIdentifier: "unknown",
          ledger: record.ledger_attr ?? record.ledger ?? null,
          ledgerCloseTime: record.created_at ?? null,
          sourceAccount: record.source_account ?? null,
          operationCount: record.operation_count ?? null,
          operationType: null,
          expectedAction,
          groupId,
          error: `Network mismatch: transaction cannot be decoded against the configured network passphrase`,
          diagnosticDetails: {
            reason: "xdr_decode_failed",
            detail: errMsg,
            expectedNetwork: config.network,
          },
          verifiedAt: now,
          explorerUrl,
          idempotent: false,
          retryCount,
          correlationId,
        },
        supabase,
        correlationId,
      );
    }
  }

  // ── Fallback: envelope XDR not available — verify via metadata only ───────
  // We can still validate success and operation count, but cannot verify network
  // passphrase from the envelope. Mark as unverifiable to prevent false positives.
  logBlockchainOperation(
    "warn",
    "audit-verify: envelope_xdr not available, cannot perform network passphrase validation",
    { transactionHash, expectedAction },
    correlationId,
  );

  return finalize(
    {
      transactionHash,
      status: "unverifiable",
      verified: false,
      networkIdentifier: config.network,
      ledger: record.ledger_attr ?? record.ledger ?? null,
      ledgerCloseTime: record.created_at ?? null,
      sourceAccount: record.source_account ?? null,
      operationCount: record.operation_count ?? null,
      operationType: null,
      expectedAction,
      groupId,
      error: "Transaction envelope unavailable — network validation cannot be completed",
      diagnosticDetails: { reason: "envelope_unavailable" },
      verifiedAt: now,
      explorerUrl,
      idempotent: false,
      retryCount,
      correlationId,
    },
    supabase,
    correlationId,
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Persists the result to Supabase and returns it with the idempotent flag set. */
async function finalize(
  result: AuditVerificationResult,
  supabase: SupabaseClientLike | undefined,
  correlationId: string,
): Promise<AuditVerificationResult> {
  if (!supabase) {
    return result;
  }

  try {
    const { existing } = await saveAuditRecord(supabase, result, correlationId);
    return { ...result, idempotent: existing };
  } catch (dbError) {
    logBlockchainOperation(
      "error",
      "audit-verify: failed to persist audit record",
      {
        transactionHash: result.transactionHash,
        error: {
          type: dbError instanceof Error ? dbError.constructor.name : "DatabaseError",
          message: dbError instanceof Error ? dbError.message : String(dbError),
        },
      },
      correlationId,
    );
    // Surface the error — do not silently swallow DB failures
    throw dbError;
  }
}

/** Reconstructs an AuditVerificationResult from a stored TransactionAuditRecord. */
function buildResultFromRecord(
  record: import("@/types/blockchain").TransactionAuditRecord,
  correlationId: string,
  idempotent: boolean,
): AuditVerificationResult {
  return {
    transactionHash: record.transaction_hash,
    status: record.status as StellarTransactionVerificationStatus,
    verified: record.verified,
    networkIdentifier: record.network_identifier,
    ledger: record.ledger,
    ledgerCloseTime: record.ledger_close_time,
    sourceAccount: record.source_account,
    operationCount: record.operation_count,
    operationType: record.operation_type,
    expectedAction: record.expected_action,
    groupId: record.group_id,
    error: record.error_message,
    diagnosticDetails: record.diagnostic_details,
    verifiedAt: record.verified_at,
    explorerUrl: record.network_identifier
      ? getExplorerUrl(
          record.transaction_hash,
          record.network_identifier === "mainnet" ? "mainnet" : "testnet",
        )
      : null,
    idempotent,
    retryCount: record.retry_count,
    correlationId,
  };
}
