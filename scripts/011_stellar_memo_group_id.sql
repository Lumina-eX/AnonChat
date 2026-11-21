-- Migration: Add Stellar memo group ID support
-- Description: Adds memo_group_id column to rooms and a lookup table for Stellar memo transaction mappings.
-- Date: 2026-04-25

-- Add memo_group_id column for the compact text embedded in the Stellar memo
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS memo_group_id TEXT NULL;

-- Enforce uniqueness so each memo maps to exactly one room
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_memo_group_id
  ON public.rooms(memo_group_id)
  WHERE memo_group_id IS NOT NULL;

-- Add comment
COMMENT ON COLUMN public.rooms.memo_group_id IS
  'Compact group identifier embedded in the Stellar transaction memo field';

-- Lookup table: group_tx_memos
-- Stores groupId, memo, and transactionId mappings for fast lookups without re-querying the blockchain.
CREATE TABLE IF NOT EXISTS public.group_tx_memos (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      TEXT        NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  memo_group_id TEXT        NOT NULL,
  tx_hash       TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (tx_hash)
);

-- Drop legacy uniqueness constraints if this migration is reapplied after an earlier draft.
ALTER TABLE public.group_tx_memos
  DROP CONSTRAINT IF EXISTS group_tx_memos_group_id_key;

ALTER TABLE public.group_tx_memos
  DROP CONSTRAINT IF EXISTS group_tx_memos_memo_group_id_key;

-- Indexes for fast lookups in both directions
CREATE INDEX IF NOT EXISTS idx_group_tx_memos_group_id
  ON public.group_tx_memos(group_id);

CREATE INDEX IF NOT EXISTS idx_group_tx_memos_memo_group_id
  ON public.group_tx_memos(memo_group_id);

CREATE INDEX IF NOT EXISTS idx_group_tx_memos_tx_hash
  ON public.group_tx_memos(tx_hash);

-- Enable RLS
ALTER TABLE public.group_tx_memos ENABLE ROW LEVEL SECURITY;

-- Anyone can read memo mappings (they are public identifiers)
DROP POLICY IF EXISTS "Anyone can view group tx memos"
  ON public.group_tx_memos;

CREATE POLICY "Anyone can view group tx memos"
  ON public.group_tx_memos FOR SELECT
  USING (true);

-- Only authenticated users (server-side) can insert
DROP POLICY IF EXISTS "Authenticated users can insert group tx memos"
  ON public.group_tx_memos;

CREATE POLICY "Authenticated users can insert group tx memos"
  ON public.group_tx_memos FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

COMMENT ON TABLE public.group_tx_memos IS
  'Lookup table mapping group IDs to Stellar transaction hashes via the memo field';
COMMENT ON COLUMN public.group_tx_memos.memo_group_id IS
  'The exact text stored in the Stellar transaction memo';
COMMENT ON COLUMN public.group_tx_memos.tx_hash IS
  'Stellar transaction hash that contains this memo';
