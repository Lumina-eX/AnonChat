-- Migration: Group ↔ Stellar transaction memo mapping
-- Description: Stores the mapping between a group ID and the Stellar
--              transaction that carries the group ID in its memo field.
--              Enables fast lookups without hitting the Stellar network.
-- Date: 2026-04-27

CREATE TABLE IF NOT EXISTS public.group_memo_transactions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        TEXT        NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  transaction_hash TEXT       NOT NULL UNIQUE,
  memo_value      TEXT        NOT NULL,
  memo_type       TEXT        NOT NULL CHECK (memo_type IN ('text', 'hash')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Fast lookup by group ID (one group may have multiple memo transactions over time)
CREATE INDEX IF NOT EXISTS idx_group_memo_group_id
  ON public.group_memo_transactions(group_id);

-- Fast lookup by transaction hash
CREATE INDEX IF NOT EXISTS idx_group_memo_tx_hash
  ON public.group_memo_transactions(transaction_hash);

-- Row Level Security
ALTER TABLE public.group_memo_transactions ENABLE ROW LEVEL SECURITY;

-- Anyone can read memo records (they are public on-chain anyway)
CREATE POLICY "Anyone can view group memo transactions"
  ON public.group_memo_transactions FOR SELECT
  USING (true);

-- Only the service role (server-side) may insert
CREATE POLICY "Service role can insert group memo transactions"
  ON public.group_memo_transactions FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.group_memo_transactions IS
  'Maps AnonChat group IDs to Stellar transaction hashes via the memo field. '
  'Enables lightweight group identification without custom contracts.';

COMMENT ON COLUMN public.group_memo_transactions.memo_value IS
  'For memo_type=text: the raw group ID (≤28 bytes). '
  'For memo_type=hash: the hex-encoded SHA-256 of the group ID.';
