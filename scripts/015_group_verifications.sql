-- Migration: Group on-chain verification records
-- Description: Stores group ↔ wallet verification results synced from Stellar checks.
-- Date: 2026-06-23

CREATE TABLE IF NOT EXISTS public.group_verifications (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                  TEXT        NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  wallet_address            TEXT        NOT NULL,
  tx_hash                   TEXT        NULL,
  verified                  BOOLEAN     NOT NULL DEFAULT false,
  memo_verified             BOOLEAN     NOT NULL DEFAULT false,
  wallet_ownership_verified BOOLEAN     NOT NULL DEFAULT false,
  metadata_hash             TEXT        NULL,
  verification_error        TEXT        NULL,
  verified_at               TIMESTAMPTZ NULL,
  last_checked_at           TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (group_id)
);

CREATE INDEX IF NOT EXISTS idx_group_verifications_group_id
  ON public.group_verifications(group_id);

CREATE INDEX IF NOT EXISTS idx_group_verifications_wallet_address
  ON public.group_verifications(wallet_address);

CREATE INDEX IF NOT EXISTS idx_group_verifications_verified
  ON public.group_verifications(verified)
  WHERE verified = true;

ALTER TABLE public.group_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view group verifications"
  ON public.group_verifications FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert group verifications"
  ON public.group_verifications FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update group verifications"
  ON public.group_verifications FOR UPDATE
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE public.group_verifications IS
  'On-chain verification records mapping groups to owner wallets via Stellar transaction checks';
COMMENT ON COLUMN public.group_verifications.wallet_address IS
  'Stellar wallet address that owns the group at verification time';
COMMENT ON COLUMN public.group_verifications.verification_error IS
  'Human-readable reason when verification failed; null when verified';
