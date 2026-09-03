-- Migration 020: Add client_message_id for idempotent message delivery
-- 
-- This column stores a client-generated UUID (or hash) that the client includes
-- with every outgoing message. The UNIQUE constraint on (user_id, client_message_id)
-- prevents duplicate rows even when the client retries the same message due to
-- network failures or WebSocket reconnections.
--
-- The partial index (WHERE client_message_id IS NOT NULL) keeps the constraint
-- lightweight for legacy rows that predate this migration.

-- Add the column; allow NULL for legacy messages that predate idempotency
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS client_message_id text;

-- Enforce uniqueness per user so two different users can use the same UUID
-- without conflict (each user owns their own UUID namespace).
-- The partial index only covers non-NULL values to stay compatible with old rows.
CREATE UNIQUE INDEX IF NOT EXISTS messages_user_client_message_id_uidx
  ON public.messages (user_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

-- Index to speed up the idempotency look-up query:
--   SELECT id FROM messages WHERE user_id = $1 AND client_message_id = $2
CREATE INDEX IF NOT EXISTS messages_client_message_id_idx
  ON public.messages (client_message_id)
  WHERE client_message_id IS NOT NULL;
