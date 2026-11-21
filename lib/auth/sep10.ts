/**
 * Stellar Web Authentication (SEP-10) compatibility helpers.
 *
 * Implements the challenge/response flow defined by SEP-10:
 *   1. The server builds and signs a challenge transaction for the wallet.
 *   2. The wallet signs the same challenge transaction.
 *   3. The server validates the challenge structure, time bounds, network,
 *      server signature and wallet signature before issuing a session.
 *
 * Challenge transactions are single-use. Their hash is recorded in Redis (or
 * an in-memory fallback) so a replayed challenge is always rejected.
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { getRedisClient } from "@/lib/redis";
import { logger } from "@/lib/logger";

const DEFAULT_CHALLENGE_TTL_SEC = 300;
const DEFAULT_HOME_DOMAIN = "anonchat.app";
const REPLAY_KEY_PREFIX = "sep10:challenge:";
const RATE_LIMIT_KEY_PREFIX = "sep10:ratelimit:";

export type Sep10ErrorCode =
  | "server_not_configured"
  | "invalid_account"
  | "invalid_challenge"
  | "challenge_replayed"
  | "account_mismatch"
  | "rate_limited";

export class Sep10Error extends Error {
  readonly code: Sep10ErrorCode;

  constructor(code: Sep10ErrorCode, message: string) {
    super(message);
    this.name = "Sep10Error";
    this.code = code;
  }
}

export interface Sep10Config {
  serverPublicKey: string;
  serverKeypair: StellarSdk.Keypair;
  networkPassphrase: string;
  homeDomain: string;
  webAuthDomain: string;
  challengeTtlSec: number;
}

export interface Sep10Challenge {
  transaction: string;
  networkPassphrase: string;
  expiresIn: number;
}

export interface Sep10Verification {
  walletAddress: string;
  transactionHash: string;
  memo: string | null;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveHomeDomain(): string {
  const configured = process.env.SEP10_HOME_DOMAIN?.trim();
  if (configured) return configured;

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (appUrl) {
    try {
      return new URL(appUrl).host;
    } catch {
      // Fall through to the default below.
    }
  }

  return DEFAULT_HOME_DOMAIN;
}

function resolveNetworkPassphrase(): string {
  const explicit =
    process.env.SEP10_NETWORK_PASSPHRASE?.trim() ||
    process.env.STELLAR_NETWORK_PASSPHRASE?.trim();
  if (explicit) return explicit;

  return process.env.STELLAR_NETWORK === "mainnet"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;
}

/**
 * Loads SEP-10 configuration from the environment.
 * Returns null when the server signing key is missing or malformed.
 */
export function loadSep10Config(): Sep10Config | null {
  const serverSecret = process.env.SEP10_SERVER_SECRET?.trim();
  if (!serverSecret) return null;

  let serverKeypair: StellarSdk.Keypair;
  try {
    serverKeypair = StellarSdk.Keypair.fromSecret(serverSecret);
  } catch {
    logger.error("sep10.invalid_server_secret");
    return null;
  }

  const homeDomain = resolveHomeDomain();
  const webAuthDomain = process.env.SEP10_WEB_AUTH_DOMAIN?.trim() || homeDomain;

  return {
    serverKeypair,
    serverPublicKey: serverKeypair.publicKey(),
    networkPassphrase: resolveNetworkPassphrase(),
    homeDomain,
    webAuthDomain,
    challengeTtlSec: parsePositiveInt(
      process.env.SEP10_CHALLENGE_TTL_SECONDS,
      DEFAULT_CHALLENGE_TTL_SEC,
    ),
  };
}

function requireSep10Config(): Sep10Config {
  const config = loadSep10Config();
  if (!config) {
    throw new Sep10Error(
      "server_not_configured",
      "SEP-10 authentication is not configured on this server.",
    );
  }
  return config;
}

/**
 * Builds and signs a SEP-10 challenge transaction for `account`.
 */
export function buildSep10Challenge(account: string): Sep10Challenge {
  const config = requireSep10Config();

  if (!StellarSdk.StrKey.isValidEd25519PublicKey(account)) {
    throw new Sep10Error("invalid_account", "Invalid Stellar account address.");
  }

  let transaction: string;
  try {
    transaction = StellarSdk.WebAuth.buildChallengeTx(
      config.serverKeypair,
      account,
      config.homeDomain,
      config.challengeTtlSec,
      config.networkPassphrase,
      config.webAuthDomain,
    );
  } catch (error) {
    logger.error("sep10.challenge_build_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    throw new Sep10Error(
      "invalid_account",
      "Unable to build a challenge for this account.",
    );
  }

  logger.info("sep10.challenge_issued", {
    wallet: `${account.substring(0, 8)}...`,
    homeDomain: config.homeDomain,
    network: config.networkPassphrase,
    expiresIn: config.challengeTtlSec,
  });

  return {
    transaction,
    networkPassphrase: config.networkPassphrase,
    expiresIn: config.challengeTtlSec,
  };
}

/**
 * Validates a signed SEP-10 challenge transaction.
 *
 * The Stellar SDK validates the transaction structure, time bounds, network
 * passphrase and the server signature before this function checks the wallet
 * signature. The wallet must match `expectedAccount` when provided.
 */
export function verifySep10Challenge(
  transaction: string,
  expectedAccount?: string,
): Sep10Verification {
  const config = requireSep10Config();

  if (typeof transaction !== "string" || transaction.trim() === "") {
    throw new Sep10Error("invalid_challenge", "Challenge transaction is required.");
  }

  let details: ReturnType<typeof StellarSdk.WebAuth.readChallengeTx>;
  try {
    details = StellarSdk.WebAuth.readChallengeTx(
      transaction,
      config.serverPublicKey,
      config.networkPassphrase,
      config.homeDomain,
      config.webAuthDomain,
    );
  } catch (error) {
    logger.warn("sep10.challenge_rejected", {
      stage: "structure",
      reason: error instanceof Error ? error.message : "unknown",
    });
    throw new Sep10Error(
      "invalid_challenge",
      "Invalid or expired challenge transaction.",
    );
  }

  const walletAddress = details.clientAccountID;

  if (expectedAccount && expectedAccount !== walletAddress) {
    logger.warn("sep10.challenge_rejected", {
      stage: "account_mismatch",
      wallet: `${walletAddress.substring(0, 8)}...`,
    });
    throw new Sep10Error(
      "account_mismatch",
      "Challenge transaction does not match the expected account.",
    );
  }

  let signers: string[];
  try {
    signers = StellarSdk.WebAuth.verifyChallengeTxSigners(
      transaction,
      config.serverPublicKey,
      config.networkPassphrase,
      [walletAddress],
      config.homeDomain,
      config.webAuthDomain,
    );
  } catch (error) {
    logger.warn("sep10.challenge_rejected", {
      stage: "signature",
      wallet: `${walletAddress.substring(0, 8)}...`,
      reason: error instanceof Error ? error.message : "unknown",
    });
    throw new Sep10Error(
      "invalid_challenge",
      "Challenge transaction signature could not be verified.",
    );
  }

  if (!signers.includes(walletAddress)) {
    throw new Sep10Error(
      "invalid_challenge",
      "Challenge transaction is not signed by the expected wallet.",
    );
  }

  return {
    walletAddress,
    transactionHash: details.tx.hash().toString("hex"),
    memo: details.memo ?? null,
  };
}

/**
 * Marks a challenge transaction as used. Returns false when the challenge was
 * already consumed (replay attempt).
 */
export async function consumeSep10Challenge(
  transactionHash: string,
  ttlSec: number,
): Promise<boolean> {
  const key = `${REPLAY_KEY_PREFIX}${transactionHash}`;
  const redis = await getRedisClient();

  if (redis) {
    const result = await redis.set(key, "1", {
      NX: true,
      EX: Math.max(ttlSec, 60),
    });
    return result === "OK";
  }

  const now = Date.now();
  const existing = memoryChallenges.get(key);
  if (existing && existing > now) {
    return false;
  }

  memoryChallenges.set(key, now + Math.max(ttlSec, 60) * 1000);
  return true;
}

export interface Sep10RatePolicy {
  limit: number;
  windowSec: number;
}

export function getSep10RatePolicy(): Sep10RatePolicy {
  return {
    limit: parsePositiveInt(process.env.SEP10_RATE_LIMIT, 20),
    windowSec: parsePositiveInt(process.env.SEP10_RATE_WINDOW_SECONDS, 60),
  };
}

/**
 * Fixed-window rate limit keyed by caller identity (IP or account).
 * Returns true when the request is allowed.
 */
export async function checkSep10RateLimit(
  identity: string,
  policy: Sep10RatePolicy = getSep10RatePolicy(),
): Promise<boolean> {
  const key = `${RATE_LIMIT_KEY_PREFIX}${identity}`;
  const redis = await getRedisClient();

  if (redis) {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, policy.windowSec);
    }
    return count <= policy.limit;
  }

  const now = Date.now();
  const window = memoryRateWindows.get(key);
  if (!window || window.resetAt <= now) {
    memoryRateWindows.set(key, { count: 1, resetAt: now + policy.windowSec * 1000 });
    return true;
  }

  window.count += 1;
  return window.count <= policy.limit;
}

/**
 * Best-effort caller IP extraction for rate limiting. Never logged raw.
 */
export function getCallerIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** Clears in-memory replay and rate-limit state. Intended for tests only. */
export function clearSep10State(): void {
  memoryChallenges.clear();
  memoryRateWindows.clear();
}

const memoryChallenges = new Map<string, number>();
const memoryRateWindows = new Map<string, { count: number; resetAt: number }>();
