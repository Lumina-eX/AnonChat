-- Indexes and optional helper for group-level message statistics.
-- Supports efficient counts and daily/activity breakdowns without scanning content.

-- Composite index for room-scoped time-range aggregates (total, daily, active window)
CREATE INDEX IF NOT EXISTS messages_room_id_created_at_idx
  ON public.messages (room_id, created_at DESC);

-- Speeds distinct active-member lookups within a room/time window
CREATE INDEX IF NOT EXISTS messages_room_id_created_at_user_id_idx
  ON public.messages (room_id, created_at DESC, user_id)
  WHERE user_id IS NOT NULL;

-- Active room member counts for statistics.memberCount
CREATE INDEX IF NOT EXISTS room_members_room_id_active_idx
  ON public.room_members (room_id)
  WHERE removed_at IS NULL;
