-- Message context menu support: replies, reactions, and reports.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_reply_to_id_idx
  ON public.messages(reply_to_id);

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (emoji IN ('👍', '❤️', '😂', '😮', '😢', '🎉')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS message_reactions_message_id_idx
  ON public.message_reactions(message_id);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view reactions for accessible messages"
  ON public.message_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.messages m
      JOIN public.room_members rm ON rm.room_id = m.room_id
      WHERE m.id = message_reactions.message_id
        AND rm.user_id = auth.uid()
        AND rm.removed_at IS NULL
    )
  );

CREATE POLICY "Members can add their own reactions"
  ON public.message_reactions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.messages m
      JOIN public.room_members rm ON rm.room_id = m.room_id
      WHERE m.id = message_reactions.message_id
        AND rm.user_id = auth.uid()
        AND rm.removed_at IS NULL
    )
  );

CREATE POLICY "Users can remove their own reactions"
  ON public.message_reactions FOR DELETE
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.message_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  reporter_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(message_id, reporter_user_id)
);

CREATE INDEX IF NOT EXISTS message_reports_message_id_idx
  ON public.message_reports(message_id);

ALTER TABLE public.message_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can report accessible messages"
  ON public.message_reports FOR INSERT
  WITH CHECK (
    auth.uid() = reporter_user_id
    AND EXISTS (
      SELECT 1
      FROM public.messages m
      JOIN public.room_members rm ON rm.room_id = m.room_id
      WHERE m.id = message_reports.message_id
        AND rm.user_id = auth.uid()
        AND rm.removed_at IS NULL
    )
  );

CREATE POLICY "Users can view their own message reports"
  ON public.message_reports FOR SELECT
  USING (auth.uid() = reporter_user_id);

COMMENT ON COLUMN public.messages.reply_to_id IS
  'Optional message being quoted as the reply target';
COMMENT ON TABLE public.message_reactions IS
  'Emoji reactions attached to chat messages';
COMMENT ON TABLE public.message_reports IS
  'Reports submitted by members for messages in rooms they can access';
