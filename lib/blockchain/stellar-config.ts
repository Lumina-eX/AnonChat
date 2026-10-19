import { logBlockchainOperation } from "./logger";

export type VerificationStatus = "pending" | "successful" | "failed" | "unverifiable";

export interface StellarConfig {
  network: "testnet" | "mainnet";
  sourceSecret: string;
  horizonUrl: string;
  transactionTimeout: number;
}

export interface ExpectedOperation {
  type: string;
  sourceAccount?: string;
  destinationAccount?: string;
  assetCode?: string;
  assetIssuer?: string;
  amount?: string;
  contractId?: string;
}

export interface VerificationRecord {
  transactionHash: string;
  network: "testnet" | "mainnet";
  ledgerNumber: number | null;
  ledgerCloseTime: string | null;
  transactionResult: string | null;
  verificationTimestamp: string;
  status: VerificationStatus;
  validationDetails: Record<string, unknown>;
  action: string;
}

export interface VerificationOutcome {
  status: VerificationStatus;
  record: VerificationRecord | null;
  retryable: boolean;
  diagnostics: string[];
}

/**
 * Loads Stellar configuration from environment variables
 * 
 * @returns StellarConfig object or null if configuration is incomplete
 */
export function loadStellarConfig(): StellarConfig | null {
  const network = process.env.STELLAR_NETWORK as "testnet" | "mainnet" | undefined;
  const sourceSecret = process.env.STELLAR_SOURCE_SECRET;
  const horizonUrl = process.env.STELLAR_HORIZON_URL;
  const transactionTimeout = parseInt(
    process.env.STELLAR_TRANSACTION_TIMEOUT || "30000",
    10
  );

  // Validate required configuration
  if (!network || !sourceSecret || !horizonUrl) {
    return null;
  }

  // Validate network value
  if (network !== "testnet" && network !== "mainnet") {
    logBlockchainOperation("warn", "Invalid STELLAR_NETWORK value", {
      network,
      message: "STELLAR_NETWORK must be 'testnet' or 'mainnet'",
    });
    return null;
  }

  return {
    network,
    sourceSecret,
    horizonUrl,
    transactionTimeout,
  };
}

/**
 * Returns the expected network passphrase for the configured network.
 */
export function getNetworkPassphrase(network: "testnet" | "mainnet"): string {
  return network === "testnet"
    ? "Test SDF Network ; September 2015"
    : "Public Global Stellar Network ; September 2015";
}

/**
 * Validates a transaction hash format (64 hex characters).
 */
export function isValidTransactionHash(txHash: string): boolean {
  return typeof txHash === "string" && /^[0-9a-fA-F]{64}$/.test(txHash);
}

/**
 * Verifies that a transaction's network passphrase matches the configured network.
 */
export function verifyNetwork(txNetworkPassphrase: string | undefined, expectedNetwork: "testnet" | "mainnet"): boolean {
  if (!txNetworkPassphrase) {
    return false;
  }
  return txNetworkPassphrase === getNetworkPassphrase(expectedNetwork);
}

/**
 * Matches a transaction's operations against the expected AnonChat action.
 */
export function matchExpectedOperation(
  operations: Array<Record<string, unknown>>,
  expected: ExpectedOperation
): { matched: boolean; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const candidate = operations.find((op) => op.type === expected.type);

  if (!candidate) {
    diagnostics.push(`Expected operation type '${expected.type}' not found`);
    return { matched: false, diagnostics };
  }

  const checks: Array<[keyof ExpectedOperation, string]> = [
    ["sourceAccount", "source_account"],
    ["destinationAccount", "to"],
    ["assetCode", "asset_code"],
    ["assetIssuer", "asset_issuer"],
    ["amount", "amount"],
    ["contractId", "contract_id"],
  ];

  for (const [expectedKey, opKey] of checks) {
    const expectedValue = expected[expectedKey];
    if (expectedValue === undefined) {
      continue;
    }
    const actualValue = candidate[opKey];
    if (String(actualValue) !== String(expectedValue)) {
      diagnostics.push(
        `Operation field '${opKey}' mismatch: expected '${expectedValue}', got '${actualValue}'`
      );
    }
  }

  return { matched: diagnostics.length === 0, diagnostics };
}

/**
 * Checks if Stellar configuration is properly set up
 * 
 * @returns True if all required configuration is present
 */
export function isConfigured(): boolean {
  const config = loadStellarConfig();
  
  if (!config) {
    logBlockchainOperation("warn", "Stellar configuration incomplete", {
      message: "Missing required environment variables: STELLAR_NETWORK, STELLAR_SOURCE_SECRET, or STELLAR_HORIZON_URL",
      configured: false,
    });
    return false;
  }

  return true;
}

/**
 * Gets the Stellar explorer URL for a transaction
 * 
 * @param txHash - Transaction hash
 * @param network - Network type (testnet or mainnet)
 * @returns Explorer URL
 */
export function getExplorerUrl(txHash: string, network: "testnet" | "mainnet"): string {
  const baseUrl = network === "testnet" 
    ? "https://stellar.expert/explorer/testnet/tx"
    : "https://stellar.expert/explorer/public/tx";
  
  return `${baseUrl}/${txHash}`;
}
