-- Migration: 020_transaction_audit_verifications
-- Description: Richer transaction audit verification table for the AnonChat audit
--              verification service. Supersedes the basic
--              stellar_transaction_verifications table (015) with additional columns
--              for network identity, ledger metadata, operation details, retry tracking,
--              and diagnostic information.
--
-- Table: transaction_audit_verifications
-- Key design decisions:
--   - (transaction_hash, expected_action) is a unique key — idempotent upsert target.
--   - status is an enum restricted to the five verification states.
--   - diagnostic_details is JSONB for flexible, structured error context.
--   - retry_count tracks how many Horizon retries were needed.
--   - Append-only intent: rows are only updated when the new state is more definitive.

-- ── Status enum ───────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'audit_verification_status') then
    create type public.audit_verification_status as enum (
      'pending',
      'successful',
      'failed',
      'unverifiable',
      'invalid'
    );
  end if;
end$$;

-- ── AnonChat action enum ──────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'anonchat_action') then
    create type public.anonchat_action as enum (
      'group_creation',
      'group_join',
      'group_leave',
      'member_removal',
      'wallet_auth',
      'ownership_transfer',
      'audit_event'
    );
  end if;
end$$;

-- ── Main table ────────────────────────────────────────────────────────────────

create table if not exists public.transaction_audit_verifications (
  id                  uuid        primary key default gen_random_uuid(),

  -- Core transaction identity
  transaction_hash    text        not null,
  network_identifier  text        not null
                        check (network_identifier in ('testnet', 'mainnet', 'unknown')),

  -- Ledger metadata (populated on successful Horizon retrieval)
  ledger              bigint,
  ledger_close_time   timestamptz,

  -- Sender information
  source_account      text,

  -- Operation details
  operation_count     integer,
  operation_type      text,

  -- AnonChat action this transaction is expected to authorise
  expected_action     public.anonchat_action not null,

  -- Application context
  group_id            text
                        references public.rooms(id) on delete set null,

  -- Verification outcome
  status              public.audit_verification_status not null default 'pending',
  verified            boolean     not null default false,

  -- Reliability tracking
  retry_count         integer     not null default 0,

  -- Error information (null on success)
  error_message       text,
  diagnostic_details  jsonb,

  -- Timestamps
  verified_at         timestamptz not null default timezone('utc', now()),
  created_at          timestamptz not null default timezone('utc', now()),
  updated_at          timestamptz not null default timezone('utc', now())
);

-- ── Unique constraint (idempotency key) ───────────────────────────────────────

alter table public.transaction_audit_verifications
  add constraint transaction_audit_verifications_hash_action_key
  unique (transaction_hash, expected_action);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Fast lookup by transaction hash (most common query pattern)
create index if not exists txav_transaction_hash_idx
  on public.transaction_audit_verifications (transaction_hash);

-- Status filter — useful for admin dashboards and retry workers
create index if not exists txav_status_idx
  on public.transaction_audit_verifications (status)
  where status != 'successful';

-- Group context — used by room verification queries
create index if not exists txav_group_id_verified_at_idx
  on public.transaction_audit_verifications (group_id, verified_at desc)
  where group_id is not null;

-- Pending / unverifiable records — allows a worker to pick up stale verifications
create index if not exists txav_pending_created_at_idx
  on public.transaction_audit_verifications (created_at asc)
  where status in ('pending', 'unverifiable');

-- ── updated_at trigger ────────────────────────────────────────────────────────

create or replace function public.set_txav_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists txav_set_updated_at on public.transaction_audit_verifications;

create trigger txav_set_updated_at
  before update on public.transaction_audit_verifications
  for each row
  execute function public.set_txav_updated_at();

-- ── Row-level security ────────────────────────────────────────────────────────

alter table public.transaction_audit_verifications enable row level security;

-- Service-role (admin) has full access — bypasses RLS automatically.

-- Authenticated users may view records for groups they can access.
create policy "txav_select_authenticated"
  on public.transaction_audit_verifications for select
  using (
    auth.uid() is not null
    and (
      group_id is null
      or exists (
        select 1 from public.rooms r
        where r.id = transaction_audit_verifications.group_id
          and (
            r.is_private = false
            or r.created_by = auth.uid()
            or exists (
              select 1 from public.room_members rm
              where rm.room_id = r.id
                and rm.user_id = auth.uid()
                and rm.removed_at is null
            )
          )
      )
    )
  );

-- Authenticated users may create new verification records.
create policy "txav_insert_authenticated"
  on public.transaction_audit_verifications for insert
  with check (auth.uid() is not null);

-- Only service-role may update verification records (promotes state via admin client).
-- No explicit UPDATE policy for anon/authenticated — the service role bypasses RLS.

-- ── Table and column comments ─────────────────────────────────────────────────

comment on table public.transaction_audit_verifications is
  'Idempotent audit log of Stellar transaction verification outcomes for AnonChat actions. '
  'Each (transaction_hash, expected_action) pair has at most one row. '
  'State transitions only move toward more definitive outcomes (pending → successful/failed/unverifiable).';

comment on column public.transaction_audit_verifications.network_identifier is
  'Stellar network the transaction was verified against: testnet or mainnet. '
  'Cross-network transactions are rejected and stored with status=failed.';

comment on column public.transaction_audit_verifications.ledger_close_time is
  'ISO-8601 timestamp when the ledger containing this transaction was closed on the Stellar network.';

comment on column public.transaction_audit_verifications.expected_action is
  'AnonChat application action this transaction is expected to authorise. '
  'Verification confirms both on-chain success and operation compatibility.';

comment on column public.transaction_audit_verifications.retry_count is
  'Number of Horizon request retries that were needed to retrieve the transaction. '
  'High values may indicate Horizon instability during verification.';

comment on column public.transaction_audit_verifications.diagnostic_details is
  'JSONB object with structured diagnostic context for failed or unverifiable records. '
  'Must not contain credentials, private keys, or user message content.';

comment on column public.transaction_audit_verifications.verified is
  'True only when status = successful AND the transaction matches the expected AnonChat action. '
  'Never set to true for unverifiable or pending outcomes.';
