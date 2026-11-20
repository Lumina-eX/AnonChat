/**
 * Stellar Network Configuration Module
 *
 * Centralizes all Stellar network settings for local development, Testnet,
 * and Mainnet. Every service that needs Stellar configuration reads from here.
 * This is the single source of truth for network identifiers, passphrases,
 * Horizon endpoints, and explorer URLs.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StellarEnvironment = "local" | "testnet" | "mainnet";

export interface StellarNetworkProfile {
  /** Human-readable name, e.g. "Stellar Testnet" */
  name: string;
  /** Environment identifier */
  environment: StellarEnvironment;
  /** Canonical network passphrase from Stellar SDKs */
  networkPassphrase: string;
  /** Default Horizon REST endpoint for this environment */
  defaultHorizonUrl: string;
  /** Default Soroban RPC endpoint for this environment (null when unused) */
  defaultSorobanRpcUrl: string | null;
  /** Stellar.expert explorer base URL */
  explorerBaseUrl: string;
}

export interface ResolvedStellarConfig {
  environment: StellarEnvironment;
  networkPassphrase: string;
  horizonUrl: string;
  sorobanRpcUrl: string | null;
  explorerBaseUrl: string;
  /** Secret key for server-side signing — never log this value */
  sourceSecret: string | null;
  transactionTimeoutMs: number;
}

// ---------------------------------------------------------------------------
// Canonical network profiles
// ---------------------------------------------------------------------------

/** Official Testnet passphrase (Stellar SDK: Networks.TESTNET) */
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/** Official Mainnet passphrase (Stellar SDK: Networks.PUBLIC) */
export const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

/** Canonical passphrase used for standalone local/Futurenet nodes */
export const LOCAL_PASSPHRASE = "Standalone Network ; February 2017";

/** Map of environment name → canonical passphrase */
export const NETWORK_PASSPHRASES: Record<StellarEnvironment, string> = {
  local: LOCAL_PASSPHRASE,
  testnet: TESTNET_PASSPHRASE,
  mainnet: MAINNET_PASSPHRASE,
};

/** Well-known public Horizon endpoints */
export const DEFAULT_HORIZON_URLS: Record<StellarEnvironment, string> = {
  local: "http://localhost:8000",
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};

/** Well-known public Soroban RPC endpoints */
export const DEFAULT_SOROBAN_RPC_URLS: Record<StellarEnvironment, string | null> = {
  local: "http://localhost:8000/soroban/rpc",
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: null, // Mainnet Soroban RPC is not publicly available by default
};

/** Stellar.expert explorer base URLs */
export const EXPLORER_BASE_URLS: Record<StellarEnvironment, string> = {
  local: "https://stellar.expert/explorer/testnet",
  testnet: "https://stellar.expert/explorer/testnet",
  mainnet: "https://stellar.expert/explorer/public",
};

/** Full network profile definitions */
export const NETWORK_PROFILES: Record<StellarEnvironment, StellarNetworkProfile> = {
  local: {
    name: "Local Development",
    environment: "local",
    networkPassphrase: LOCAL_PASSPHRASE,
    defaultHorizonUrl: DEFAULT_HORIZON_URLS.local,
    defaultSorobanRpcUrl: DEFAULT_SOROBAN_RPC_URLS.local,
    explorerBaseUrl: EXPLORER_BASE_URLS.local,
  },
  testnet: {
    name: "Stellar Testnet",
    environment: "testnet",
    networkPassphrase: TESTNET_PASSPHRASE,
    defaultHorizonUrl: DEFAULT_HORIZON_URLS.testnet,
    defaultSorobanRpcUrl: DEFAULT_SOROBAN_RPC_URLS.testnet,
    explorerBaseUrl: EXPLORER_BASE_URLS.testnet,
  },
  mainnet: {
    name: "Stellar Mainnet",
    environment: "mainnet",
    networkPassphrase: MAINNET_PASSPHRASE,
    defaultHorizonUrl: DEFAULT_HORIZON_URLS.mainnet,
    defaultSorobanRpcUrl: DEFAULT_SOROBAN_RPC_URLS.mainnet,
    explorerBaseUrl: EXPLORER_BASE_URLS.mainnet,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the canonical passphrase for a given environment.
 */
export function getNetworkPassphrase(environment: StellarEnvironment): string {
  return NETWORK_PASSPHRASES[environment];
}

/**
 * Returns the full network profile for the given environment.
 */
export function getNetworkProfile(environment: StellarEnvironment): StellarNetworkProfile {
  return NETWORK_PROFILES[environment];
}

/**
 * Infers the environment from a network passphrase string.
 * Returns null when the passphrase is not recognised.
 */
export function inferEnvironmentFromPassphrase(
  passphrase: string,
): StellarEnvironment | null {
  const trimmed = passphrase.trim();
  for (const [env, known] of Object.entries(NETWORK_PASSPHRASES) as [
    StellarEnvironment,
    string,
  ][]) {
    if (trimmed === known) return env;
  }
  return null;
}

/**
 * Returns whether a Horizon URL belongs to the expected environment.
 * Checks hostname patterns; does not make a network request.
 */
export function isHorizonUrlCompatibleWithEnvironment(
  horizonUrl: string,
  environment: StellarEnvironment,
): boolean {
  let hostname: string;
  try {
    hostname = new URL(horizonUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (environment === "mainnet") {
    // Reject anything that looks like testnet
    if (hostname.includes("testnet")) return false;
    // Allow horizon.stellar.org, custom mainnet proxies, local overrides in mainnet mode
    return true;
  }

  if (environment === "testnet") {
    // Reject anything that explicitly says "mainnet"
    if (hostname === "horizon.stellar.org") return false;
    return true;
  }

  // local: any URL is acceptable
  return true;
}

/**
 * Returns whether a Soroban RPC URL belongs to the expected environment.
 * Null URLs are always treated as compatible (Soroban RPC is optional).
 */
export function isSorobanRpcUrlCompatibleWithEnvironment(
  rpcUrl: string | null,
  environment: StellarEnvironment,
): boolean {
  if (rpcUrl === null) return true;

  let hostname: string;
  try {
    hostname = new URL(rpcUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (environment === "mainnet") {
    if (hostname.includes("testnet")) return false;
    return true;
  }

  if (environment === "testnet") {
    if (hostname === "mainnet-rpc.stellar.org" || hostname === "rpc.stellar.org") return false;
    return true;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Environment variable resolution
// ---------------------------------------------------------------------------

/**
 * Parses the raw STELLAR_NETWORK / NEXT_PUBLIC_STELLAR_NETWORK value into a
 * typed StellarEnvironment, or returns null for unrecognised values.
 */
export function parseEnvironmentName(raw: string | undefined): StellarEnvironment | null {
  if (!raw) return null;
  const normalised = raw.trim().toLowerCase();
  if (normalised === "local" || normalised === "development" || normalised === "dev") {
    return "local";
  }
  if (normalised === "testnet" || normalised === "test") return "testnet";
  if (normalised === "mainnet" || normalised === "public" || normalised === "production" || normalised === "prod") {
    return "mainnet";
  }
  return null;
}

/**
 * Builds a ResolvedStellarConfig from environment variables without performing
 * validation. Call validateResolvedConfig() separately for startup checks.
 *
 * Environment variables consumed:
 *   STELLAR_NETWORK              — required: testnet | mainnet | local
 *   STELLAR_HORIZON_URL          — optional override for server-side Horizon
 *   NEXT_PUBLIC_STELLAR_NETWORK  — public (client-side) network name
 *   NEXT_PUBLIC_STELLAR_HORIZON_URL — public Horizon override
 *   STELLAR_SOROBAN_RPC_URL      — optional Soroban RPC endpoint
 *   STELLAR_SOURCE_SECRET        — server-side signing key
 *   STELLAR_TRANSACTION_TIMEOUT  — ms, default 30000
 */
export function resolveNetworkConfig(): ResolvedStellarConfig | null {
  const rawNetwork =
    process.env.STELLAR_NETWORK ?? process.env.NEXT_PUBLIC_STELLAR_NETWORK;

  const environment = parseEnvironmentName(rawNetwork);
  if (!environment) return null;

  const profile = NETWORK_PROFILES[environment];

  const horizonUrl =
    process.env.STELLAR_HORIZON_URL ??
    process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
    profile.defaultHorizonUrl;

  const sorobanRpcUrl =
    process.env.STELLAR_SOROBAN_RPC_URL ?? profile.defaultSorobanRpcUrl;

  const sourceSecret = process.env.STELLAR_SOURCE_SECRET ?? null;

  const transactionTimeoutMs = parseInt(
    process.env.STELLAR_TRANSACTION_TIMEOUT ?? "30000",
    10,
  );

  return {
    environment,
    networkPassphrase: profile.networkPassphrase,
    horizonUrl,
    sorobanRpcUrl,
    explorerBaseUrl: profile.explorerBaseUrl,
    sourceSecret,
    transactionTimeoutMs: isNaN(transactionTimeoutMs) ? 30000 : transactionTimeoutMs,
  };
}

/**
 * Returns a transaction explorer URL for the given hash and environment.
 */
export function buildExplorerUrl(
  txHash: string,
  environment: StellarEnvironment,
): string {
  const base = EXPLORER_BASE_URLS[environment];
  return `${base}/tx/${txHash}`;
}
