-- Migration 011: Group ↔ Transaction memo mapping table
-- Stores the mapping between group IDs and Stellar transaction IDs
-- for quick lookup and memo integrity validation.

create table if not exists public.group_tx_memo_map (
  id            uuid primary key default gen_random_uuid(),
  group_id      text not null references public.rooms(id) on delete cascade,
  tx_hash       text not null,
  memo_value    text not null,          -- the exact memo text stored on-chain (≤28 bytes)
  memo_type     text not null default 'text' check (memo_type in ('text', 'hash', 'id', 'return')),
  submitted_at  timestamp with time zone default timezone('utc', now()) not null,
  verified_at   timestamp with time zone,
  is_valid      boolean default false not null,
  created_by    uuid references auth.users(id) on delete set null,

  -- A group can have multiple transactions (e.g. updates), but each tx_hash is unique
  unique (tx_hash)
);

create index if not exists group_tx_memo_map_group_id_idx on public.group_tx_memo_map(group_id);
create index if not exists group_tx_memo_map_tx_hash_idx  on public.group_tx_memo_map(tx_hash);

alter table public.group_tx_memo_map enable row level security;

-- Authenticated users can read memo mappings for rooms they are members of
create policy "Members can view memo mappings"
  on public.group_tx_memo_map for select
  using (
    exists (
      select 1 from public.room_members rm
      where rm.room_id = group_tx_memo_map.group_id
        and rm.user_id = auth.uid()
        and rm.removed_at is null
    )
    or exists (
      select 1 from public.rooms r
      where r.id = group_tx_memo_map.group_id
        and r.is_private = false
    )
  );

-- Only service role can insert / update (done via API with service key)
create policy "Service role can manage memo mappings"
  on public.group_tx_memo_map for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
