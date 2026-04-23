-- Encrypted file blob references: metadata + storage location scoped to rooms.
-- Clients receive opaque tokens from the API; raw storage paths are not exposed in list responses.

create table if not exists public.encrypted_file_references (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_bucket text not null,
  storage_object_path text not null,
  content_type text,
  size_bytes bigint,
  original_filename text,
  sha256_checksum text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (room_id, storage_bucket, storage_object_path)
);

create index if not exists encrypted_file_references_room_id_idx
  on public.encrypted_file_references(room_id);

create index if not exists encrypted_file_references_user_id_idx
  on public.encrypted_file_references(user_id);

alter table public.encrypted_file_references enable row level security;

create policy "Room members can view encrypted file references"
  on public.encrypted_file_references for select
  using (
    exists (
      select 1 from public.room_members rm
      where rm.room_id = encrypted_file_references.room_id
        and rm.user_id = auth.uid()
        and rm.removed_at is null
    )
  );

create policy "Room members can insert encrypted file references"
  on public.encrypted_file_references for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.room_members rm
      where rm.room_id = encrypted_file_references.room_id
        and rm.user_id = auth.uid()
        and rm.removed_at is null
    )
  );

create policy "Owners can delete encrypted file references"
  on public.encrypted_file_references for delete
  using (auth.uid() = user_id);
