-- Create groups table an  for managing group data
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_wallet text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table public.groups enable row level security;

-- Policies for groups table
create policy "Anyone can view groups"
  on public.groups for select
  using (true);

create policy "Authenticated users can create groups"
  on public.groups for insert
  with check (auth.role() = 'authenticated');

create policy "Group owners can update their groups"
  on public.groups for update
  using (auth.role() = 'authenticated');

create policy "Group owners can delete their groups"
  on public.groups for delete
  using (auth.role() = 'authenticated');

-- Create indexes
create index if not exists groups_owner_wallet_idx on public.groups(owner_wallet);
create index if not exists groups_created_at_idx on public.groups(created_at);
