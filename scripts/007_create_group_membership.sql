-- Create group_membership table for tracking wallet-based group membership
create table if not exists public.group_membership (
  id uuid primary key default gen_random_uuid(),
  group_id text not null references public.rooms(id) on delete cascade,
  wallet_address text not null,
  joined_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (group_id, wallet_address)
);

alter table public.group_membership enable row level security;

create policy "Anyone can view group memberships"
  on public.group_membership for select
  using (true);

create policy "Authenticated users can insert group membership"
  on public.group_membership for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated users can delete group membership"
  on public.group_membership for delete
  using (auth.role() = 'authenticated');

create index if not exists group_membership_group_id_idx on public.group_membership(group_id);
create index if not exists group_membership_wallet_address_idx on public.group_membership(wallet_address);
