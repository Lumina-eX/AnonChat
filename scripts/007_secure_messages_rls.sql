-- Secure messages table: Only room members can read messages
-- Drop the temporary policy allowing anyone to read
DROP POLICY IF EXISTS "Users can view messages in rooms they're in" ON public.messages;

-- Recreate policy requiring the user exist in room_members actively
CREATE POLICY "Users can view messages in rooms they're in"
  ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.room_members rm
      WHERE rm.room_id = messages.room_id
        AND rm.user_id = auth.uid()
        AND rm.removed_at IS NULL
    )
  );
