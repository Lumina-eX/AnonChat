/**
 * Stellar wallet signature verification utility.
 *
 * Stellar keypairs use Ed25519. The Stellar SDK exposes
 * `Keypair.fromPublicKey(pubkey).verify(data, signature)` which we
 * use to check that a wallet owner actually signed the nonce.
 *
 * The nonce is stored server-side in a simple in-memory Map with a
 * TTL so it can only be used once and expires after 5 minutes.
 * For production scale, swap the in-memory store for a Redis cache
 * or a Supabase table.
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { getRedisClient } from "@/lib/redis";

// ── Nonce store ───────────────────────────────────────────────────────────────
// { walletAddress → { nonce, expiresAt } }
const memoryNonces = new Map<string, { nonce: string; expiresAt: number }>();
const NONCE_TTL_SEC = 5 * 60; // 5 minutes

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
