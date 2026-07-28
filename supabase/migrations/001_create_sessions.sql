CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  refresh_token_jti TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_wallet_address ON sessions (wallet_address);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token_jti ON sessions (refresh_token_jti);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions (wallet_address) WHERE revoked_at IS NULL AND expires_at > now();