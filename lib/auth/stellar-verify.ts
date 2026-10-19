/**
 * Stellar SEP-10 authentication utility.
 *
 * Implements Stellar Web Authentication (SEP-10): a challenge transaction
 * is generated and signed by the server, the wallet signs it, and the
 * server validates structure, expiration, server signature, wallet
 * signature, network passphrase, and replay protections before an
 * application session is issued.
 *
 * Challenge transactions are stored server-side (Redis or in-memory
 * fallback) with a TTL so they can only be used once and expire after
 * 5 minutes. For production scale, prefer Redis.
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { getRedisClient } from "@/lib/redis";

// ── Nonce store ───────────────────────────────────────────────────────────────
// { walletAddress → { nonce, expiresAt } }
const memoryNonces = new Map<string, { nonce: string; expiresAt: number }>();
const NONCE_TTL_SEC = 5 * 60; // 5 minutes

// ── Challenge store ───────────────────────────────────────────────────────────
// { challengeId → { walletAddress, challengeXdr, expiresAt } }
const memoryChallenges = new Map<string, { walletAddress: string; challengeXdr: string; expiresAt: number }>();
const CHALLENGE_TTL_SEC = 5 * 60; // 5 minutes
const SEP10_HOME_DOMAIN = process.env.SEP10_HOME_DOMAIN || "localhost";
const SEP10_WEB_AUTH_DOMAIN = process.env.SEP10_WEB_AUTH_DOMAIN || SEP10_HOME_DOMAIN;

/** Generates a cryptographically random nonce, stores and returns it. */
export async function generateNonce(walletAddress: string): Promise<string> {
  const nonce = `anonchat:${Date.now()}:${crypto.randomUUID()}`;
  const redis = await getRedisClient();

  if (redis) {
    const key = `nonce:${walletAddress}`;
    await redis.set(key, nonce, { EX: NONCE_TTL_SEC });
    console.log(`[auth] Nonce generated and stored in Redis for ${walletAddress.substring(0, 8)}...`);
  } else {
    // Fallback to in-memory if Redis is unavailable
    memoryNonces.set(walletAddress, {
      nonce,
      expiresAt: Date.now() + NONCE_TTL_SEC * 1000,
    });
    console.warn(`[auth] Redis unavailable, using in-memory nonce storage for ${walletAddress.substring(0, 8)}...`);
  }

  return nonce;
}


/** Retrieves the stored nonce for a wallet and validates it hasn't expired. */
export async function consumeNonce(walletAddress: string): Promise<string | null> {
  const redis = await getRedisClient();

  if (redis) {
    const key = `nonce:${walletAddress}`;
    const nonce = await redis.get(key);
    if (nonce) {
      await redis.del(key); // One-time use
      console.log(`[auth] Nonce consumed from Redis for ${walletAddress.substring(0, 8)}...`);
      return nonce;
    }
  } else {
    // Fallback to in-memory
    const entry = memoryNonces.get(walletAddress);
    if (entry) {
      memoryNonces.delete(walletAddress); // One-time use
      if (Date.now() <= entry.expiresAt) {
        console.log(`[auth] Nonce consumed from memory for ${walletAddress.substring(0, 8)}...`);
        return entry.nonce;
      }
      console.warn(`[auth] Memory nonce expired for ${walletAddress.substring(0, 8)}...`);
    }
  }

  console.warn(`[auth] Nonce not found or expired for ${walletAddress.substring(0, 8)}...`);
  return null;
}


// ── Signature verification ────────────────────────────────────────────────────
/**
 * Verifies that `signature` (hex string) was produced by the private key
 * belonging to `walletAddress` over the UTF-8 bytes of `message`.
 *
 * Returns true if valid, false otherwise.
 */
export function verifyWalletSignature(
  walletAddress: string,
  message: string,
  signature: string,
): boolean {
  try {
    const keypair = StellarSdk.Keypair.fromPublicKey(walletAddress);
    const messageBytes = Buffer.from(message, "utf-8");
    const signatureBytes = Buffer.from(signature, "hex");
    return keypair.verify(messageBytes, signatureBytes);
  } catch {
    return false;
  }
}

// ── SEP-10 challenge generation ───────────────────────────────────────────────
/**
 * Returns the server signing keypair used to sign SEP-10 challenges.
 * The secret is read from the environment and never exposed.
 */
function getServerKeypair(): StellarSdk.Keypair {
  const secret = process.env.SEP10_SERVER_SECRET;
  if (!secret) {
    throw new Error("SEP10_SERVER_SECRET is not configured");
  }
  return StellarSdk.Keypair.fromSecret(secret);
}

/** Returns the configured Stellar network passphrase. */
function getNetworkPassphrase(): string {
  return process.env.STELLAR_NETWORK_PASSPHRASE || StellarSdk.Networks.TESTNET;
}

/**
 * Generates a SEP-10 challenge transaction for `walletAddress`, signs it
 * with the server keypair, stores it for one-time use, and returns the
 * base64-encoded challenge XDR plus the challenge id.
 */
export async function generateChallenge(
  walletAddress: string,
): Promise<{ challenge: string; challengeId: string; networkPassphrase: string }> {
  // Validate the wallet address up front so we never build a challenge for
  // an invalid account.
  StellarSdk.Keypair.fromPublicKey(walletAddress);

  const serverKeypair = getServerKeypair();
  const networkPassphrase = getNetworkPassphrase();
  const now = Math.floor(Date.now() / 1000);
  const challengeId = crypto.randomUUID();

  const account = new StellarSdk.Account(serverKeypair.publicKey(), "-1");
  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
    timebounds: {
      minTime: now,
      maxTime: now + CHALLENGE_TTL_SEC,
    },
  })
    .addOperation(
      StellarSdk.Operation.manageData({
        name: `${SEP10_HOME_DOMAIN} auth`,
        value: Buffer.from(challengeId, "utf-8"),
      }),
    )
    .addOperation(
      StellarSdk.Operation.manageData({
        name: "web_auth_domain",
        value: Buffer.from(SEP10_WEB_AUTH_DOMAIN, "utf-8"),
      }),
    )
    .addOperation(
      StellarSdk.Operation.manageData({
        name: "client_domain",
        value: Buffer.from(walletAddress, "utf-8"),
      }),
    )
    .build();

  transaction.sign(serverKeypair);

  const challengeXdr = transaction.toEnvelope().toXDR("base64");
  const expiresAt = Date.now() + CHALLENGE_TTL_SEC * 1000;

  const redis = await getRedisClient();
  if (redis) {
    const key = `sep10:challenge:${challengeId}`;
    await redis.set(
      key,
      JSON.stringify({ walletAddress, challengeXdr }),
      { EX: CHALLENGE_TTL_SEC },
    );
    console.log(`[auth] SEP-10 challenge generated for ${walletAddress.substring(0, 8)}...`);
  } else {
    memoryChallenges.set(challengeId, { walletAddress, challengeXdr, expiresAt });
    console.warn(`[auth] Redis unavailable, using in-memory challenge storage for ${walletAddress.substring(0, 8)}...`);
  }

  return { challenge: challengeXdr, challengeId, networkPassphrase };
}

// ── SEP-10 challenge validation ───────────────────────────────────────────────
export interface Sep10ValidationResult {
  valid: boolean;
  account?: string;
  error?: string;
}

/**
 * Validates a signed SEP-10 challenge transaction.
 *
 * Checks, in order:
 *  - transaction parses and matches the expected network passphrase
 *  - challenge exists in the store (replay protection) and is not expired
 *  - transaction timebounds are present and not expired
 *  - server signature is present and valid
 *  - wallet signature is present and valid for the expected account
 *  - the authenticated account matches the expected wallet address
 *
 * On success the challenge is consumed so it cannot be replayed.
 */
export async function validateChallenge(
  challengeXdr: string,
  expectedWalletAddress: string,
): Promise<Sep10ValidationResult> {
  let transaction: StellarSdk.Transaction;
  try {
    transaction = new StellarSdk.Transaction(challengeXdr, getNetworkPassphrase());
  } catch {
    return { valid: false, error: "invalid_challenge" };
  }

  // Extract challenge id from the manageData operation.
  const ops = transaction.operations;
  const authOp = ops.find(
    (op) =>
      op.type === "manageData" &&
      op.name === `${SEP10_HOME_DOMAIN} auth`,
  );
  if (!authOp || authOp.type !== "manageData" || !authOp.value) {
    return { valid: false, error: "invalid_challenge" };
  }
  const challengeId = authOp.value.toString("utf-8");

  // Replay protection: challenge must exist in the store.
  const redis = await getRedisClient();
  let stored: { walletAddress: string; challengeXdr: string } | null = null;
  if (redis) {
    const raw = await redis.get(`sep10:challenge:${challengeId}`);
    if (raw) {
      stored = JSON.parse(raw);
    }
  } else {
    const entry = memoryChallenges.get(challengeId);
    if (entry && Date.now() <= entry.expiresAt) {
      stored = { walletAddress: entry.walletAddress, challengeXdr: entry.challengeXdr };
    }
  }
  if (!stored) {
    console.warn(`[auth] SEP-10 challenge not found or expired for ${expectedWalletAddress.substring(0, 8)}...`);
    return { valid: false, error: "challenge_not_found" };
  }

  // The stored challenge must match exactly (tamper protection).
  if (stored.challengeXdr !== challengeXdr) {
    console.warn(`[auth] SEP-10 challenge mismatch for ${expectedWalletAddress.substring(0, 8)}...`);
    return { valid: false, error: "challenge_mismatch" };
  }

  // The stored wallet must match the expected wallet.
  if (stored.walletAddress !== expectedWalletAddress) {
    console.warn(`[auth] SEP-10 wallet mismatch for ${expectedWalletAddress.substring(0, 8)}...`);
    return { valid: false, error: "wallet_mismatch" };
  }

  // Expiration: timebounds must be present and not expired.
  const timebounds = transaction.timeBounds;
  if (!timebounds || !timebounds.maxTime) {
    return { valid: false, error: "missing_timebounds" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Number(timebounds.maxTime) < now) {
    console.warn(`[auth] SEP-10 challenge expired for ${expectedWalletAddress.substring(0, 8)}...`);
    return { valid: false, error: "challenge_expired" };
  }

  // Server signature must be present and valid before we trust anything else.
  const serverKeypair = getServerKeypair();
  const serverSigned = transaction.signatures.some((sig) => {
    try {
      return serverKeypair.verify(
        transaction.hash(),
        sig.signature(),
      );
    } catch {
      return false;
    }
  });
  if (!serverSigned) {
    console.warn(`[auth] SEP-10 missing/invalid server signature for ${expectedWalletAddress.substring(0, 8)}...`);
    return { valid: false, error: "invalid_server_signature" };
  }

  // Wallet signature must be present and valid for the expected account.
  let walletKeypair: StellarSdk.Keypair;
  try {
    walletKeypair = StellarSdk.Keypair.fromPublicKey(expectedWalletAddress);
  } catch {
    return { valid: false, error: "invalid_wallet_address" };
  }
  const walletSigned = transaction.signatures.some((sig) => {
    try {
      return walletKeypair.verify(
        transaction.hash(),
        sig.signature(),
      );
    } catch {
      return false;
    }
  });
  if (!walletSigned) {
    console.warn(`[auth] SEP-10 missing/invalid wallet signature for ${expectedWalletAddress.substring(0, 8)}...`);
    return { valid: false, error: "invalid_wallet_signature" };
  }

  // Consume the challenge so it cannot be replayed.
  if (redis) {
    await redis.del(`sep10:challenge:${challengeId}`);
  } else {
    memoryChallenges.delete(challengeId);
  }

  console.log(`[auth] SEP-10 authentication succeeded for ${expectedWalletAddress.substring(0, 8)}...`);
  return { valid: true, account: expectedWalletAddress };
}

/**
 * Convenience wrapper: verifies a signed SEP-10 challenge and returns the
 * authenticated account, or null on failure. Callers must only issue an
 * application session when this returns a non-null account.
 */
export async function verifySep10(
  challengeXdr: string,
  expectedWalletAddress: string,
): Promise<string | null> {
  const result = await validateChallenge(challengeXdr, expectedWalletAddress);
  return result.valid && result.account ? result.account : null;
}
