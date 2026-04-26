-- Migration 012: Escrow lifecycle tables
-- Supports create / fund / release / refund / dispute operations.

-- ── Escrow accounts ──────────────────────────────────────────────────────────
create table if not exists public.escrows (
  id                  uuid primary key default gen_random_uuid(),
  group_id            text not null references public.rooms(id) on delete restrict,
  initiator_wallet    text not null,          -- Stellar public key of the creator
  beneficiary_wallet  text not null,          -- Stellar public key of the recipient
  amount_xlm         numeric(20, 7) not null check (amount_xlm > 0),
  asset_code         text not null default 'XLM',
  asset_issuer       text,                    -- null for native XLM
  status             text not null default 'pending'
                       check (status in ('pending','funded','released','refunded','disputed','resolved')),
  memo_group_id      text,                    -- group ID embedded in the Stellar memo
  fund_tx_hash       text,                    -- Stellar tx that funded the escrow
  release_tx_hash    text,                    -- Stellar tx that released funds
  refund_tx_hash     text,                    -- Stellar tx that refunded funds
  dispute_reason     text,
  resolved_by        uuid references auth.users(id) on delete set null,
  created_at         timestamp with time zone default timezone('utc', now()) not null,
  funded_at          timestamp with time zone,
  released_at        timestamp with time zone,
  refunded_at        timestamp with time zone,
  disputed_at        timestamp with time zone,
  resolved_at        timestamp with time zone,
  expires_at         timestamp with time zone  -- optional expiry for auto-refund
);

create index if not exists escrows_group_id_idx         on public.escrows(group_id);
create index if not exists escrows_initiator_wallet_idx on public.escrows(initiator_wallet);
create index if not exists escrows_status_idx           on public.escrows(status);

alter table public.escrows enable row level security;

-- Participants (initiator or beneficiary profile) can view their escrows
create policy "Participants can view escrows"
  on public.escrows for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.wallet_address = escrows.initiator_wallet
             or p.wallet_address = escrows.beneficiary_wallet)
    )
  );

-- Service role manages all escrow operations
create policy "Service role manages escrows"
  on public.escrows for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── Escrow event log ─────────────────────────────────────────────────────────
create table if not exists public.escrow_events (
  id          uuid primary key default gen_random_uuid(),
  escrow_id   uuid not null references public.escrows(id) on delete cascade,
  event_type  text not null
                check (event_type in ('created','funded','released','refunded','disputed','resolved','error')),
  tx_hash     text,
  actor_wallet text,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamp with time zone default timezone('utc', now()) not null
);

create index if not exists escrow_events_escrow_id_idx on public.escrow_events(escrow_id);

alter table public.escrow_events enable row level security;

create policy "Participants can view escrow events"
  on public.escrow_events for select
  using (
    exists (
      select 1 from public.escrows e
      join public.profiles p on p.id = auth.uid()
      where e.id = escrow_events.escrow_id
        and (p.wallet_address = e.initiator_wallet
             or p.wallet_address = e.beneficiary_wallet)
    )
  );

create policy "Service role manages escrow events"
  on public.escrow_events for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
