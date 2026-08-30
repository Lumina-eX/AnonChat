-- Add reply_to_id column to messages table for reply-to-message functionality
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

-- Create an index for faster reply lookup
CREATE INDEX IF NOT EXISTS messages_reply_to_idx ON public.messages(reply_to_id);
