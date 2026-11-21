/**
 * Stellar address validation utility using the Stellar SDK.
 *
 * Uses StrKey.isValidEd25519PublicKey which decodes the Base32-encoded
 * address and validates the checksum — far more robust than a simple
 * length + prefix check.
 */
import { StrKey } from "@stellar/stellar-sdk";

/**
 * Returns true if `address` is a valid Stellar Ed25519 public key (G…).
 */
export function isValidStellarAddress(address: unknown): boolean {
  if (typeof address !== "string" || address.trim() === "") return false;
  try {
    return StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}

/**
 * Returns a descriptive error message when `address` is invalid,
 * or null when it is valid.
 */
export function getStellarAddressError(address: unknown): string | null {
  if (typeof address !== "string" || address.trim() === "") {
    return "Stellar address is required";
  }
  return isValidStellarAddress(address) ? null : "Invalid Stellar address";
}
