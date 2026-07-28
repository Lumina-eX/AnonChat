export interface SessionRecord {
  id: string;
  wallet_address: string;
  refresh_token_jti: string;
  created_at: string;
  expires_at: string;
  last_active_at: string;
  revoked_at: string | null;
}

export interface CreateSessionInput {
  walletAddress: string;
  refreshTokenJti: string;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}

export const SESSION_TABLE = "sessions";
export const DEFAULT_SESSION_TTL_DAYS = 30;
export const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;