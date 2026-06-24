/**
 * Input validation utilities for wallet authentication.
 */
import { StrKey } from "@stellar/stellar-sdk";

/**
 * Validates a Stellar wallet address using the Stellar SDK.
 *
 * A valid Stellar address is a base32-encoded Ed25519 public key
 * that starts with 'G' and is exactly 56 characters long.
 *
 * @param address - The wallet address to validate
 * @returns true if the address is a valid Stellar Ed25519 public key
 *
 * @example
 * validateStellarAddress('GABC...XYZ9') // returns true
 * validateStellarAddress('invalid')     // returns false
 */
export function validateStellarAddress(address: unknown): boolean {
  if (typeof address !== "string" || address.length === 0) return false;
  try {
    return StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}

/**
 * Validation error with descriptive message.
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validates required fields in a request body.
 *
 * @param body - The request body to validate
 * @param requiredFields - Array of field names that must be present and non-empty
 * @returns Array of validation errors (empty if all fields are valid)
 */
export function validateRequiredFields(
  body: Record<string, unknown>,
  requiredFields: string[]
): ValidationError[] {
  return requiredFields
    .filter((f) => !body[f] || typeof body[f] !== "string" || (body[f] as string).trim() === "")
    .map((f) => ({ field: f, message: `${f} is required` }));
}

/**
 * Returns a descriptive error message if the address is invalid, otherwise null.
 *
 * @param walletAddress - The wallet address to validate
 * @returns Error message string if invalid, null if valid
 */
export function validateWalletAddressWithMessage(walletAddress: unknown): string | null {
  if (!walletAddress || typeof walletAddress !== "string") {
    return "walletAddress is required";
  }
  return validateStellarAddress(walletAddress) ? null : "Invalid Stellar wallet address";
}
