/**
 * Stellar Configuration Validator
 *
 * Validates resolved Stellar network configuration before the application
 * starts serving requests. Checks include:
 *
 *  - Required environment variables are present
 *  - Network identifiers are recognised
 *  - Network passphrases match the declared environment
 *  - Horizon endpoints are compatible with the declared environment
 *  - Soroban RPC endpoints are compatible with the declared environment
 *  - Testnet and Mainnet settings are never mixed
 *  - Production builds cannot silently fall back to an unintended network
 *
 * None of the validation functions make outbound network requests.
 */

import { logBlockchainOperation } from "@/lib/blockchain/logger";
import {
  resolveNetworkConfig,
  inferEnvironmentFromPassphrase,
  isHorizonUrlCompatibleWithEnvironment,
  isSorobanRpcUrlCompatibleWithEnvironment,
  TESTNET_PASSPHRASE,
  MAINNET_PASSPHRASE,
  DEFAULT_HORIZON_URLS,
  type ResolvedStellarConfig,
  type StellarEnvironment,
} from "./network-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  /** Human-readable corrective action */
  remedy: string;
}

export interface ValidationResult {
  valid: boolean;
  environment: StellarEnvironment | null;
  issues: ValidationIssue[];
  /** Redacted summary safe to include in logs */
  diagnostics: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Individual rule functions
// ---------------------------------------------------------------------------

function checkRequiredVariables(config: ResolvedStellarConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!config.horizonUrl) {
    issues.push({
      code: "MISSING_HORIZON_URL",
      severity: "error",
      message: "STELLAR_HORIZON_URL is not set.",
      remedy:
        "Set STELLAR_HORIZON_URL to a valid Horizon endpoint, e.g. https://horizon-testnet.stellar.org",
    });
  }

  if (!config.networkPassphrase) {
    issues.push({
      code: "MISSING_NETWORK_PASSPHRASE",
      severity: "error",
      message: "Network passphrase could not be derived from STELLAR_NETWORK.",
      remedy:
        "Set STELLAR_NETWORK to one of: testnet, mainnet, local",
    });
  }

  return issues;
}

function checkNetworkPassphrase(config: ResolvedStellarConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const inferred = inferEnvironmentFromPassphrase(config.networkPassphrase);

  if (inferred === null) {
    issues.push({
      code: "UNRECOGNISED_PASSPHRASE",
      severity: "error",
      message: `The network passphrase does not match any known Stellar network.`,
      remedy:
        `The passphrase must be one of the official values: ` +
        `"${TESTNET_PASSPHRASE}" for Testnet or "${MAINNET_PASSPHRASE}" for Mainnet.`,
    });
    return issues;
  }

  if (inferred !== config.environment) {
    issues.push({
      code: "PASSPHRASE_ENVIRONMENT_MISMATCH",
      severity: "error",
      message:
        `Network passphrase is for "${inferred}" but STELLAR_NETWORK declares "${config.environment}". ` +
        `This would cause transactions to be rejected or silently sent to the wrong network.`,
      remedy:
        `Ensure STELLAR_NETWORK matches the passphrase. ` +
        `For Testnet use STELLAR_NETWORK=testnet with the Testnet passphrase; ` +
        `for Mainnet use STELLAR_NETWORK=mainnet with the Mainnet passphrase.`,
    });
  }

  return issues;
}

function checkHorizonEndpoint(config: ResolvedStellarConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!config.horizonUrl) return issues;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(config.horizonUrl);
  } catch {
    issues.push({
      code: "INVALID_HORIZON_URL",
      severity: "error",
      message: `STELLAR_HORIZON_URL ("${config.horizonUrl}") is not a valid URL.`,
      remedy: "Provide a fully-qualified URL including the scheme, e.g. https://horizon-testnet.stellar.org",
    });
    return issues;
  }

  // Reject non-HTTPS in production
  if (
    config.environment === "mainnet" &&
    parsedUrl.protocol !== "https:"
  ) {
    issues.push({
      code: "INSECURE_MAINNET_HORIZON_URL",
      severity: "error",
      message:
        `Mainnet Horizon URL uses an insecure protocol ("${parsedUrl.protocol}"). ` +
        `Production connections must use HTTPS.`,
      remedy: "Change the URL scheme to https://",
    });
  }

  if (!isHorizonUrlCompatibleWithEnvironment(config.horizonUrl, config.environment)) {
    const expected = DEFAULT_HORIZON_URLS[config.environment];
    issues.push({
      code: "HORIZON_ENVIRONMENT_MISMATCH",
      severity: "error",
      message:
        `Horizon URL "${config.horizonUrl}" is not compatible with the "${config.environment}" environment. ` +
        `Mixing Testnet and Mainnet endpoints is not permitted.`,
      remedy: `Use a ${config.environment} Horizon endpoint, e.g. ${expected}`,
    });
  }

  return issues;
}

function checkSorobanRpcEndpoint(config: ResolvedStellarConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!config.sorobanRpcUrl) return issues;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(config.sorobanRpcUrl);
  } catch {
    issues.push({
      code: "INVALID_SOROBAN_RPC_URL",
      severity: "error",
      message: `STELLAR_SOROBAN_RPC_URL ("${config.sorobanRpcUrl}") is not a valid URL.`,
      remedy: "Provide a fully-qualified URL including the scheme.",
    });
    return issues;
  }

  if (
    config.environment === "mainnet" &&
    parsedUrl.protocol !== "https:"
  ) {
    issues.push({
      code: "INSECURE_MAINNET_SOROBAN_RPC_URL",
      severity: "error",
      message:
        `Mainnet Soroban RPC URL uses an insecure protocol ("${parsedUrl.protocol}"). ` +
        `Production connections must use HTTPS.`,
      remedy: "Change the URL scheme to https://",
    });
  }

  if (!isSorobanRpcUrlCompatibleWithEnvironment(config.sorobanRpcUrl, config.environment)) {
    issues.push({
      code: "SOROBAN_RPC_ENVIRONMENT_MISMATCH",
      severity: "error",
      message:
        `Soroban RPC URL "${config.sorobanRpcUrl}" is not compatible with the "${config.environment}" environment. ` +
        `Mixing Testnet and Mainnet RPC endpoints is not permitted.`,
      remedy: `Use a ${config.environment} Soroban RPC endpoint.`,
    });
  }

  return issues;
}

function checkCrossEnvironmentMixing(config: ResolvedStellarConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const passphraseEnv = inferEnvironmentFromPassphrase(config.networkPassphrase);

  // Testnet passphrase with Mainnet Horizon
  if (
    passphraseEnv === "testnet" &&
    config.horizonUrl === DEFAULT_HORIZON_URLS.mainnet
  ) {
    issues.push({
      code: "TESTNET_PASSPHRASE_WITH_MAINNET_HORIZON",
      severity: "error",
      message:
        "A Testnet network passphrase is paired with the Mainnet Horizon endpoint. " +
        "Transactions would be rejected by Mainnet nodes.",
      remedy:
        "Use matching passphrase and Horizon endpoint for the same environment.",
    });
  }

  // Mainnet passphrase with Testnet Horizon
  if (
    passphraseEnv === "mainnet" &&
    config.horizonUrl === DEFAULT_HORIZON_URLS.testnet
  ) {
    issues.push({
      code: "MAINNET_PASSPHRASE_WITH_TESTNET_HORIZON",
      severity: "error",
      message:
        "A Mainnet network passphrase is paired with the Testnet Horizon endpoint. " +
        "Transactions would be rejected by Testnet nodes.",
      remedy:
        "Use matching passphrase and Horizon endpoint for the same environment.",
    });
  }

  return issues;
}

function checkProductionSafeguards(config: ResolvedStellarConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const nodeEnv = process.env.NODE_ENV;
  const isProduction = nodeEnv === "production";

  if (isProduction && config.environment !== "mainnet") {
    // This is a warning, not a hard error — intentional staging builds exist
    issues.push({
      code: "PRODUCTION_BUILD_NON_MAINNET",
      severity: "warning",
      message:
        `NODE_ENV is "production" but STELLAR_NETWORK is "${config.environment}". ` +
        `Production deployments normally target Mainnet.`,
      remedy:
        "If this deployment intentionally targets a non-production Stellar network, " +
        "set STELLAR_ALLOW_TESTNET_IN_PRODUCTION=true to suppress this warning.",
    });

    const explicitOverride = process.env.STELLAR_ALLOW_TESTNET_IN_PRODUCTION;
    if (explicitOverride === "true") {
      // Remove the warning — the operator acknowledged it
      issues.length = 0;
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates a ResolvedStellarConfig object against all rules and returns a
 * structured ValidationResult. Does not throw.
 */
export function validateResolvedConfig(config: ResolvedStellarConfig): ValidationResult {
  const issues: ValidationIssue[] = [
    ...checkRequiredVariables(config),
    ...checkNetworkPassphrase(config),
    ...checkHorizonEndpoint(config),
    ...checkSorobanRpcEndpoint(config),
    ...checkCrossEnvironmentMixing(config),
    ...checkProductionSafeguards(config),
  ];

  const errors = issues.filter((i) => i.severity === "error");

  const diagnostics: Record<string, string> = {
    environment: config.environment,
    horizonUrl: config.horizonUrl || "(not set)",
    sorobanRpcUrl: config.sorobanRpcUrl ?? "(not configured)",
    // Redact the passphrase — only show first 20 chars for identification
    networkPassphrase: config.networkPassphrase
      ? config.networkPassphrase.slice(0, 20) + "…"
      : "(not set)",
    sourceSecretPresent: config.sourceSecret ? "yes" : "no",
    transactionTimeoutMs: String(config.transactionTimeoutMs),
  };

  return {
    valid: errors.length === 0,
    environment: config.environment,
    issues,
    diagnostics,
  };
}

/**
 * Loads configuration from environment variables and validates it in one call.
 * Returns null and logs an error when STELLAR_NETWORK is not set.
 */
export function validateEnvironmentConfig(): ValidationResult {
  const config = resolveNetworkConfig();

  if (!config) {
    const result: ValidationResult = {
      valid: false,
      environment: null,
      issues: [
        {
          code: "MISSING_STELLAR_NETWORK",
          severity: "error",
          message:
            "STELLAR_NETWORK environment variable is not set or contains an unrecognised value.",
          remedy:
            "Set STELLAR_NETWORK to one of: testnet, mainnet, local",
        },
      ],
      diagnostics: {
        STELLAR_NETWORK: process.env.STELLAR_NETWORK ?? "(not set)",
        NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "(not set)",
      },
    };
    return result;
  }

  return validateResolvedConfig(config);
}

/**
 * Runs startup validation and logs all issues. Returns true when the
 * configuration is valid (no error-severity issues).
 *
 * This is designed to be called once during application initialisation
 * (e.g. in instrumentation.ts). It never throws — the caller decides
 * whether to abort startup.
 */
export function runStartupValidation(): boolean {
  const result = validateEnvironmentConfig();

  if (result.valid) {
    logBlockchainOperation(
      "info",
      "Stellar network configuration validated successfully",
      {
        ...result.diagnostics,
        warningCount: result.issues.filter((i) => i.severity === "warning").length,
      },
    );

    // Log any warnings even when overall validation passes
    for (const issue of result.issues) {
      if (issue.severity === "warning") {
        logBlockchainOperation("warn", `[${issue.code}] ${issue.message}`, {
          remedy: issue.remedy,
        });
      }
    }

    return true;
  }

  // Log each issue individually so operators can action them in order
  for (const issue of result.issues) {
    logBlockchainOperation(
      issue.severity === "error" ? "error" : "warn",
      `[${issue.code}] ${issue.message}`,
      {
        remedy: issue.remedy,
        diagnostics: result.diagnostics,
      },
    );
  }

  logBlockchainOperation(
    "error",
    "Stellar network configuration is invalid — services requiring Stellar will not start",
    {
      errorCount: result.issues.filter((i) => i.severity === "error").length,
      diagnostics: result.diagnostics,
    },
  );

  return false;
}

/**
 * Throws a descriptive error when the configuration is invalid. Use this as a
 * runtime guard before preparing or signing transactions.
 *
 * @throws {Error} when the configuration has validation errors
 */
export function assertValidConfig(config: ResolvedStellarConfig): void {
  const result = validateResolvedConfig(config);
  if (!result.valid) {
    const errorMessages = result.issues
      .filter((i) => i.severity === "error")
      .map((i) => `[${i.code}] ${i.message} — Remedy: ${i.remedy}`)
      .join("\n");
    throw new Error(
      `Stellar configuration is invalid and transaction submission has been blocked:\n${errorMessages}`,
    );
  }
}
