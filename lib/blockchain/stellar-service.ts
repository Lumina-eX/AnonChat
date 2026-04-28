import * as StellarSdk from "@stellar/stellar-sdk";
import { StellarTransactionResult, StellarTransaction } from "@/types/blockchain";
import { loadStellarConfig, isConfigured, getExplorerUrl } from "./stellar-config";
import { logBlockchainOperation, generateCorrelationId } from "./logger";
import { deriveMemoGroupId, validateMemoGroupId, STELLAR_MEMO_MAX_BYTES } from "./memo";

/**
 * Submits a metadata hash to the Stellar blockchain.
 *
 * The Stellar TEXT memo embeds the group's compact identifier (≤28 bytes)
 * so that every on-chain transaction is traceable back to a specific group.
 * The metadata hash is stored in the DB for integrity verification; the memo
 * carries the group reference that can be validated independently on-chain.
 *
 * @param groupId      - The room's primary key (used to derive the memo)
 * @param metadataHash - SHA-256 hash of group metadata (stored in DB)
 * @param maxFee       - Optional maximum fee in stroops
 * @returns Transaction result including the memo that was embedded
 */
export async function submitMetadataHash(
  groupId: string,
  metadataHash: string,
  maxFee?: string | number
): Promise<StellarTransactionResult> {
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

  logBlockchainOperation("info", "Initiating blockchain transaction", {
    groupId,
    metadataHash,
    network: config.network,
  }, correlationId);

  try {
    // Initialize Stellar SDK
    const server = new StellarSdk.Horizon.Server(config.horizonUrl);
    const sourceKeypair = StellarSdk.Keypair.fromSecret(config.sourceSecret);
    const sourcePublicKey = sourceKeypair.publicKey();

    // Load source account
    const account = await Promise.race([
      server.loadAccount(sourcePublicKey),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout loading account")), config.transactionTimeout)
      ),
    ]);

    // Derive the group memo from the room ID (≤28 bytes, "grp_<slug>" format).
    // This embeds the group reference directly in the on-chain transaction so
    // it can be validated independently without querying the database.
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
          destination: sourcePublicKey, // Self-payment
          asset: StellarSdk.Asset.native(),
          amount: "0.0000001", // Minimal amount
        })
      )
      // Embed the group identifier — not the hash — so the memo is a stable,
      // human-readable group reference that survives metadata changes.
      .addMemo(StellarSdk.Memo.text(memoGroupId))
      .setTimeout(30)
      .build();

    // Sign transaction
    transaction.sign(sourceKeypair);

    // Submit transaction with timeout
    const result = await Promise.race([
      server.submitTransaction(transaction),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Transaction submission timeout")), config.transactionTimeout)
      ),
    ]);

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
    }, correlationId);

    return {
      success: true,
      transactionHash: result.hash,
      feeCharged,
      memoGroupId,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;

    logBlockchainOperation("error", "Blockchain transaction failed", {
      groupId,
      metadataHash,
      duration,
      error: {
        type: error.name || "UnknownError",
        message: error.message || "Unknown error occurred",
        stack: error.stack,
      },
    }, correlationId);

    return {
      success: false,
      error: error.message || "Transaction failed",
    };
  }
}

/**
 * Retrieves a transaction from the Stellar blockchain
 * 
 * @param txHash - Transaction hash to retrieve
 * @returns Transaction details or null if not found
 */
export async function getTransaction(txHash: string): Promise<StellarTransaction | null> {
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

  try {
    const server = new StellarSdk.Horizon.Server(config.horizonUrl);

    const transaction = await Promise.race([
      server.transactions().transaction(txHash).call(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout retrieving transaction")), config.transactionTimeout)
      ),
    ]);

    return {
      hash: transaction.hash,
      memo: transaction.memo || "",
      ledger: transaction.ledger_attr,
      created_at: transaction.created_at,
    };
  } catch (error: any) {
    logBlockchainOperation("error", "Failed to retrieve transaction", {
      transactionHash: txHash,
      error: {
        type: error.name || "UnknownError",
        message: error.message || "Unknown error occurred",
      },
    }, correlationId);

    return null;
  }
}

/**
 * Gets the explorer URL for a transaction
 * 
 * @param txHash - Transaction hash
 * @returns Explorer URL or null if configuration is missing
 */
export function getTransactionExplorerUrl(txHash: string): string | null {
  const config = loadStellarConfig();
  if (!config) {
    return null;
  }

  return getExplorerUrl(txHash, config.network);
}
