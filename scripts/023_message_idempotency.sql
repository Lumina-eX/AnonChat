-- Migration: Message Idempotency
-- Description: Adds an idempotency_key column to the messages table so that
--              client-generated UUIDs prevent duplicate storage on network
--              retries or WebSocket reconnections.
--
-- Usage:
--   - Clients generate a UUID (v4) before sending a message.
--   - The key is included in the POST /api/messages body or the
--     WebSocket send_message payload.
--   - The server checks for an existing row with that key before
--     inserting; on a match it returns the existing message instead
--     of creating a new one.
--   - The UNIQUE constraint is the last line of defence against
--     concurrent duplicate submissions (race conditions).

-- 1. Add the column (nullable so existing rows are unaffected)
alter table public.messages
  add column if not exists idempotency_key uuid;

-- 2. Unique constraint — enforces exactly-once storage at the DB level.
--    NULLS are NOT DISTINCT so two NULLs would violate the constraint;
--    we use a partial index instead so legacy rows without a key are ignored.
create unique index if not exists messages_idempotency_key_uidx
  on public.messages (idempotency_key)
  where idempotency_key is not null;

-- 3. Regular index for fast duplicate lookups (SELECT before INSERT path)
create index if not exists messages_idempotency_key_idx
  on public.messages (idempotency_key)
  where idempotency_key is not null;

-- 4. Column comment for documentation
comment on column public.messages.idempotency_key is
  'Client-generated UUID that uniquely identifies a send attempt. '
  'Allows the server to detect and short-circuit duplicate submissions '
  'caused by network retries or WebSocket reconnections, returning the '
  'already-stored message instead of inserting a duplicate.';
