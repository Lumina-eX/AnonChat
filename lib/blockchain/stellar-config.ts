/**
 * Stellar Configuration
 *
 * This module is the server-side entry point for Stellar configuration consumed
 * by blockchain services (stellar-service.ts, stellar-history.ts, etc.).
 *
 * All network constants (passphrases, endpoint defaults, explorer URLs) live in
 * lib/stellar/network-config.ts — the single source of truth. This module
 * adapts that centralized config into the StellarConfig shape that existing
 * services already depend on, so services do not need to be changed.
 */

import { logBlockchainOperation } from "./logger";
import {
  resolveNetworkConfig,
  buildExplorerUrl,
  type StellarEnvironment,
} from "@/lib/stellar/network-config";

export interface StellarConfig {
  network: "testnet" | "mainnet";
  sourceSecret: string;
  horizonUrl: string;
  transactionTimeout: number;
}

/**
 * Loads Stellar configuration from the centralized network-config module.
 *
 * Returns null when any required value is absent or the network identifier is
 * not recognised. Callers should treat null as "Stellar is not configured".
 */
export function loadStellarConfig(): StellarConfig | null {
  const resolved = resolveNetworkConfig();

  if (!resolved) {
    return null;
  }

  // The centralized config supports "local" as a third environment.
  // Legacy services only understand "testnet" | "mainnet", so we map local → testnet
  // for Horizon/SDK purposes (local nodes behave like a private testnet).
  const network: "testnet" | "mainnet" =
    resolved.environment === "mainnet" ? "mainnet" : "testnet";

  if (!resolved.sourceSecret) {
    // Source secret is required for transaction signing
    logBlockchainOperation("warn", "STELLAR_SOURCE_SECRET is not set", {
      message: "Stellar transaction signing is unavailable without a source secret.",
      configured: false,
    });
    return null;
  }

  return {
    network,
    sourceSecret: resolved.sourceSecret,
    horizonUrl: resolved.horizonUrl,
    transactionTimeout: resolved.transactionTimeoutMs,
  };
}

/**
 * Returns true when all required Stellar configuration is present and valid.
 *
 * Logs a structured warning when configuration is missing so that operators
 * can diagnose startup issues from logs alone.
 */
export function isConfigured(): boolean {
  const config = loadStellarConfig();

  if (!config) {
    logBlockchainOperation("warn", "Stellar configuration incomplete", {
      message:
        "Missing required environment variables: STELLAR_NETWORK, STELLAR_SOURCE_SECRET, " +
        "or STELLAR_HORIZON_URL",
      configured: false,
    });
    return false;
  }

  return true;
}

/**
 * Returns the Stellar.expert explorer URL for a transaction hash.
 *
 * Delegates to the centralized network-config helper so the explorer base URL
 * is derived from the same source of truth as the rest of the config.
 */
export function getExplorerUrl(
  txHash: string,
  network: "testnet" | "mainnet",
): string {
  const environment: StellarEnvironment = network === "mainnet" ? "mainnet" : "testnet";
  return buildExplorerUrl(txHash, environment);
}
