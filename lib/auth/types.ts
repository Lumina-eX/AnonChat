/**
 * Type definitions for wallet signature verification authentication API
 * 
 * These types define the request/response interfaces for the authentication
 * endpoints that implement cryptographic wallet signature verification.
 */

/**
 * Supabase Session type
 */
export interface Session {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  user?: User;
}

/**
 * Supabase User type  
 */
export interface User {
  id: string;
  aud?: string;
  email?: string;
  email_confirmed_at?: string;
  phone?: string;
  confirmed_at?: string;
  last_sign_in_at?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  identities?: Array<{
    identity_id: string;
    id: string;
    user_id: string;
    identity_data?: Record<string, unknown>;
    provider: string;
    created_at?: string;
    updated_at?: string;
  }>;
  created_at?: string;
  updated_at?: string;
}

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
 */
export interface AuditLogEntry {
  audit: true;
  action: string;
  wallet: string;
  timestamp: string;
  [key: string]: unknown;
}
