import * as StellarSdk from "@stellar/stellar-sdk";
import { StellarTransactionResult, StellarTransaction } from "@/types/blockchain";
import { loadStellarConfig, isConfigured, getExplorerUrl } from "./stellar-config";
import { logBlockchainOperation, generateCorrelationId } from "./logger";

/**
 * Submits a metadata hash to the Stellar blockchain
 * Uses a self-payment transaction with the hash in the memo field
 * 
 * @param groupId - The group ID for logging purposes
 * @param metadataHash - The SHA-256 hash of group metadata
 * @returns Transaction result with success status and transaction hash
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

    // Build transaction with memo containing metadata hash
    // Truncate hash to 28 bytes if needed (Stellar memo limit)
    const memoText = metadataHash.substring(0, 28);

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
      .addMemo(StellarSdk.Memo.text(memoText))
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
      transactionHash: result.hash,
      feeCharged,
      duration,
      ledger: result.ledger,
    }, correlationId);

    return {
      success: true,
      transactionHash: result.hash,
      feeCharged,
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
