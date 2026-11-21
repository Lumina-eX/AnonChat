-- Migration: Message Read Receipts
-- Description: Tracks when users read messages with timestamps for real-time read receipt support
-- Date: 2026-06-25

-- Create message_reads table to track read timestamps per message per user
CREATE TABLE IF NOT EXISTS public.message_reads (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id            UUID        NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at               TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(message_id, user_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_message_reads_message_id
  ON public.message_reads(message_id);

CREATE INDEX IF NOT EXISTS idx_message_reads_user_id
  ON public.message_reads(user_id);

CREATE INDEX IF NOT EXISTS idx_message_reads_read_at
  ON public.message_reads(read_at DESC);

-- Composite index for querying reads by room and user
CREATE INDEX IF NOT EXISTS idx_message_reads_message_user
  ON public.message_reads(message_id, user_id);

-- Enable RLS
ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;

-- Users can view read receipts for messages in rooms they are members of
CREATE POLICY "Users can view read receipts for accessible messages"
  ON public.message_reads FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      INNER JOIN public.room_members rm ON m.room_id = rm.room_id
      WHERE m.id = message_id
      AND rm.user_id = auth.uid()
      AND rm.removed_at IS NULL
    )
  );

-- Users can mark their own messages as read
CREATE POLICY "Users can mark messages as read by themselves"
  ON public.message_reads FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.messages m
      INNER JOIN public.room_members rm ON m.room_id = rm.room_id
      WHERE m.id = message_id
      AND rm.user_id = auth.uid()
      AND rm.removed_at IS NULL
    )
  );

-- Comments for documentation
COMMENT ON TABLE public.message_reads IS
  'Tracks when users read messages with timestamps for real-time read receipt support';

COMMENT ON COLUMN public.message_reads.message_id IS
  'Reference to the message that was read';

COMMENT ON COLUMN public.message_reads.user_id IS
  'User who read the message';

COMMENT ON COLUMN public.message_reads.read_at IS
  'Timestamp when the message was marked as read';

COMMENT ON COLUMN public.message_reads.created_at IS
  'Timestamp when the read receipt record was created';
