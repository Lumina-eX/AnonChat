/**
 * Transaction Submission Service
 *
 * A reusable prepare → sign → submit pipeline for Stellar transactions.
 * Handles sequence management, error classification, ambiguous network outcomes,
 * and retry safety. Intentionally decoupled from group/audit-specific logic so
 * it can be used across wallet, escrow, payment, and dispute workflows.
 *
 * Usage:
 *   const result = await prepareAndSubmit({ sourceAccountId, operations, memo }, signerSecret);
 *   if (result.status === 'unknown') runRecoveryWorkflow(...);
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { logBlockchainOperation, generateCorrelationId } from "./logger";
import { loadStellarConfig } from "./stellar-config";
import {
  getAccountSequence,
  detectSequenceError,
  refreshSequenceAfterConflict,
} from "./sequence-manager";
import {
  SequenceError,
  SequenceErrorCode,
  type SubmissionOutcome,
} from "@/types/transaction-states";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransactionPreparationInput {
  /** Stellar public key (G…) of the account that will sign and pay. */
  sourceAccountId: string;
  /** One or more operations to include in the transaction. */
  operations: StellarSdk.Operation[];
  /** Optional memo to attach. */
  memo?: StellarSdk.Memo;
  /** Max fee in stroops. Defaults to StellarSdk.BASE_FEE. */
  fee?: string;
  /** Transaction timeout in seconds. Defaults to 30. */
  timeoutSeconds?: number;
  /** Override the network passphrase (derived from config by default). */
  networkPassphrase?: string;
  /** Override the Horizon URL (derived from config by default). */
  horizonUrl?: string;
}

export interface PreparedTransaction {
  /** The unsigned transaction object ready for signing. */
  transaction: StellarSdk.Transaction;
  /** Hex hash of the transaction envelope (computed before signing). */
  transactionHash: string;
  sourceAccountId: string;
  sequenceNumber: bigint;
  preparedAt: string;
  networkPassphrase: string;
  horizonUrl: string;
}

export interface SignedTransaction {
  prepared: PreparedTransaction;
  /** Base64-encoded XDR of the signed transaction envelope. */
  signedEnvelope: string;
  /** Public keys of all signers applied. */
  signers: string[];
  signedAt: string;
}

export type PreparationResult =
  | { success: true; prepared: PreparedTransaction }
  | { success: false; error: string; sequenceError?: SequenceError };

export type SubmissionResult = SubmissionOutcome;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true for HTTP status codes that indicate ambiguous delivery. */
function isAmbiguousStatus(status: number): boolean {
  return status === 504 || status === 503 || status === 502 || status === 429;
}

/** Returns true for error message patterns that indicate a lost network connection. */
function isConnectionLost(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("timeout") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("socket") ||
    lower.includes("network")
  );
}

/** Returns true for Horizon result codes that are definitively non-retryable. */
function isNonRetryableResultCode(code: string): boolean {
  const nonRetryable = [
    "tx_bad_auth",
    "tx_insufficient_fee",
    "tx_bad_minseq_age_or_gap",
    "tx_internal_error",
    "tx_not_supported",
    "tx_fee_bump_inner_failed",
    "op_malformed",
    "op_underfunded",
    "op_low_reserve",
    "op_line_full",
    "op_no_issuer",
    "op_no_trust",
    "op_buy_no_trust",
  ];
  return nonRetryable.some((r) => code.toLowerCase().includes(r));
}

// ── Preparation ───────────────────────────────────────────────────────────────

/**
 * Prepares a Stellar transaction:
 * 1. Loads configuration
 * 2. Fetches the latest account sequence from Horizon
 * 3. Builds the TransactionBuilder with the loaded account
 *
 * Does NOT sign or submit the transaction.
 */
export async function prepareTransaction(
  input: TransactionPreparationInput,
  correlationId?: string,
): Promise<PreparationResult> {
  const corrId = correlationId ?? generateCorrelationId();

  const config = loadStellarConfig();
  if (!config) {
    return {
      success: false,
      error:
        "Stellar configuration is unavailable. Set STELLAR_NETWORK, STELLAR_SOURCE_SECRET, and STELLAR_HORIZON_URL.",
    };
  }

  const horizonUrl = input.horizonUrl ?? config.horizonUrl;
  const networkPassphrase =
    input.networkPassphrase ??
    (config.network === "testnet"
      ? StellarSdk.Networks.TESTNET
      : StellarSdk.Networks.PUBLIC);

  logBlockchainOperation(
    "info",
    "Preparing transaction",
    { sourceAccountId: input.sourceAccountId, operationCount: input.operations.length },
    corrId,
  );

  // Fetch account to get the current sequence and balance info
  const sequenceResult = await getAccountSequence(
    input.sourceAccountId,
    horizonUrl,
    undefined,
    corrId,
  );

  if (!sequenceResult.success) {
    return {
      success: false,
      error: sequenceResult.error.message,
      sequenceError: sequenceResult.error,
    };
  }

  const { info: sequenceInfo } = sequenceResult;

  try {
    // Load the full account object (needed by TransactionBuilder)
    const server = new StellarSdk.Horizon.Server(horizonUrl);
    const account = await server.loadAccount(input.sourceAccountId);

    const fee = input.fee ?? StellarSdk.BASE_FEE;
    const timeoutSeconds = input.timeoutSeconds ?? 30;

    const builder = new StellarSdk.TransactionBuilder(account, {
      fee,
      networkPassphrase,
    });

    for (const op of input.operations) {
      builder.addOperation(op);
    }

    if (input.memo) {
      builder.addMemo(input.memo);
    }

    const transaction = builder.setTimeout(timeoutSeconds).build();
    const transactionHash = transaction.hash().toString("hex");

    const prepared: PreparedTransaction = {
      transaction,
      transactionHash,
      sourceAccountId: input.sourceAccountId,
      sequenceNumber: sequenceInfo.sequence,
      preparedAt: new Date().toISOString(),
      networkPassphrase,
      horizonUrl,
    };

    logBlockchainOperation(
      "info",
      "Transaction prepared",
      {
        transactionHash,
        sourceAccountId: input.sourceAccountId,
        sequenceNumber: sequenceInfo.sequence.toString(),
      },
      corrId,
    );

    return { success: true, prepared };
  } catch (err: unknown) {
    const message = (err as Error)?.message ?? "Unknown error during transaction preparation";
    logBlockchainOperation(
      "error",
      "Transaction preparation failed",
      { sourceAccountId: input.sourceAccountId, error: { type: "PreparationError", message } },
      corrId,
    );
    return { success: false, error: message };
  }
}

// ── Signing ───────────────────────────────────────────────────────────────────

/**
 * Signs a prepared transaction with the given secret key.
 * Mutates the transaction in-place (Stellar SDK convention) and returns a
 * `SignedTransaction` descriptor.
 */
export function signTransaction(
  prepared: PreparedTransaction,
  signerSecret: string,
): SignedTransaction {
  const keypair = StellarSdk.Keypair.fromSecret(signerSecret);
  prepared.transaction.sign(keypair);

  const signedEnvelope = prepared.transaction.toEnvelope().toXDR("base64");

  return {
    prepared,
    signedEnvelope,
    signers: [keypair.publicKey()],
    signedAt: new Date().toISOString(),
  };
}

// ── Submission ────────────────────────────────────────────────────────────────

/**
 * Submits a signed transaction to Horizon and classifies the result.
 *
 * Distinguishes three outcomes:
 * - `confirmed`     — Horizon accepted and the transaction is in a ledger
 * - `failed`        — Horizon definitively rejected; `retryable` signals safety
 * - `unknown`       — Connection lost mid-flight; a recovery check is required
 *                     before any retry decision
 */
export async function submitSignedTransaction(
  signed: SignedTransaction,
  correlationId?: string,
): Promise<SubmissionResult> {
  const corrId = correlationId ?? generateCorrelationId();
  const { prepared } = signed;

  logBlockchainOperation(
    "info",
    "Submitting signed transaction",
    { transactionHash: prepared.transactionHash, sourceAccountId: prepared.sourceAccountId },
    corrId,
  );

  try {
    const server = new StellarSdk.Horizon.Server(prepared.horizonUrl);
    const result = await server.submitTransaction(prepared.transaction);

    const feeCharged = (result.fee_charged ?? "0").toString();
    const ledger = (result as any).ledger ?? 0;

    logBlockchainOperation(
      "info",
      "Transaction confirmed",
      {
        transactionHash: result.hash,
        ledger,
        feeCharged,
      },
      corrId,
    );

    return {
      status: "confirmed",
      transactionHash: result.hash,
      ledger,
      feeCharged,
    };
  } catch (err: unknown) {
    const e = err as any;
    const message: string = e?.message ?? "Unknown submission error";
    const httpStatus: number | undefined = e?.response?.status;

    logBlockchainOperation(
      "error",
      "Transaction submission failed",
      {
        transactionHash: prepared.transactionHash,
        httpStatus,
        error: { type: e?.name ?? "UnknownError", message },
      },
      corrId,
    );

    // ── Ambiguous outcomes (can't determine if it was accepted) ────────────────
    if (httpStatus !== undefined && isAmbiguousStatus(httpStatus)) {
      return {
        status: "unknown",
        transactionHash: prepared.transactionHash,
        error: `HTTP ${httpStatus}: ${message}`,
      };
    }

    if (isConnectionLost(message)) {
      return {
        status: "unknown",
        transactionHash: prepared.transactionHash,
        error: message,
      };
    }

    // ── Sequence errors ────────────────────────────────────────────────────────
    const seqErr = detectSequenceError(err, prepared.sourceAccountId, prepared.sequenceNumber);
    if (seqErr) {
      return {
        status: "failed",
        transactionHash: prepared.transactionHash,
        error: seqErr.message,
        retryable: true, // sequence errors are always retryable after refresh
        sequenceError: seqErr,
      };
    }

    // ── Definitive Horizon rejections ──────────────────────────────────────────
    const txCode: string =
      e?.response?.data?.extras?.result_codes?.transaction ?? "";
    const opCodes: string[] =
      e?.response?.data?.extras?.result_codes?.operations ?? [];
    const allCodes = [txCode, ...opCodes].join(",");

    const retryable = !isNonRetryableResultCode(allCodes);

    return {
      status: "failed",
      transactionHash: prepared.transactionHash,
      error: message,
      retryable,
    };
  }
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/**
 * Convenience function: prepare → sign → submit in one call.
 */
export async function prepareAndSubmit(
  input: TransactionPreparationInput,
  signerSecret: string,
  correlationId?: string,
): Promise<SubmissionResult> {
  const corrId = correlationId ?? generateCorrelationId();

  const prepResult = await prepareTransaction(input, corrId);
  if (!prepResult.success) {
    return {
      status: "failed",
      error: prepResult.error,
      retryable: prepResult.sequenceError !== undefined,
      sequenceError: prepResult.sequenceError,
    };
  }

  const signed = signTransaction(prepResult.prepared, signerSecret);
  return submitSignedTransaction(signed, corrId);
}

/**
 * Retries a transaction after a sequence conflict or stale sequence error.
 * Force-refreshes the account sequence before rebuilding the transaction.
 */
export async function retryWithRefreshedSequence(
  input: TransactionPreparationInput,
  signerSecret: string,
  correlationId?: string,
): Promise<SubmissionResult> {
  const corrId = correlationId ?? generateCorrelationId();
  const horizonUrl = input.horizonUrl ?? loadStellarConfig()?.horizonUrl;

  if (!horizonUrl) {
    return {
      status: "failed",
      error: "Stellar configuration unavailable during retry",
      retryable: false,
    };
  }

  logBlockchainOperation(
    "info",
    "Retrying transaction with refreshed sequence",
    { sourceAccountId: input.sourceAccountId },
    corrId,
  );

  const refreshResult = await refreshSequenceAfterConflict(
    input.sourceAccountId,
    horizonUrl,
    corrId,
  );

  if (!refreshResult.success) {
    return {
      status: "failed",
      error: refreshResult.error.message,
      retryable: false,
      sequenceError: refreshResult.error,
    };
  }

  return prepareAndSubmit(input, signerSecret, corrId);
}

// ── Classification utility ────────────────────────────────────────────────────

/**
 * Classifies a raw submission error without performing any I/O.
 * Useful for pre-checking errors before deciding how to handle them.
 */
export function classifySubmissionError(error: unknown): {
  retryable: boolean;
  isAmbiguous: boolean;
  isSequenceError: boolean;
  errorCode?: string;
} {
  if (!error) {
    return { retryable: false, isAmbiguous: false, isSequenceError: false };
  }

  const e = error as any;
  const message: string = e?.message ?? "";
  const httpStatus: number | undefined = e?.response?.status;
  const txCode: string =
    e?.response?.data?.extras?.result_codes?.transaction ?? "";

  const ambiguous =
    (httpStatus !== undefined && isAmbiguousStatus(httpStatus)) ||
    isConnectionLost(message);

  const seqRelated =
    txCode === "tx_bad_seq" ||
    message.toLowerCase().includes("tx_bad_seq") ||
    message.toLowerCase().includes("bad_seq") ||
    message.toLowerCase().includes("sequence");

  if (ambiguous) {
    return { retryable: false, isAmbiguous: true, isSequenceError: false };
  }

  if (seqRelated) {
    return {
      retryable: true,
      isAmbiguous: false,
      isSequenceError: true,
      errorCode: txCode || "sequence_related",
    };
  }

  const allCodes = [
    txCode,
    ...(e?.response?.data?.extras?.result_codes?.operations ?? []),
  ].join(",");

  const retryable = !isNonRetryableResultCode(allCodes);

  return {
    retryable,
    isAmbiguous: false,
    isSequenceError: false,
    errorCode: txCode || undefined,
  };
}
