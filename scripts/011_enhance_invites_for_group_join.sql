-- Enhance invites table for group join via invite code (issue #111)
-- Adds usage-based expiration support and required RLS policies

alter table public.invites
  add column if not exists max_uses integer,
  add column if not exists use_count integer not null default 0;

-- Allow any authenticated user to read an invite by code (needed for join validation)
create policy "Authenticated users can read invites by code"
  on public.invites for select
  using (auth.role() = 'authenticated');

-- Allow server to increment use_count on join
create policy "Authenticated users can update invite use_count"
  on public.invites for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create index if not exists invites_room_id_idx on public.invites(room_id);
create index if not exists invites_created_by_idx on public.invites(created_by);

-- Atomic increment function to safely track invite usage without race conditions
create or replace function public.increment_invite_use_count(invite_code text)
returns void
language sql
security definer
as $$
  update public.invites
  set use_count = use_count + 1
  where code = invite_code;
$$;
