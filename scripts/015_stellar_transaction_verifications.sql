-- Migration: Store Stellar transaction verification results
-- Description: Records transaction verification outcomes before group actions are persisted.

create table if not exists public.stellar_transaction_verifications (
  id uuid primary key default gen_random_uuid(),
  transaction_hash text,
  group_action_event_id uuid,
  group_id text references public.rooms(id) on delete cascade,
  status text not null check (status in ('successful', 'failed', 'pending', 'invalid', 'unverifiable')),
  -- Idempotency guard: at most one verification record per (transaction, intended action).
  -- Note: unique index is created below after columns are ensured.
  verified boolean not null default false,
  ledger bigint,
  memo text,
  error_message text,
  network text,
  ledger_close_time timestamptz,
  transaction_result text,
  validation_details jsonb,
  verified_at timestamptz not null default timezone('utc'::text, now()),
  created_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.stellar_transaction_verifications
  add column if not exists network text,
  add column if not exists ledger_close_time timestamptz,
  add column if not exists transaction_result text,
  add column if not exists validation_details jsonb;

-- Relax the status constraint to include the new 'unverifiable' state.
alter table public.stellar_transaction_verifications
  drop constraint if exists stellar_transaction_verifications_status_check;

alter table public.stellar_transaction_verifications
  add constraint stellar_transaction_verifications_status_check
  check (status in ('successful', 'failed', 'pending', 'invalid', 'unverifiable'));

create index if not exists stellar_transaction_verifications_tx_hash_idx
  on public.stellar_transaction_verifications(transaction_hash)
  where transaction_hash is not null;

create index if not exists stellar_transaction_verifications_group_action_idx
  on public.stellar_transaction_verifications(group_action_event_id)
  where group_action_event_id is not null;

create index if not exists stellar_transaction_verifications_group_idx
  on public.stellar_transaction_verifications(group_id, verified_at desc)
  where group_id is not null;

-- Idempotency guard: at most one verification record per (transaction, intended action).
create unique index if not exists stellar_transaction_verifications_idempotent_idx
  on public.stellar_transaction_verifications (transaction_hash, coalesce(group_action_event_id::text, ''));

alter table public.stellar_transaction_verifications enable row level security;

drop policy if exists "Authenticated users can view Stellar transaction verifications"
  on public.stellar_transaction_verifications;
drop policy if exists "Authenticated users can create Stellar transaction verifications"
  on public.stellar_transaction_verifications;

create policy "Authenticated users can view Stellar transaction verifications"
  on public.stellar_transaction_verifications for select
  using (
    auth.uid() is not null
    and (
      group_id is null
      or exists (
        select 1 from public.rooms r
        where r.id = stellar_transaction_verifications.group_id
          and (r.is_private = false or r.created_by = auth.uid())
      )
      or exists (
        select 1 from public.room_members rm
        where rm.room_id = stellar_transaction_verifications.group_id
          and rm.user_id = auth.uid()
          and rm.removed_at is null
      )
    )
  );

create policy "Authenticated users can create Stellar transaction verifications"
  on public.stellar_transaction_verifications for insert
  with check (auth.uid() is not null);

comment on table public.stellar_transaction_verifications is
  'Verification outcomes for Stellar transactions before group actions are recorded';
comment on column public.stellar_transaction_verifications.group_action_event_id is
  'Group action event identifier that the Stellar transaction is expected to authorize';
comment on column public.stellar_transaction_verifications.verified is
  'True only when the Stellar transaction is confirmed successful and matches expected action metadata';
comment on column public.stellar_transaction_verifications.network is
  'Stellar network (testnet or mainnet) the transaction was verified against';
comment on column public.stellar_transaction_verifications.validation_details is
  'Structured operation validation details for auditing and troubleshooting';
