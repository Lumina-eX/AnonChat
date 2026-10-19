/**
 * Type definitions for wallet signature verification authentication API (SEP-10 compatible)
 *
 * These types define the request/response interfaces for the authentication
 * endpoints that implement cryptographic wallet signature verification using
 * Stellar Web Authentication (SED-10) challenge-transaction flow.
 */

import type { Session, User } from '@supabase/supabase-js';

/**
 * Request body for POST /api/auth/nonce
 *
 * Requests a SEP-10 challenge transaction for wallet authentication.
 * The challenge is time-limited and can be used once.
 */
export interface NonceRequest {
  /** Stellar public key (56 characters, starts with 'G') */
  walletAddress: string;
}

/**
 * Response body for POST /api/auth/nonce
 *
 * Returns a SEP-10 challenge transaction (base64-encoded XDR envelope) that
 * must be signed by the wallet's private key.
 */
export interface NonceResponse {
  /** Base64-encoded SEP-10 challenge transaction XDR envelope */
  challenge: string;
  /** ISO 8601 timestamp at which the challenge expires */
  expiresAt: string;
  /** Stellar Network Passphrase the challenge is bound to */
  networkPassphrase: string;
  /** Server account (G) issuing the challenge */
  serverAccount: string;
}

/**
 * Request body for POST /api/auth/wallet-login
 *
 * Authenticates a user by verifying their signed SEP-10 challenge
 * transaction. The challenge must be signed by the wallet's private key.
 */
export interface WalletLoginRequest {
  /** Stellar public key (56 characters, starts with 'G') */
  walletAddress: string;
  /** Base64-encoded signed SEP-10 challenge transaction XDR envelope */
  challenge: string;
}

/**
 * Response body for POST /api/auth/wallet-login
*
 * Returns authentication session and user information after successful
 * challenge verification.
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
 * rate limiting (429), and internal server errors (500).
 *
 * Error messages MUST not expose sensitive authentication details such as
 * signatures, server secrets, or internal validation reasons.
 */
export interface ErrorResponse {
  /** Human-readable error message */
  error: string;
}

/**
 * Request body for routes protected by signed message verification middleware.
 * Used with verifySignedMessage() from signed-message-middleware.ts
 */
export interface SignedActionRequest {
  /** Stellar public key (56 characters, starts with 'G') */
  walletAddress: string;
  /** The plaintext message that was signed */
  message: string;
  /** Hex-encoded Ed25519 signature of the message */
  signature: string;
}

/**
 * Audit log entry shape for sensitive actions
 *
 * Audit entries MUST NOT contain private keys, secrets, signing artifacts,
 * or raw signature bytes. Only non-sensitive metadata is recorded.
 */
export interface AuditLogEntry {
  audit: true;
  action: string;
  wallet: string;
  timestamp: string;
  [Key: string]: unknown;
}

/**
 * Structured authentication event log entry for SEP-10 flows.
 *
 * Recorded for security monitoring and auditing. Must not contain
 * signatures, secrets or signing artifacts.
 */
export interface AuthEventLog {
  /** Event type (e.g. 'challenge_issued', 'auth_success', 'auth_failure') */
  event: string;
  /** Stellar account involved, if known */
  account?: string;
  /** ISO 8601 timestamp of the event */
  timestamp: string;
  /** Stable, non-sensitive reason code for failures */
  reason?: string;
  /** Client IP address for abuse detection */
 ipAddress?: string;
  /** Request identifier for correlation */
  requestId?: string;
  /** Additional non-sensitive metadata */
  [key: string]: unknown;
}
