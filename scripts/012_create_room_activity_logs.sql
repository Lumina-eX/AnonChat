-- Room activity logs: store group/room events separately from chat messages
create table if not exists public.room_activity_logs (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  target_user_id uuid null references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.room_activity_logs enable row level security;

-- Read: only authenticated users (app already checks membership server-side).
create policy "Authenticated users can read room activity logs"
  on public.room_activity_logs
  for select
  using (auth.role() = 'authenticated');

-- Write: only authenticated users; server enforces membership / permissions.
create policy "Authenticated users can write room activity logs"
  on public.room_activity_logs
  for insert
  with check (auth.role() = 'authenticated');

create index if not exists room_activity_logs_room_id_created_at_idx
  on public.room_activity_logs(room_id, created_at desc);

