/**
 * Tests for Stellar Network Configuration Validation
 *
 * Covers every acceptance criterion from issue #296:
 *   - Valid Testnet configuration
 *   - Valid Mainnet configuration
 *   - Missing required configuration values
 *   - Invalid network identifiers
 *   - Invalid network passphrases
 *   - Invalid Horizon endpoints
 *   - Invalid Soroban RPC endpoints
 *   - Testnet/Mainnet configuration mismatches
 *   - Startup validation failures
 *   - Correct transaction signing passphrase selection
 *   - Prevention of fallback network behaviour
 *   - Runtime configuration validation
 *   - Environment-specific configuration loading
 *   - Production environment safeguards
 *   - Clear error reporting for invalid configurations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  resolveNetworkConfig,
  parseEnvironmentName,
  inferEnvironmentFromPassphrase,
  isHorizonUrlCompatibleWithEnvironment,
  isSorobanRpcUrlCompatibleWithEnvironment,
  getNetworkPassphrase,
  getNetworkProfile,
  buildExplorerUrl,
  TESTNET_PASSPHRASE,
  MAINNET_PASSPHRASE,
  LOCAL_PASSPHRASE,
  DEFAULT_HORIZON_URLS,
  DEFAULT_SOROBAN_RPC_URLS,
  NETWORK_PROFILES,
} from "@/lib/stellar/network-config";

import {
  validateResolvedConfig,
  validateEnvironmentConfig,
  runStartupValidation,
  assertValidConfig,
} from "@/lib/stellar/config-validator";

import type { ResolvedStellarConfig } from "@/lib/stellar/network-config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function testnetConfig(overrides: Partial<ResolvedStellarConfig> = {}): ResolvedStellarConfig {
  return {
    environment: "testnet",
    networkPassphrase: TESTNET_PASSPHRASE,
    horizonUrl: DEFAULT_HORIZON_URLS.testnet,
    sorobanRpcUrl: DEFAULT_SOROBAN_RPC_URLS.testnet,
    explorerBaseUrl: "https://stellar.expert/explorer/testnet",
    sourceSecret: "SDUMMY_TESTNET_SECRET",
    transactionTimeoutMs: 30000,
    ...overrides,
  };
}

function mainnetConfig(overrides: Partial<ResolvedStellarConfig> = {}): ResolvedStellarConfig {
  return {
    environment: "mainnet",
    networkPassphrase: MAINNET_PASSPHRASE,
    horizonUrl: DEFAULT_HORIZON_URLS.mainnet,
    sorobanRpcUrl: null,
    explorerBaseUrl: "https://stellar.expert/explorer/public",
    sourceSecret: "SDUMMY_MAINNET_SECRET",
    transactionTimeoutMs: 30000,
    ...overrides,
  };
}

function localConfig(overrides: Partial<ResolvedStellarConfig> = {}): ResolvedStellarConfig {
  return {
    environment: "local",
    networkPassphrase: LOCAL_PASSPHRASE,
    horizonUrl: DEFAULT_HORIZON_URLS.local,
    sorobanRpcUrl: DEFAULT_SOROBAN_RPC_URLS.local,
    explorerBaseUrl: "https://stellar.expert/explorer/testnet",
    sourceSecret: null,
    transactionTimeoutMs: 30000,
    ...overrides,
  };
}

// Save and restore process.env around each test
const originalEnv = { ...process.env };

beforeEach(() => {
  // Clear all Stellar-related env vars before each test
  delete process.env.STELLAR_NETWORK;
  delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
  delete process.env.STELLAR_HORIZON_URL;
  delete process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL;
  delete process.env.STELLAR_SOROBAN_RPC_URL;
  delete process.env.STELLAR_SOURCE_SECRET;
  delete process.env.STELLAR_TRANSACTION_TIMEOUT;
  delete process.env.STELLAR_ALLOW_TESTNET_IN_PRODUCTION;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  // Restore original environment
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("STELLAR") || key === "NODE_ENV") {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
});

// ===========================================================================
// 1. Network profile constants
// ===========================================================================

describe("Network profile constants", () => {
  it("exports the official Testnet passphrase", () => {
    expect(TESTNET_PASSPHRASE).toBe("Test SDF Network ; September 2015");
  });

  it("exports the official Mainnet passphrase", () => {
    expect(MAINNET_PASSPHRASE).toBe("Public Global Stellar Network ; September 2015");
  });

  it("contains profiles for all three supported environments", () => {
    expect(NETWORK_PROFILES).toHaveProperty("local");
    expect(NETWORK_PROFILES).toHaveProperty("testnet");
    expect(NETWORK_PROFILES).toHaveProperty("mainnet");
  });

  it("each profile carries the correct passphrase", () => {
    expect(NETWORK_PROFILES.testnet.networkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(NETWORK_PROFILES.mainnet.networkPassphrase).toBe(MAINNET_PASSPHRASE);
  });

  it("getNetworkPassphrase returns the passphrase for each environment", () => {
    expect(getNetworkPassphrase("testnet")).toBe(TESTNET_PASSPHRASE);
    expect(getNetworkPassphrase("mainnet")).toBe(MAINNET_PASSPHRASE);
    expect(getNetworkPassphrase("local")).toBe(LOCAL_PASSPHRASE);
  });

  it("getNetworkProfile returns the full profile object", () => {
    const p = getNetworkProfile("testnet");
    expect(p.name).toBe("Stellar Testnet");
    expect(p.environment).toBe("testnet");
    expect(p.networkPassphrase).toBe(TESTNET_PASSPHRASE);
  });
});

// ===========================================================================
// 2. parseEnvironmentName
// ===========================================================================

describe("parseEnvironmentName", () => {
  it("maps canonical names", () => {
    expect(parseEnvironmentName("testnet")).toBe("testnet");
    expect(parseEnvironmentName("mainnet")).toBe("mainnet");
    expect(parseEnvironmentName("local")).toBe("local");
  });

  it("is case-insensitive", () => {
    expect(parseEnvironmentName("TESTNET")).toBe("testnet");
    expect(parseEnvironmentName("Mainnet")).toBe("mainnet");
    expect(parseEnvironmentName("LOCAL")).toBe("local");
  });

  it("maps aliases", () => {
    expect(parseEnvironmentName("test")).toBe("testnet");
    expect(parseEnvironmentName("public")).toBe("mainnet");
    expect(parseEnvironmentName("production")).toBe("mainnet");
    expect(parseEnvironmentName("prod")).toBe("mainnet");
    expect(parseEnvironmentName("dev")).toBe("local");
    expect(parseEnvironmentName("development")).toBe("local");
  });

  it("returns null for unrecognised values", () => {
    expect(parseEnvironmentName("staging")).toBeNull();
    expect(parseEnvironmentName("")).toBeNull();
    expect(parseEnvironmentName(undefined)).toBeNull();
    expect(parseEnvironmentName("foobar")).toBeNull();
  });
});

// ===========================================================================
// 3. inferEnvironmentFromPassphrase
// ===========================================================================

describe("inferEnvironmentFromPassphrase", () => {
  it("identifies Testnet passphrase", () => {
    expect(inferEnvironmentFromPassphrase(TESTNET_PASSPHRASE)).toBe("testnet");
  });

  it("identifies Mainnet passphrase", () => {
    expect(inferEnvironmentFromPassphrase(MAINNET_PASSPHRASE)).toBe("mainnet");
  });

  it("identifies Local passphrase", () => {
    expect(inferEnvironmentFromPassphrase(LOCAL_PASSPHRASE)).toBe("local");
  });

  it("returns null for an unknown passphrase", () => {
    expect(inferEnvironmentFromPassphrase("Some Random Passphrase")).toBeNull();
    expect(inferEnvironmentFromPassphrase("")).toBeNull();
  });

  it("requires exact match (case-sensitive)", () => {
    expect(inferEnvironmentFromPassphrase("test sdf network ; september 2015")).toBeNull();
  });
});

// ===========================================================================
// 4. isHorizonUrlCompatibleWithEnvironment
// ===========================================================================

describe("isHorizonUrlCompatibleWithEnvironment", () => {
  it("accepts the standard Testnet Horizon URL for testnet", () => {
    expect(
      isHorizonUrlCompatibleWithEnvironment("https://horizon-testnet.stellar.org", "testnet"),
    ).toBe(true);
  });

  it("accepts the standard Mainnet Horizon URL for mainnet", () => {
    expect(
      isHorizonUrlCompatibleWithEnvironment("https://horizon.stellar.org", "mainnet"),
    ).toBe(true);
  });

  it("rejects the Mainnet Horizon URL for testnet", () => {
    expect(
      isHorizonUrlCompatibleWithEnvironment("https://horizon.stellar.org", "testnet"),
    ).toBe(false);
  });

  it("rejects a testnet URL for mainnet", () => {
    expect(
      isHorizonUrlCompatibleWithEnvironment("https://horizon-testnet.stellar.org", "mainnet"),
    ).toBe(false);
  });

  it("accepts any URL for the local environment", () => {
    expect(
      isHorizonUrlCompatibleWithEnvironment("http://localhost:8000", "local"),
    ).toBe(true);
  });

  it("returns false for a malformed URL", () => {
    expect(isHorizonUrlCompatibleWithEnvironment("not-a-url", "testnet")).toBe(false);
    expect(isHorizonUrlCompatibleWithEnvironment("not-a-url", "mainnet")).toBe(false);
  });
});

// ===========================================================================
// 5. isSorobanRpcUrlCompatibleWithEnvironment
// ===========================================================================

describe("isSorobanRpcUrlCompatibleWithEnvironment", () => {
  it("accepts null (Soroban RPC is optional)", () => {
    expect(isSorobanRpcUrlCompatibleWithEnvironment(null, "mainnet")).toBe(true);
    expect(isSorobanRpcUrlCompatibleWithEnvironment(null, "testnet")).toBe(true);
  });

  it("accepts the standard Testnet RPC for testnet", () => {
    expect(
      isSorobanRpcUrlCompatibleWithEnvironment(
        "https://soroban-testnet.stellar.org",
        "testnet",
      ),
    ).toBe(true);
  });

  it("rejects a testnet RPC for mainnet", () => {
    expect(
      isSorobanRpcUrlCompatibleWithEnvironment(
        "https://soroban-testnet.stellar.org",
        "mainnet",
      ),
    ).toBe(false);
  });

  it("returns false for a malformed URL", () => {
    expect(isSorobanRpcUrlCompatibleWithEnvironment("not-a-url", "testnet")).toBe(false);
  });
});

// ===========================================================================
// 6. resolveNetworkConfig — environment variable resolution
// ===========================================================================

describe("resolveNetworkConfig", () => {
  it("returns null when STELLAR_NETWORK is not set", () => {
    expect(resolveNetworkConfig()).toBeNull();
  });

  it("returns null for an unrecognised STELLAR_NETWORK value", () => {
    process.env.STELLAR_NETWORK = "staging";
    expect(resolveNetworkConfig()).toBeNull();
  });

  it("resolves a valid Testnet configuration", () => {
    process.env.STELLAR_NETWORK = "testnet";
    process.env.STELLAR_SOURCE_SECRET = "STEST";

    const config = resolveNetworkConfig();
    expect(config).not.toBeNull();
    expect(config!.environment).toBe("testnet");
    expect(config!.networkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(config!.horizonUrl).toBe(DEFAULT_HORIZON_URLS.testnet);
    expect(config!.sourceSecret).toBe("STEST");
  });

  it("resolves a valid Mainnet configuration", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    process.env.STELLAR_SOURCE_SECRET = "SMAIN";

    const config = resolveNetworkConfig();
    expect(config).not.toBeNull();
    expect(config!.environment).toBe("mainnet");
    expect(config!.networkPassphrase).toBe(MAINNET_PASSPHRASE);
    expect(config!.horizonUrl).toBe(DEFAULT_HORIZON_URLS.mainnet);
    expect(config!.sorobanRpcUrl).toBeNull();
  });

  it("honours STELLAR_HORIZON_URL override", () => {
    process.env.STELLAR_NETWORK = "testnet";
    process.env.STELLAR_HORIZON_URL = "https://my-custom-horizon.example.com";

    const config = resolveNetworkConfig();
    expect(config!.horizonUrl).toBe("https://my-custom-horizon.example.com");
  });

  it("falls back to NEXT_PUBLIC_STELLAR_NETWORK when server var is absent", () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = "testnet";

    const config = resolveNetworkConfig();
    expect(config!.environment).toBe("testnet");
  });

  it("parses STELLAR_TRANSACTION_TIMEOUT correctly", () => {
    process.env.STELLAR_NETWORK = "testnet";
    process.env.STELLAR_TRANSACTION_TIMEOUT = "60000";

    const config = resolveNetworkConfig();
    expect(config!.transactionTimeoutMs).toBe(60000);
  });

  it("defaults to 30000 ms when STELLAR_TRANSACTION_TIMEOUT is absent", () => {
    process.env.STELLAR_NETWORK = "testnet";

    const config = resolveNetworkConfig();
    expect(config!.transactionTimeoutMs).toBe(30000);
  });

  it("sets sourceSecret to null when STELLAR_SOURCE_SECRET is absent", () => {
    process.env.STELLAR_NETWORK = "testnet";

    const config = resolveNetworkConfig();
    expect(config!.sourceSecret).toBeNull();
  });

  it("resolves local environment", () => {
    process.env.STELLAR_NETWORK = "local";

    const config = resolveNetworkConfig();
    expect(config!.environment).toBe("local");
    expect(config!.networkPassphrase).toBe(LOCAL_PASSPHRASE);
    expect(config!.horizonUrl).toBe(DEFAULT_HORIZON_URLS.local);
  });
});

// ===========================================================================
// 7. validateResolvedConfig — individual rule coverage
// ===========================================================================

describe("validateResolvedConfig — valid configurations pass", () => {
  it("accepts a complete, valid Testnet configuration", () => {
    const result = validateResolvedConfig(testnetConfig());
    expect(result.valid).toBe(true);
    expect(result.environment).toBe("testnet");
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("accepts a complete, valid Mainnet configuration", () => {
    const result = validateResolvedConfig(mainnetConfig());
    expect(result.valid).toBe(true);
    expect(result.environment).toBe("mainnet");
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("accepts a valid local development configuration", () => {
    const result = validateResolvedConfig(localConfig());
    expect(result.valid).toBe(true);
    expect(result.environment).toBe("local");
  });

  it("accepts a Testnet config with a custom Horizon URL that isn't the mainnet URL", () => {
    const result = validateResolvedConfig(
      testnetConfig({ horizonUrl: "https://horizon-testnet.stellar.org" }),
    );
    expect(result.valid).toBe(true);
  });
});

describe("validateResolvedConfig — missing required values", () => {
  it("reports an error when horizonUrl is empty", () => {
    const result = validateResolvedConfig(testnetConfig({ horizonUrl: "" }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MISSING_HORIZON_URL")).toBe(true);
  });

  it("reports an error when networkPassphrase is empty", () => {
    const result = validateResolvedConfig(
      testnetConfig({ networkPassphrase: "" }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MISSING_NETWORK_PASSPHRASE")).toBe(true);
  });

  it("includes a remedy in every error issue", () => {
    const result = validateResolvedConfig(testnetConfig({ horizonUrl: "" }));
    for (const issue of result.issues.filter((i) => i.severity === "error")) {
      expect(issue.remedy).toBeTruthy();
    }
  });
});

describe("validateResolvedConfig — invalid network passphrase", () => {
  it("rejects an arbitrary string as a passphrase", () => {
    const result = validateResolvedConfig(
      testnetConfig({ networkPassphrase: "made up passphrase" }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "UNRECOGNISED_PASSPHRASE")).toBe(true);
  });

  it("rejects the Mainnet passphrase when environment is testnet", () => {
    const result = validateResolvedConfig(
      testnetConfig({ networkPassphrase: MAINNET_PASSPHRASE }),
    );
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.code === "PASSPHRASE_ENVIRONMENT_MISMATCH"),
    ).toBe(true);
  });

  it("rejects the Testnet passphrase when environment is mainnet", () => {
    const result = validateResolvedConfig(
      mainnetConfig({ networkPassphrase: TESTNET_PASSPHRASE }),
    );
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.code === "PASSPHRASE_ENVIRONMENT_MISMATCH"),
    ).toBe(true);
  });

  it("includes the remedy text for passphrase mismatch", () => {
    const result = validateResolvedConfig(
      testnetConfig({ networkPassphrase: MAINNET_PASSPHRASE }),
    );
    const issue = result.issues.find((i) => i.code === "PASSPHRASE_ENVIRONMENT_MISMATCH");
    expect(issue?.remedy).toContain("STELLAR_NETWORK");
  });
});

describe("validateResolvedConfig — invalid Horizon endpoint", () => {
  it("rejects a non-URL string as horizonUrl", () => {
    const result = validateResolvedConfig(testnetConfig({ horizonUrl: "not-a-url" }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INVALID_HORIZON_URL")).toBe(true);
  });

  it("rejects the Mainnet Horizon URL when environment is testnet", () => {
    const result = validateResolvedConfig(
      testnetConfig({ horizonUrl: DEFAULT_HORIZON_URLS.mainnet }),
    );
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.code === "HORIZON_ENVIRONMENT_MISMATCH"),
    ).toBe(true);
  });

  it("rejects a Testnet Horizon URL for a Mainnet config", () => {
    const result = validateResolvedConfig(
      mainnetConfig({ horizonUrl: DEFAULT_HORIZON_URLS.testnet }),
    );
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.code === "HORIZON_ENVIRONMENT_MISMATCH"),
    ).toBe(true);
  });

  it("rejects an HTTP Horizon URL for Mainnet", () => {
    const result = validateResolvedConfig(
      mainnetConfig({ horizonUrl: "http://horizon.stellar.org" }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INSECURE_MAINNET_HORIZON_URL")).toBe(true);
  });

  it("allows HTTP for local development", () => {
    const result = validateResolvedConfig(
      localConfig({ horizonUrl: "http://localhost:8000" }),
    );
    expect(result.valid).toBe(true);
  });
});

describe("validateResolvedConfig — invalid Soroban RPC endpoint", () => {
  it("rejects a non-URL string as sorobanRpcUrl", () => {
    const result = validateResolvedConfig(
      testnetConfig({ sorobanRpcUrl: "not-a-url" }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INVALID_SOROBAN_RPC_URL")).toBe(true);
  });

  it("rejects a Testnet Soroban RPC URL for a Mainnet config", () => {
    const result = validateResolvedConfig(
      mainnetConfig({ sorobanRpcUrl: "https://soroban-testnet.stellar.org" }),
    );
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.code === "SOROBAN_RPC_ENVIRONMENT_MISMATCH"),
    ).toBe(true);
  });

  it("accepts null sorobanRpcUrl", () => {
    const result = validateResolvedConfig(
      testnetConfig({ sorobanRpcUrl: null }),
    );
    expect(result.valid).toBe(true);
  });

  it("rejects an HTTP Soroban RPC URL for Mainnet", () => {
    const result = validateResolvedConfig(
      mainnetConfig({ sorobanRpcUrl: "http://my-rpc.example.com" }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INSECURE_MAINNET_SOROBAN_RPC_URL")).toBe(
      true,
    );
  });
});

describe("validateResolvedConfig — cross-environment mixing", () => {
  it("detects a Testnet passphrase paired with the canonical Mainnet Horizon URL", () => {
    const result = validateResolvedConfig({
      environment: "testnet",
      networkPassphrase: TESTNET_PASSPHRASE,
      horizonUrl: DEFAULT_HORIZON_URLS.mainnet,
      sorobanRpcUrl: null,
      explorerBaseUrl: "https://stellar.expert/explorer/testnet",
      sourceSecret: null,
      transactionTimeoutMs: 30000,
    });
    expect(result.valid).toBe(false);
    const codes = result.issues.map((i) => i.code);
    // Either the horizon mismatch or the explicit cross-env rule fires
    expect(
      codes.some((c) =>
        ["HORIZON_ENVIRONMENT_MISMATCH", "TESTNET_PASSPHRASE_WITH_MAINNET_HORIZON"].includes(c),
      ),
    ).toBe(true);
  });

  it("detects a Mainnet passphrase paired with the canonical Testnet Horizon URL", () => {
    const result = validateResolvedConfig({
      environment: "mainnet",
      networkPassphrase: MAINNET_PASSPHRASE,
      horizonUrl: DEFAULT_HORIZON_URLS.testnet,
      sorobanRpcUrl: null,
      explorerBaseUrl: "https://stellar.expert/explorer/public",
      sourceSecret: null,
      transactionTimeoutMs: 30000,
    });
    expect(result.valid).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(
      codes.some((c) =>
        ["HORIZON_ENVIRONMENT_MISMATCH", "MAINNET_PASSPHRASE_WITH_TESTNET_HORIZON"].includes(c),
      ),
    ).toBe(true);
  });

  it("includes a remedy for every cross-environment error", () => {
    const result = validateResolvedConfig({
      environment: "testnet",
      networkPassphrase: MAINNET_PASSPHRASE,
      horizonUrl: DEFAULT_HORIZON_URLS.mainnet,
      sorobanRpcUrl: null,
      explorerBaseUrl: "",
      sourceSecret: null,
      transactionTimeoutMs: 30000,
    });
    for (const issue of result.issues.filter((i) => i.severity === "error")) {
      expect(issue.remedy.length).toBeGreaterThan(0);
    }
  });
});

describe("validateResolvedConfig — production safeguards", () => {
  it("emits a warning when NODE_ENV=production but environment is testnet", () => {
    process.env.NODE_ENV = "production";
    const result = validateResolvedConfig(testnetConfig());
    expect(result.issues.some((i) => i.code === "PRODUCTION_BUILD_NON_MAINNET")).toBe(true);
    // But only a warning, not an error — the config is otherwise valid
    const prodIssue = result.issues.find((i) => i.code === "PRODUCTION_BUILD_NON_MAINNET");
    expect(prodIssue?.severity).toBe("warning");
  });

  it("suppresses the production warning when STELLAR_ALLOW_TESTNET_IN_PRODUCTION=true", () => {
    process.env.NODE_ENV = "production";
    process.env.STELLAR_ALLOW_TESTNET_IN_PRODUCTION = "true";
    const result = validateResolvedConfig(testnetConfig());
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.code === "PRODUCTION_BUILD_NON_MAINNET")).toBe(false);
  });

  it("does not warn for Mainnet on production builds", () => {
    process.env.NODE_ENV = "production";
    const result = validateResolvedConfig(mainnetConfig());
    expect(result.issues.some((i) => i.code === "PRODUCTION_BUILD_NON_MAINNET")).toBe(false);
  });

  it("does not warn for local NODE_ENV", () => {
    process.env.NODE_ENV = "development";
    const result = validateResolvedConfig(testnetConfig());
    expect(result.issues.some((i) => i.code === "PRODUCTION_BUILD_NON_MAINNET")).toBe(false);
  });
});

describe("validateResolvedConfig — diagnostics are safe to log", () => {
  it("redacts the network passphrase in diagnostics", () => {
    const result = validateResolvedConfig(testnetConfig());
    expect(result.diagnostics.networkPassphrase).not.toBe(TESTNET_PASSPHRASE);
    expect(result.diagnostics.networkPassphrase).toContain("…");
  });

  it("does not expose the source secret in diagnostics", () => {
    const result = validateResolvedConfig(
      testnetConfig({ sourceSecret: "SUPER_SECRET_KEY" }),
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain("SUPER_SECRET_KEY");
  });

  it("reports whether sourceSecret is present", () => {
    const withSecret = validateResolvedConfig(
      testnetConfig({ sourceSecret: "SKEY" }),
    );
    expect(withSecret.diagnostics.sourceSecretPresent).toBe("yes");

    const withoutSecret = validateResolvedConfig(
      testnetConfig({ sourceSecret: null }),
    );
    expect(withoutSecret.diagnostics.sourceSecretPresent).toBe("no");
  });
});

// ===========================================================================
// 8. validateEnvironmentConfig — full env-var based path
// ===========================================================================

describe("validateEnvironmentConfig", () => {
  it("fails with MISSING_STELLAR_NETWORK when env var is absent", () => {
    const result = validateEnvironmentConfig();
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MISSING_STELLAR_NETWORK")).toBe(true);
  });

  it("fails with MISSING_STELLAR_NETWORK for an unrecognised value", () => {
    process.env.STELLAR_NETWORK = "moon";
    const result = validateEnvironmentConfig();
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MISSING_STELLAR_NETWORK")).toBe(true);
  });

  it("validates a fully-set Testnet environment", () => {
    process.env.STELLAR_NETWORK = "testnet";
    process.env.STELLAR_SOURCE_SECRET = "STEST";

    const result = validateEnvironmentConfig();
    expect(result.valid).toBe(true);
    expect(result.environment).toBe("testnet");
  });

  it("validates a fully-set Mainnet environment", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    process.env.STELLAR_SOURCE_SECRET = "SMAIN";

    const result = validateEnvironmentConfig();
    expect(result.valid).toBe(true);
    expect(result.environment).toBe("mainnet");
  });

  it("includes environment info in diagnostics even for the missing-network case", () => {
    process.env.STELLAR_NETWORK = "unknown_value";
    const result = validateEnvironmentConfig();
    expect(result.diagnostics).toHaveProperty("STELLAR_NETWORK");
  });
});

// ===========================================================================
// 9. runStartupValidation
// ===========================================================================

describe("runStartupValidation", () => {
  it("returns false when STELLAR_NETWORK is not configured", () => {
    const ok = runStartupValidation();
    expect(ok).toBe(false);
  });

  it("returns true for a valid Testnet configuration", () => {
    process.env.STELLAR_NETWORK = "testnet";
    const ok = runStartupValidation();
    expect(ok).toBe(true);
  });

  it("returns true for a valid Mainnet configuration", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    const ok = runStartupValidation();
    expect(ok).toBe(true);
  });

  it("returns false when STELLAR_HORIZON_URL is a plain string (not a URL)", () => {
    process.env.STELLAR_NETWORK = "testnet";
    process.env.STELLAR_HORIZON_URL = "not-a-url";
    const ok = runStartupValidation();
    expect(ok).toBe(false);
  });

  it("does not throw even for a completely broken configuration", () => {
    process.env.STELLAR_NETWORK = "testnet";
    process.env.STELLAR_HORIZON_URL = "not-a-url";
    expect(() => runStartupValidation()).not.toThrow();
  });
});

// ===========================================================================
// 10. assertValidConfig — runtime guard
// ===========================================================================

describe("assertValidConfig", () => {
  it("does not throw for a valid Testnet config", () => {
    expect(() => assertValidConfig(testnetConfig())).not.toThrow();
  });

  it("does not throw for a valid Mainnet config", () => {
    expect(() => assertValidConfig(mainnetConfig())).not.toThrow();
  });

  it("throws when the passphrase does not match the environment", () => {
    expect(() =>
      assertValidConfig(testnetConfig({ networkPassphrase: MAINNET_PASSPHRASE })),
    ).toThrow();
  });

  it("throws when the Horizon URL is invalid", () => {
    expect(() =>
      assertValidConfig(testnetConfig({ horizonUrl: "not-a-url" })),
    ).toThrow();
  });

  it("includes all error codes in the thrown message", () => {
    try {
      assertValidConfig(testnetConfig({ horizonUrl: "not-a-url" }));
      expect(true).toBe(false); // should not reach
    } catch (err: any) {
      expect(err.message).toContain("INVALID_HORIZON_URL");
    }
  });

  it("thrown error message includes remedy text", () => {
    try {
      assertValidConfig(testnetConfig({ networkPassphrase: "wrong passphrase" }));
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.message).toContain("Remedy:");
    }
  });

  it("blocks transaction signing when passphrase is wrong", () => {
    // Simulate: code that guards transaction prep with assertValidConfig
    const signTransaction = (config: ResolvedStellarConfig) => {
      assertValidConfig(config);
      return `signed with ${config.networkPassphrase}`;
    };

    // Wrong passphrase → assertion fails → signing is blocked
    expect(() =>
      signTransaction(testnetConfig({ networkPassphrase: MAINNET_PASSPHRASE })),
    ).toThrow();

    // Correct passphrase → signing proceeds
    expect(signTransaction(testnetConfig())).toContain(TESTNET_PASSPHRASE);
  });
});

// ===========================================================================
// 11. Transaction passphrase selection
// ===========================================================================

describe("Correct transaction signing passphrase selection", () => {
  it("Testnet config carries the Testnet passphrase", () => {
    process.env.STELLAR_NETWORK = "testnet";
    const config = resolveNetworkConfig();
    expect(config!.networkPassphrase).toBe(TESTNET_PASSPHRASE);
  });

  it("Mainnet config carries the Mainnet passphrase", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    const config = resolveNetworkConfig();
    expect(config!.networkPassphrase).toBe(MAINNET_PASSPHRASE);
  });

  it("resolved passphrase matches the inferred environment", () => {
    for (const env of ["testnet", "mainnet"] as const) {
      process.env.STELLAR_NETWORK = env;
      const config = resolveNetworkConfig()!;
      expect(inferEnvironmentFromPassphrase(config.networkPassphrase)).toBe(env);
    }
  });
});

// ===========================================================================
// 12. buildExplorerUrl
// ===========================================================================

describe("buildExplorerUrl", () => {
  it("produces a Testnet explorer URL", () => {
    const url = buildExplorerUrl("abc123", "testnet");
    expect(url).toContain("stellar.expert/explorer/testnet/tx/abc123");
  });

  it("produces a Mainnet explorer URL", () => {
    const url = buildExplorerUrl("abc123", "mainnet");
    expect(url).toContain("stellar.expert/explorer/public/tx/abc123");
  });
});

// ===========================================================================
// 13. Prevention of fallback network behaviour
// ===========================================================================

describe("Prevention of fallback network behaviour", () => {
  it("resolveNetworkConfig returns null instead of silently defaulting to testnet", () => {
    // No env vars set at all
    const config = resolveNetworkConfig();
    expect(config).toBeNull();
  });

  it("validateEnvironmentConfig reports an error rather than defaulting", () => {
    const result = validateEnvironmentConfig();
    expect(result.valid).toBe(false);
    expect(result.environment).toBeNull();
  });

  it("runStartupValidation returns false rather than defaulting", () => {
    const ok = runStartupValidation();
    expect(ok).toBe(false);
  });
});

// ===========================================================================
// 14. Environment isolation
// ===========================================================================

describe("Environment-specific configuration isolation", () => {
  it("Testnet and Mainnet profiles have distinct passphrases", () => {
    expect(NETWORK_PROFILES.testnet.networkPassphrase).not.toBe(
      NETWORK_PROFILES.mainnet.networkPassphrase,
    );
  });

  it("Testnet and Mainnet profiles have distinct Horizon endpoints", () => {
    expect(NETWORK_PROFILES.testnet.defaultHorizonUrl).not.toBe(
      NETWORK_PROFILES.mainnet.defaultHorizonUrl,
    );
  });

  it("Testnet and Mainnet profiles have distinct explorer base URLs", () => {
    expect(NETWORK_PROFILES.testnet.explorerBaseUrl).not.toBe(
      NETWORK_PROFILES.mainnet.explorerBaseUrl,
    );
  });

  it("resolving testnet config does not bleed into mainnet config", () => {
    process.env.STELLAR_NETWORK = "testnet";
    const testnetCfg = resolveNetworkConfig();

    delete process.env.STELLAR_NETWORK;
    process.env.STELLAR_NETWORK = "mainnet";
    const mainnetCfg = resolveNetworkConfig();

    expect(testnetCfg!.networkPassphrase).not.toBe(mainnetCfg!.networkPassphrase);
    expect(testnetCfg!.horizonUrl).not.toBe(mainnetCfg!.horizonUrl);
  });
});
