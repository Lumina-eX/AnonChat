-- Migration: Stellar Transaction Retry and Failure Recovery
-- Description: Tracks transaction attempts with idempotency keys, retry state, and failure recovery

create table if not exists public.stellar_transaction_attempts (
  id uuid primary key default gen_random_uuid(),
  -- Idempotency key: prevents duplicate on-chain submissions
  idempotency_key text not null unique,
  -- What we're submitting: 'metadata_hash' | 'audit_event'
  submission_type text not null check (submission_type in ('metadata_hash', 'audit_event')),
  -- Target group
  group_id text references public.rooms(id) on delete cascade,
  -- Optional audit event reference
  audit_event_id uuid,
  -- Payload hash for deduplication (same payload = same hash)
  payload_hash text not null,
  -- Current status
  status text not null check (status in ('pending', 'submitted', 'failed', 'duplicate', 'expired')),

  -- Stellar response tracking
  stellar_tx_hash text,
  stellar_memo text,
  fee_charged text,
  ledger bigint,

  -- Retry tracking
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  next_retry_at timestamptz,

  -- Error tracking
  last_error text,
  last_error_type text,
  last_error_code text,

  -- Timestamps
  submitted_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- Indexes for common queries
create index if not exists stellar_attempts_status_idx
  on public.stellar_transaction_attempts(status)
  where status in ('pending', 'failed');

create index if not exists stellar_attempts_retry_idx
  on public.stellar_transaction_attempts(next_retry_at)
  where status = 'failed' and attempt_count < max_attempts;

create index if not exists stellar_attempts_group_idx
  on public.stellar_transaction_attempts(group_id, created_at desc);

create index if not exists stellar_attempts_idempotency_idx
  on public.stellar_transaction_attempts(idempotency_key);

create index if not exists stellar_attempts_tx_hash_idx
  on public.stellar_transaction_attempts(stellar_tx_hash)
  where stellar_tx_hash is not null;

-- RLS policies
alter table public.stellar_transaction_attempts enable row level security;

create policy "Authenticated users can view transaction attempts"
  on public.stellar_transaction_attempts for select
  using (
    auth.uid() is not null
    and (
      group_id is null
      or exists (
        select 1 from public.rooms r
        where r.id = stellar_transaction_attempts.group_id
          and (r.is_private = false or r.created_by = auth.uid())
      )
      or exists (
        select 1 from public.room_members rm
        where rm.room_id = stellar_transaction_attempts.group_id
          and rm.user_id = auth.uid()
          and rm.removed_at is null
      )
    )
  );

create policy "Authenticated users can create transaction attempts"
  on public.stellar_transaction_attempts for insert
  with check (auth.uid() is not null);

create policy "Authenticated users can update transaction attempts"
  on public.stellar_transaction_attempts for update
  using (auth.uid() is not null);

-- Function to update the updated_at timestamp
create or replace function public.update_stellar_attempt_timestamp()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

create trigger update_stellar_attempts_updated_at
  before update on public.stellar_transaction_attempts
  for each row
  execute function public.update_stellar_attempt_timestamp();

comment on table public.stellar_transaction_attempts is
  'Tracks Stellar transaction submission attempts with idempotency, retry state, and failure recovery';
comment on column public.stellar_transaction_attempts.idempotency_key is
  'Deterministic key ensuring the same operation is not submitted twice';
comment on column public.stellar_transaction_attempts.payload_hash is
  'Hash of submission payload for detecting duplicate submissions';
comment on column public.stellar_transaction_attempts.next_retry_at is
  'Timestamp when the next retry should be attempted (exponential backoff)';
