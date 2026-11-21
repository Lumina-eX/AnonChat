-- Create invites table for room invite codes
create table if not exists public.invites (
  code text primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamp with time zone,
  max_uses integer,
  use_count integer not null default 0,
  is_active boolean not null default true,
  deactivated_at timestamp with time zone,
  deactivation_reason text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.invites enable row level security;

create policy "Anyone can view invites for rooms they create"
  on public.invites for select
  using (created_by = auth.uid());

create policy "Users can insert invites when they are the creator"
  on public.invites for insert
  with check (created_by = auth.uid());
