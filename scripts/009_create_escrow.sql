-- Migration: Escrow lifecycle table
-- Description: Stores escrow records managed by the EscrowService.
--              Each escrow is linked to a group and tracks its full lifecycle
--              from creation through funding, release, refund, or dispute.
-- Date: 2026-04-27

CREATE TABLE IF NOT EXISTS public.escrows (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id            TEXT        NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,

  -- Parties (Stellar public keys)
  depositor           TEXT        NOT NULL,
  beneficiary         TEXT        NOT NULL,
  arbitrator          TEXT,

  -- Conditions
  amount              TEXT        NOT NULL,          -- XLM amount as string
  asset               TEXT        NOT NULL DEFAULT 'XLM',
  expires_at          TIMESTAMPTZ,
  memo_value          TEXT,                          -- memo embedded in funding tx

  -- Lifecycle
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','funded','released','refunded','disputed','resolved')),
  funding_tx_hash     TEXT,
  settlement_tx_hash  TEXT,
  dispute_reason      TEXT,
  dispute_resolution  TEXT        CHECK (dispute_resolution IN ('release','refund','split') OR dispute_resolution IS NULL),
  beneficiary_share_percent INT   CHECK (beneficiary_share_percent BETWEEN 0 AND 100),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_escrows_group_id   ON public.escrows(group_id);
CREATE INDEX IF NOT EXISTS idx_escrows_depositor  ON public.escrows(depositor);
CREATE INDEX IF NOT EXISTS idx_escrows_beneficiary ON public.escrows(beneficiary);
CREATE INDEX IF NOT EXISTS idx_escrows_status     ON public.escrows(status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_escrow_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_escrows_updated_at ON public.escrows;
CREATE TRIGGER trg_escrows_updated_at
  BEFORE UPDATE ON public.escrows
  FOR EACH ROW EXECUTE FUNCTION public.set_escrow_updated_at();

-- Row Level Security
ALTER TABLE public.escrows ENABLE ROW LEVEL SECURITY;

-- Depositor and beneficiary can view their own escrows
CREATE POLICY "Parties can view their escrows"
  ON public.escrows FOR SELECT
  USING (
    depositor  = (SELECT wallet_address FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    OR
    beneficiary = (SELECT wallet_address FROM public.profiles WHERE id = auth.uid() LIMIT 1)
  );

-- Only service role may insert / update (all mutations go through the service layer)
CREATE POLICY "Service role can insert escrows"
  ON public.escrows FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can update escrows"
  ON public.escrows FOR UPDATE
  USING (auth.role() = 'service_role');

COMMENT ON TABLE public.escrows IS
  'Escrow lifecycle records managed by EscrowService. '
  'Blockchain interactions are abstracted away from controllers.';
