/**
 * Type definitions for wallet signature verification authentication API
 * 
 * These types define the request/response interfaces for the authentication
 * endpoints that implement cryptographic wallet signature verification.
 */

import type { Session, User } from '@supabase/supabase-js';

/**
 * Request body for POST /api/auth/nonce
 * 
 * Requests a cryptographically random nonce for wallet authentication.
 * The nonce is valid for 5 minutes and can be used once.
 */
export interface NonceRequest {
  /** Stellar public key (56 characters, starts with 'G') */
  walletAddress: string;
}

/**
 * Response body for POST /api/auth/nonce
 * 
 * Returns a time-limited nonce that must be signed by the wallet's private key.
 */
export interface NonceResponse {
  /** Nonce string in format "anonchat:{timestamp}:{uuid}" */
  nonce: string;
}

/**
 * Request body for POST /api/auth/wallet-login
 * 
 * Authenticates a user by verifying their wallet signature.
 * The signature must be created by signing the nonce with the wallet's private key.
 */
export interface WalletLoginRequest {
  /** Stellar public key (56 characters, starts with 'G') */
  walletAddress: string;
  /** Hex-encoded Ed25519 signature of the nonce */
  signature: string;
}

/**
 * Response body for POST /api/auth/wallet-login
 * 
 * Returns authentication session and user information after successful
 * signature verification.
 */
export interface WalletLoginResponse {
  /** Supabase session containing JWT tokens */
  session: Session;
  /** Supabase user object with wallet metadata */
  user: User;
  /** Confirmed wallet address that was authenticated */
  walletAddress: string;
  /** Whether this is a newly created user account */
  isNewUser: boolean;
}

/**
 * Error response for all authentication endpoints
 * 
 * Returned for validation failures (400), authentication failures (401),
 * and internal server errors (500).
 */
export interface ErrorResponse {
  /** Human-readable error message */
  error: string;
}
