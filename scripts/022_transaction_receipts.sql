-- Migration: Standardized Stellar transaction receipts
-- Description: Stores one lifecycle record per Stellar transaction and its AnonChat operation.

create table if not exists public.transaction_receipts (
  id uuid primary key default gen_random_uuid(),
  transaction_hash varchar(64) not null unique,
  operation_id varchar(64) not null,
  ledger_sequence bigint,
  block_timestamp timestamptz,
  confirmed_at timestamptz,
  status varchar(20) not null default 'pending'
    check (status in ('pending', 'confirmed', 'failed')),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists transaction_receipts_operation_idx
  on public.transaction_receipts(operation_id, created_at desc);

create index if not exists transaction_receipts_status_idx
  on public.transaction_receipts(status, updated_at desc);

create table if not exists public.transaction_receipt_events (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.transaction_receipts(id) on delete cascade,
  status varchar(20) not null check (status in ('pending', 'confirmed', 'failed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists transaction_receipt_events_receipt_idx
  on public.transaction_receipt_events(receipt_id, created_at desc);

alter table public.transaction_receipts enable row level security;
alter table public.transaction_receipt_events enable row level security;

create policy "Authenticated users can view transaction receipts"
  on public.transaction_receipts for select
  using (auth.uid() is not null);

create policy "Authenticated users can create transaction receipts"
  on public.transaction_receipts for insert
  with check (auth.uid() is not null);

create policy "Authenticated users can update transaction receipts"
  on public.transaction_receipts for update
  using (auth.uid() is not null);

create policy "Authenticated users can view receipt events"
  on public.transaction_receipt_events for select
  using (auth.uid() is not null);

create policy "Authenticated users can create receipt events"
  on public.transaction_receipt_events for insert
  with check (auth.uid() is not null);

create or replace function public.update_transaction_receipt_timestamp()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_transaction_receipts_updated_at on public.transaction_receipts;
create trigger update_transaction_receipts_updated_at
  before update on public.transaction_receipts
  for each row execute function public.update_transaction_receipt_timestamp();

comment on table public.transaction_receipts is
  'Canonical lifecycle receipt for each Stellar transaction submitted by AnonChat';
comment on table public.transaction_receipt_events is
  'Append-only lifecycle audit events for transaction receipts';