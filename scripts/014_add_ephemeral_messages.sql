-- Add ephemeral message support to messages table
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_ephemeral boolean DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone;

-- Create an index for efficient cleanup queries
CREATE INDEX IF NOT EXISTS messages_expires_at_idx ON public.messages(expires_at) 
  WHERE is_ephemeral = true AND expires_at IS NOT NULL;

-- Create an index for room + expiry queries to help with room-specific cleanup
CREATE INDEX IF NOT EXISTS messages_room_expires_at_idx ON public.messages(room_id, expires_at) 
  WHERE is_ephemeral = true AND expires_at IS NOT NULL;

-- Create ephemeral message TTL configuration table
CREATE TABLE IF NOT EXISTS public.ephemeral_message_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL UNIQUE REFERENCES public.rooms(id) ON DELETE CASCADE,
  ttl_seconds bigint NOT NULL DEFAULT 86400, -- 24 hours default
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.ephemeral_message_config ENABLE ROW LEVEL SECURITY;

-- Create a table to log deleted ephemeral messages for audit trail
CREATE TABLE IF NOT EXISTS public.ephemeral_message_cleanup_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_message_id uuid NOT NULL,
  room_id text NOT NULL,
  deleted_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamp with time zone,
  reason text -- 'expired', 'manual_delete', 'room_cleanup', etc.
);

-- Create an index on deleted_at for audit queries
CREATE INDEX IF NOT EXISTS ephemeral_cleanup_logs_deleted_at_idx ON public.ephemeral_message_cleanup_logs(deleted_at DESC);
CREATE INDEX IF NOT EXISTS ephemeral_cleanup_logs_room_id_idx ON public.ephemeral_message_cleanup_logs(room_id);

-- Global TTL configuration (system-wide default)
CREATE TABLE IF NOT EXISTS public.global_ephemeral_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ttl_seconds bigint NOT NULL DEFAULT 86400, -- 24 hours default
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Ensure only one global config exists
CREATE UNIQUE INDEX IF NOT EXISTS global_ephemeral_config_singleton ON public.global_ephemeral_config ((1));

-- Insert default global config if not exists
INSERT INTO public.global_ephemeral_config (ttl_seconds) 
VALUES (86400)  -- 24 hours
ON CONFLICT DO NOTHING;
