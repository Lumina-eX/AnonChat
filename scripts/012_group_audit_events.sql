-- Migration: Add group audit event mapping for on-chain audit trail
-- Description: Stores eventId/eventType/transactionHash mappings and related metadata.

create table if not exists public.group_audit_events (
  event_id uuid primary key default gen_random_uuid(),
  group_id text not null references public.rooms(id) on delete cascade,
  event_type text not null check (
    event_type in ('group_created', 'member_joined', 'member_left', 'member_removed')
  ),
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  transaction_hash text,
  stellar_memo text,
  metadata_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'failed')),
  error_message text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  submitted_at timestamptz
);

create index if not exists group_audit_events_group_created_idx
  on public.group_audit_events(group_id, created_at desc);

create index if not exists group_audit_events_type_idx
  on public.group_audit_events(event_type);

create index if not exists group_audit_events_tx_hash_idx
  on public.group_audit_events(transaction_hash)
  where transaction_hash is not null;

drop index if exists public.group_audit_events_stellar_memo_idx;

create index if not exists group_audit_events_stellar_memo_idx
  on public.group_audit_events(stellar_memo)
  where stellar_memo is not null;

alter table public.group_audit_events enable row level security;

drop policy if exists "Users can leave rooms" on public.room_members;
create policy "Users can leave rooms"
  on public.room_members for delete
  using (auth.uid() = user_id);

create policy "Authenticated users can view group audit events"
  on public.group_audit_events for select
  using (
    auth.uid() is not null
    and (
      exists (
        select 1 from public.rooms r
        where r.id = group_audit_events.group_id
          and (r.is_private = false or r.created_by = auth.uid())
      )
      or exists (
        select 1 from public.room_members rm
        where rm.room_id = group_audit_events.group_id
          and rm.user_id = auth.uid()
          and rm.removed_at is null
      )
    )
  );

create policy "Authenticated actors can create audit events"
  on public.group_audit_events for insert
  with check (auth.uid() = actor_user_id);

create policy "Authenticated actors can update their audit events"
  on public.group_audit_events for update
  using (auth.uid() = actor_user_id)
  with check (auth.uid() = actor_user_id);

comment on table public.group_audit_events is
  'On-chain audit trail mapping group events to Stellar transaction hashes';
comment on column public.group_audit_events.event_id is
  'Stable audit event identifier stored with the on-chain audit record';
comment on column public.group_audit_events.transaction_hash is
  'Stellar transaction hash for the on-chain audit marker';
comment on column public.group_audit_events.stellar_memo is
  'Compact Stellar memo containing the group identifier';
