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

// ── Nonce store ───────────────────────────────────────────────────────────────
// { walletAddress → { nonce, expiresAt } }
const nonces = new Map<string, { nonce: string; expiresAt: number }>();
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Generates a cryptographically random nonce, stores and returns it. */
export function generateNonce(walletAddress: string): string {
  // Use crypto.randomUUID for a high-entropy random value
  const nonce = `anonchat:${Date.now()}:${crypto.randomUUID()}`;
  nonces.set(walletAddress, { nonce, expiresAt: Date.now() + NONCE_TTL_MS });
  return nonce;
}

/** Retrieves the stored nonce for a wallet and validates it hasn't expired. */
export function consumeNonce(walletAddress: string): string | null {
  const entry = nonces.get(walletAddress);
  if (!entry) return null;
  nonces.delete(walletAddress); // One-time use
  if (Date.now() > entry.expiresAt) return null;
  return entry.nonce;
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
