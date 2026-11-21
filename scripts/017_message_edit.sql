-- Add edited_at column to messages table for edit tracking
alter table public.messages add column if not exists edited_at timestamp with time zone;

-- Update RLS policy to allow users to update their own messages (for editing)
drop policy if exists "Users can delete their own messages" on public.messages;
create policy "Users can update their own messages"
  on public.messages for update
  using (auth.uid() = user_id);

create policy "Users can delete their own messages"
  on public.messages for delete
  using (auth.uid() = user_id);