-- Migration: User notification history
-- Description: Stores in-app notifications with read/unread and delivery status.
-- Date: 2026-06-23

CREATE TABLE IF NOT EXISTS public.notifications (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type             TEXT        NOT NULL CHECK (type IN ('group_added', 'ownership_transferred')),
  title            TEXT        NOT NULL,
  body             TEXT        NOT NULL,
  group_id         TEXT        NULL REFERENCES public.rooms(id) ON DELETE SET NULL,
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  read_at          TIMESTAMPTZ NULL,
  delivery_status  TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (delivery_status IN ('pending', 'delivered', 'failed')),
  delivery_error   TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON public.notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
  ON public.notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id)
  WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can insert notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

COMMENT ON TABLE public.notifications IS
  'In-app notification history for group events (joins, ownership transfers)';
COMMENT ON COLUMN public.notifications.delivery_status IS
  'Realtime WebSocket delivery status: pending, delivered, or failed';
COMMENT ON COLUMN public.notifications.read_at IS
  'Timestamp when the user marked the notification as read; NULL means unread';
