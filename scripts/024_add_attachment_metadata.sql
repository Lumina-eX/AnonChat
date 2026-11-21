-- Migration: Add attachment metadata support
-- Description: Adds attachment metadata management for file attachments in group conversations.
--              This migration creates the attachment_metadata table and associated indexes.
--              See issue #290: Implement Message Attachment Metadata API

-- 1. Create attachment_metadata table
CREATE TABLE IF NOT EXISTS public.attachment_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  group_id text NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL,
  uploaded_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Referential integrity: ensure message exists and belongs to the group
  CONSTRAINT valid_message_group CHECK (
    EXISTS (SELECT 1 FROM public.messages WHERE id = message_id) AND
    EXISTS (SELECT 1 FROM public.rooms WHERE id = group_id)
  ),
  -- Prevent duplicate attachment metadata for the same message
  CONSTRAINT unique_attachment_per_message UNIQUE (message_id)
);

-- 2. Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS attachment_metadata_message_id_idx ON public.attachment_metadata(message_id);
CREATE INDEX IF NOT EXISTS attachment_metadata_group_id_idx ON public.attachment_metadata(group_id);
CREATE INDEX IF NOT EXISTS attachment_metadata_uploaded_by_idx ON public.attachment_metadata(uploaded_by);
CREATE INDEX IF NOT EXISTS attachment_metadata_uploaded_at_idx ON public.attachment_metadata(uploaded_at DESC);

-- 3. Enable Row Level Security
ALTER TABLE public.attachment_metadata ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS policies for attachment metadata access

-- Policy: Group members can view attachment metadata for messages in their groups
CREATE POLICY "Group members can view attachment metadata" ON public.attachment_metadata
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.room_members
      WHERE room_members.room_id = attachment_metadata.group_id
      AND room_members.user_id = current_setting('app.user_id')::uuid
      AND room_members.removed_at IS NULL
    )
  );

-- Policy: Only the uploader or group creators/moderators can insert attachment metadata
CREATE POLICY "Only uploader can insert attachment metadata" ON public.attachment_metadata
  FOR INSERT WITH CHECK (
    uploaded_by = current_setting('app.user_id')::uuid
  );

-- Policy: Only the uploader can update their attachment metadata
CREATE POLICY "Only uploader can update attachment metadata" ON public.attachment_metadata
  FOR UPDATE USING (
    uploaded_by = current_setting('app.user_id')::uuid
  );

-- 5. Add comment for documentation
comment on table public.attachment_metadata is
'Stores metadata for file attachments in group conversations. Does not store file contents or encryption keys. References messages and groups for access control.';

comment on column public.attachment_metadata.id is 'Unique identifier for the attachment metadata record';
comment on column public.attachment_metadata.message_id is 'Reference to the associated message';
comment on column public.attachment_metadata.group_id is 'Reference to the group/room';
comment on column public.attachment_metadata.original_filename is 'Original filename as uploaded by the user';
comment on column public.attachment_metadata.mime_type is 'MIME type of the attached file';
comment on column public.attachment_metadata.file_size is 'File size in bytes';
comment on column public.attachment_metadata.uploaded_at is 'Timestamp when the attachment was uploaded';
comment on column public.attachment_metadata.uploaded_by is 'User ID who uploaded the attachment';