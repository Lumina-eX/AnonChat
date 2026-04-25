-- Add status column to messages table
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS status text DEFAULT 'sent';

-- Create an index for faster status filtering if needed
CREATE INDEX IF NOT EXISTS messages_status_idx ON public.messages(status);

-- Update existing messages to 'sent' status if they don't have one
UPDATE public.messages SET status = 'sent' WHERE status IS NULL;
