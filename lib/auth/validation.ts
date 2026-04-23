/**
 * Input validation utilities for wallet authentication
 * 
 * This module provides validation functions for wallet addresses and request bodies
 * used in the authentication API endpoints.
 */

/**
 * Validates a Stellar wallet address format.
 * 
 * A valid Stellar address must:
 * - Be exactly 56 characters long
 * - Start with the letter 'G'
 * 
 * @param address - The wallet address to validate
 * @returns true if the address is valid, false otherwise
 * 
 * @example
 * validateStellarAddress('GABC...XYZ9') // returns true
 * validateStellarAddress('invalid') // returns false
 */
export function validateStellarAddress(address: string): boolean {
  if (typeof address !== 'string') {
    return false;
  }
  
  return address.length === 56 && address.startsWith('G');
}

/**
 * Validation error with descriptive message
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validates required fields in a request body.
 * 
 * @param body - The request body to validate
 * @param requiredFields - Array of field names that must be present
 * @returns Array of validation errors (empty if all fields are valid)
 * 
 * @example
 * validateRequiredFields({ walletAddress: 'GABC...' }, ['walletAddress', 'signature'])
 * // returns [{ field: 'signature', message: 'signature is required' }]
 */
export function validateRequiredFields(
  body: Record<string, any>,
  requiredFields: string[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  
  for (const field of requiredFields) {
    if (!body[field] || typeof body[field] !== 'string' || body[field].trim() === '') {
      errors.push({
        field,
        message: `${field} is required`
      });
    }
  }
  
  return errors;
}

/**
 * Validates a wallet address and returns a descriptive error message if invalid.
 * 
 * @param walletAddress - The wallet address to validate
 * @returns Error message if invalid, null if valid
 * 
 * @example
 * validateWalletAddressWithMessage('GABC...XYZ9') // returns null
 * validateWalletAddressWithMessage('invalid') // returns 'Invalid Stellar wallet address'
 */
export function validateWalletAddressWithMessage(walletAddress: string): string | null {
  if (!walletAddress || typeof walletAddress !== 'string') {
    return 'walletAddress is required';
  }
  
  if (!validateStellarAddress(walletAddress)) {
    return 'Invalid Stellar wallet address';
  }
  
  return null;
}
