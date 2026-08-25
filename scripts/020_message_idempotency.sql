-- Migration: Add client_message_id for idempotent message deduplication
-- Each client generates a UUID before sending; the server rejects duplicates.

-- Add the client_message_id column (nullable so existing rows are unaffected)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS client_message_id text;

-- Enforce uniqueness at the DB level.
-- NULLS NOT DISTINCT (PostgreSQL ≥15) means two NULL values are considered equal
-- and would violate the constraint, but we intentionally keep NULLs allowed so
-- that legacy rows (without an ID) do not need to be backfilled.
-- For PostgreSQL < 15 we fall back to a partial unique index on non-null values.

-- Partial unique index: only rows that supply a client_message_id must be unique.
-- This is compatible with all supported Supabase/PostgreSQL versions.
CREATE UNIQUE INDEX IF NOT EXISTS messages_client_message_id_unique
  ON public.messages (client_message_id)
  WHERE client_message_id IS NOT NULL;

-- Index to speed up the duplicate-check SELECT before INSERT
CREATE INDEX IF NOT EXISTS messages_client_message_id_idx
  ON public.messages (client_message_id)
  WHERE client_message_id IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN public.messages.client_message_id IS
  'Client-generated UUID used to deduplicate retried message submissions.
   Clients MUST generate a fresh UUID per message (not per retry).
   NULL is allowed for legacy / system-generated messages.';
