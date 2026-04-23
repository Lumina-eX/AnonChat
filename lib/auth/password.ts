/**
 * Deterministic password generation for wallet-based authentication.
 * 
 * This module provides HMAC-SHA256 based password derivation from wallet addresses,
 * enabling Supabase authentication without storing passwords. Each wallet address
 * consistently produces the same password, allowing users to authenticate across
 * sessions while maintaining security through the WALLET_AUTH_SECRET.
 */

/**
 * Generates a deterministic password from a wallet address using HMAC-SHA256.
 * 
 * The password is derived by computing HMAC-SHA256(WALLET_AUTH_SECRET, walletAddress)
 * and encoding the result as a 64-character hexadecimal string. This ensures:
 * - Same wallet always produces the same password (deterministic)
 * - Different wallets produce uncorrelated passwords (cryptographic strength)
 * - Password cannot be derived without the secret (security)
 * 
 * @param walletAddress - Stellar public key (56 characters starting with 'G')
 * @returns Promise resolving to 64-character hex string (256 bits of entropy)
 * @throws Error if WALLET_AUTH_SECRET environment variable is not set
 * 
 * @example
 * const password = await deterministicPassword('GABC...XYZ9');
 * // Returns: "a1b2c3d4..." (64 hex characters)
 */
export async function deterministicPassword(walletAddress: string): Promise<string> {
  const secret = process.env.WALLET_AUTH_SECRET;
  
  if (!secret) {
    throw new Error("WALLET_AUTH_SECRET environment variable is not set");
  }

  // Import the secret as HMAC key material
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(secret);
  
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    secretBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Compute HMAC-SHA256(secret, walletAddress)
  const walletBytes = encoder.encode(walletAddress);
  const signature = await crypto.subtle.sign(
    "HMAC",
    keyMaterial,
    walletBytes as BufferSource
  );

  // Convert to 64-character hex string
  return Buffer.from(signature).toString("hex");
}
