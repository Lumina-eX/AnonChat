-- Migration: Add message_reads table for per-user read receipts
-- Run this against your Supabase project via the SQL editor or CLI

CREATE TABLE IF NOT EXISTS message_reads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  read_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

-- Enable Row Level Security
ALTER TABLE message_reads ENABLE ROW LEVEL SECURITY;

-- Policy: users can insert their own read receipts
CREATE POLICY "users_insert_own_reads"
  ON message_reads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: room members can view read receipts for messages in their rooms
CREATE POLICY "room_members_select_reads"
  ON message_reads FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      JOIN room_members rm ON rm.room_id = m.room_id
      WHERE m.id = message_reads.message_id
        AND rm.user_id = auth.uid()
        AND rm.removed_at IS NULL
    )
  );

-- Indexes for performant lookups
CREATE INDEX IF NOT EXISTS idx_message_reads_message_id ON message_reads(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_user_id ON message_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_message_user ON message_reads(message_id, user_id);
