-- Add soft delete support to messages (Issue #217)
alter table public.messages add column if not exists deleted boolean not null default false;
alter table public.messages add column if not exists deleted_at timestamp with time zone;

-- Backward compatible: existing rows get deleted = false automatically, no data loss

-- Speed up "exclude deleted messages" queries per room
create index if not exists idx_messages_room_deleted
  on public.messages (room_id, deleted, created_at);

-- Users can already UPDATE their own messages (see 017_message_edit.sql).
-- Soft delete reuses that same policy — no new RLS policy is needed for delete,
-- since we're setting deleted=true via UPDATE, not using SQL DELETE.