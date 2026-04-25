-- Migration 012: Ephemeral message TTL support
-- Description: Adds TTL/expiry fields to messages and a per-room default TTL
--              to support automatic deletion of ephemeral messages.
-- Date: 2026-04-25

-- ─── messages table ──────────────────────────────────────────────────────────

-- Flag: is this message ephemeral (subject to TTL deletion)?
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_ephemeral BOOLEAN NOT NULL DEFAULT false;

-- Absolute expiry timestamp; NULL means the message never expires.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;

-- Partial index: only index ephemeral messages that have not yet expired.
-- The cleanup worker uses this index for efficient batch queries.
CREATE INDEX IF NOT EXISTS idx_messages_ephemeral_expires_at
  ON public.messages (expires_at)
  WHERE is_ephemeral = true AND expires_at IS NOT NULL;

COMMENT ON COLUMN public.messages.is_ephemeral IS
  'When true this message will be deleted by the cleanup worker once expires_at is reached';
COMMENT ON COLUMN public.messages.expires_at IS
  'UTC timestamp after which the message is eligible for deletion; NULL = never expires';

-- ─── rooms table ─────────────────────────────────────────────────────────────

-- Per-room default TTL in seconds.
-- NULL means the room inherits the system-wide default (EPHEMERAL_TTL_SECONDS env var).
-- 0 means messages in this room are never ephemeral by default.
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS default_ttl_seconds INTEGER NULL
  CONSTRAINT rooms_default_ttl_seconds_non_negative CHECK (default_ttl_seconds IS NULL OR default_ttl_seconds >= 0);

COMMENT ON COLUMN public.rooms.default_ttl_seconds IS
  'Default TTL in seconds for new messages in this room. NULL = inherit system default. 0 = non-ephemeral.';

-- ─── RLS: service role bypass ────────────────────────────────────────────────
-- The cleanup worker runs with the service role key and bypasses RLS by design.
-- No additional policy is needed; service_role already bypasses all RLS policies.

-- ─── Helper function: mark_message_ephemeral ─────────────────────────────────
-- Convenience function callable from the API layer to set expiry on a message.
CREATE OR REPLACE FUNCTION public.mark_message_ephemeral(
  p_message_id UUID,
  p_ttl_seconds INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RAISE EXCEPTION 'p_ttl_seconds must be a positive integer';
  END IF;

  UPDATE public.messages
  SET
    is_ephemeral = true,
    expires_at   = timezone('utc', now()) + (p_ttl_seconds * INTERVAL '1 second')
  WHERE id = p_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_message_ephemeral(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_message_ephemeral(UUID, INTEGER) TO service_role;
