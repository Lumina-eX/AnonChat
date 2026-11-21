-- Migration 018: Multi-Signature Group Ownership Support
-- Adds multi-owner configuration and approval-based workflows for sensitive
-- group actions (deletion, ownership transfer, member removal, invite reset).

-- ── 1. Multi-sig owner registry ───────────────────────────────────────────────
-- Stores the set of wallet addresses that co-own a group. The PRIMARY owner
-- (rooms.created_by / rooms.owner_wallet) must be included here when multisig
-- is first enabled so approval quorum counts are computed correctly.
create table if not exists public.group_multisig_owners (
  id              uuid primary key default gen_random_uuid(),
  group_id        text not null references public.rooms(id) on delete cascade,
  wallet_address  text not null,
  user_id         uuid references auth.users(id) on delete set null,
  added_by        uuid references auth.users(id) on delete set null,
  added_at        timestamptz not null default timezone('utc', now()),
  removed_at      timestamptz,
  -- Threshold: how many owner signatures required for sensitive actions.
  -- Stored per-group and updated when owners are added/removed.
  -- Only one active threshold row is maintained per group (updated in place).
  constraint group_multisig_owners_wallet_per_group
    unique (group_id, wallet_address)
);

alter table public.group_multisig_owners enable row level security;

create index if not exists group_multisig_owners_group_idx
  on public.group_multisig_owners(group_id)
  where removed_at is null;

create index if not exists group_multisig_owners_user_idx
  on public.group_multisig_owners(user_id)
  where removed_at is null;

-- ── 2. Multi-sig config per group ─────────────────────────────────────────────
create table if not exists public.group_multisig_config (
  group_id          text primary key references public.rooms(id) on delete cascade,
  required_approvals int  not null default 2 check (required_approvals >= 1),
  enabled           boolean not null default true,
  created_at        timestamptz not null default timezone('utc', now()),
  updated_at        timestamptz not null default timezone('utc', now())
);

alter table public.group_multisig_config enable row level security;

-- ── 3. Approval proposals ─────────────────────────────────────────────────────
-- When a multisig-enabled group needs to perform a sensitive action, an owner
-- opens a proposal. Other owners then sign and submit approvals against it.
create table if not exists public.multisig_proposals (
  id              uuid primary key default gen_random_uuid(),
  group_id        text not null references public.rooms(id) on delete cascade,
  action_type     text not null check (
    action_type in ('delete_group', 'transfer_ownership', 'remove_member', 'regenerate_invite', 'update_multisig_owners')
  ),
  -- JSON payload describing the proposed action (e.g. new_owner_wallet for transfer).
  action_payload  jsonb not null default '{}'::jsonb,
  proposed_by     uuid not null references auth.users(id) on delete cascade,
  proposer_wallet text not null,
  -- Signature over the canonical proposal hash by the proposer (counts as first approval).
  proposer_signature text not null,
  signed_nonce    text not null,
  status          text not null default 'pending' check (
    status in ('pending', 'approved', 'executed', 'rejected', 'expired')
  ),
  required_approvals int not null,
  expires_at      timestamptz not null default (timezone('utc', now()) + interval '24 hours'),
  executed_at     timestamptz,
  created_at      timestamptz not null default timezone('utc', now())
);

alter table public.multisig_proposals enable row level security;

create index if not exists multisig_proposals_group_status_idx
  on public.multisig_proposals(group_id, status);

create index if not exists multisig_proposals_proposed_by_idx
  on public.multisig_proposals(proposed_by);

create index if not exists multisig_proposals_expires_at_idx
  on public.multisig_proposals(expires_at)
  where status = 'pending';

-- ── 4. Individual approvals ────────────────────────────────────────────────────
-- Each co-owner signs the proposal hash to cast their approval.
create table if not exists public.multisig_approvals (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid not null references public.multisig_proposals(id) on delete cascade,
  group_id        text not null references public.rooms(id) on delete cascade,
  approver_user_id uuid not null references auth.users(id) on delete cascade,
  approver_wallet text not null,
  -- Ed25519 signature over the proposal_id (as hex bytes of the proposal hash).
  signature       text not null,
  signed_nonce    text not null,
  approved_at     timestamptz not null default timezone('utc', now()),
  -- One approval per owner per proposal
  constraint multisig_approvals_unique_per_proposal
    unique (proposal_id, approver_user_id)
);

alter table public.multisig_approvals enable row level security;

create index if not exists multisig_approvals_proposal_idx
  on public.multisig_approvals(proposal_id);

create index if not exists multisig_approvals_group_idx
  on public.multisig_approvals(group_id);

-- ── 5. RLS Policies ───────────────────────────────────────────────────────────

-- group_multisig_owners: visible to all group members, editable only via service role RPCs
create policy "Group members can view multisig owners"
  on public.group_multisig_owners for select
  using (
    auth.uid() is not null
    and (
      exists (
        select 1 from public.room_members rm
        where rm.room_id = group_multisig_owners.group_id
          and rm.user_id = auth.uid()
          and rm.removed_at is null
      )
      or exists (
        select 1 from public.rooms r
        where r.id = group_multisig_owners.group_id
          and r.created_by = auth.uid()
      )
    )
  );

create policy "Service role can manage multisig owners"
  on public.group_multisig_owners for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- group_multisig_config: visible to group members
create policy "Group members can view multisig config"
  on public.group_multisig_config for select
  using (
    auth.uid() is not null
    and exists (
      select 1 from public.room_members rm
      where rm.room_id = group_multisig_config.group_id
        and rm.user_id = auth.uid()
        and rm.removed_at is null
    )
  );

create policy "Service role can manage multisig config"
  on public.group_multisig_config for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- multisig_proposals: group members can view, owners can insert
create policy "Group members can view proposals"
  on public.multisig_proposals for select
  using (
    auth.uid() is not null
    and (
      exists (
        select 1 from public.room_members rm
        where rm.room_id = multisig_proposals.group_id
          and rm.user_id = auth.uid()
          and rm.removed_at is null
      )
      or exists (
        select 1 from public.rooms r
        where r.id = multisig_proposals.group_id
          and r.created_by = auth.uid()
      )
    )
  );

create policy "Multisig owners can create proposals"
  on public.multisig_proposals for insert
  with check (
    auth.uid() = proposed_by
    and exists (
      select 1 from public.group_multisig_owners gmo
      where gmo.group_id = multisig_proposals.group_id
        and gmo.user_id = auth.uid()
        and gmo.removed_at is null
    )
  );

create policy "Service role can update proposals"
  on public.multisig_proposals for update
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- multisig_approvals: visible to group members, insertable by multisig owners
create policy "Group members can view approvals"
  on public.multisig_approvals for select
  using (
    auth.uid() is not null
    and (
      exists (
        select 1 from public.room_members rm
        where rm.room_id = multisig_approvals.group_id
          and rm.user_id = auth.uid()
          and rm.removed_at is null
      )
      or exists (
        select 1 from public.rooms r
        where r.id = multisig_approvals.group_id
          and r.created_by = auth.uid()
      )
    )
  );

create policy "Multisig owners can submit approvals"
  on public.multisig_approvals for insert
  with check (
    auth.uid() = approver_user_id
    and exists (
      select 1 from public.group_multisig_owners gmo
      where gmo.group_id = multisig_approvals.group_id
        and gmo.user_id = auth.uid()
        and gmo.removed_at is null
    )
  );

-- ── 6. Helper RPC: enable multisig for a group ─────────────────────────────────
-- Called by the current single owner to bootstrap multi-owner support.
-- Inserts the calling owner as first co-owner, creates the config row.
create or replace function public.enable_group_multisig(
  p_group_id          text,
  p_required_approvals int,
  p_owner_wallet      text
)
returns table (
  config_group_id     text,
  required_approvals  int,
  owner_count         int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room         public.rooms%rowtype;
  v_owner_count  int;
begin
  -- Caller must be the current owner
  select * into v_room from public.rooms where id = p_group_id for update;
  if not found then
    raise exception 'Room not found' using errcode = 'P0002';
  end if;
  if v_room.created_by <> auth.uid() then
    raise exception 'Only the current owner can enable multisig' using errcode = '42501';
  end if;

  if p_required_approvals < 1 then
    raise exception 'required_approvals must be at least 1' using errcode = '22023';
  end if;

  -- Upsert the calling owner as a co-owner (idempotent)
  insert into public.group_multisig_owners (group_id, wallet_address, user_id, added_by)
  values (p_group_id, p_owner_wallet, auth.uid(), auth.uid())
  on conflict (group_id, wallet_address) do update
    set removed_at = null;

  -- Upsert config
  insert into public.group_multisig_config (group_id, required_approvals, enabled)
  values (p_group_id, p_required_approvals, true)
  on conflict (group_id) do update
    set required_approvals = excluded.required_approvals,
        enabled = true,
        updated_at = timezone('utc', now());

  select count(*) into v_owner_count
  from public.group_multisig_owners
  where group_id = p_group_id and removed_at is null;

  config_group_id    := p_group_id;
  required_approvals := p_required_approvals;
  owner_count        := v_owner_count;
  return next;
end;
$$;

grant execute on function public.enable_group_multisig(text, int, text) to authenticated;

-- ── 7. Helper RPC: add a co-owner ─────────────────────────────────────────────
create or replace function public.add_group_multisig_owner(
  p_group_id      text,
  p_new_wallet    text,
  p_new_user_id   uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room  public.rooms%rowtype;
  v_id    uuid;
begin
  select * into v_room from public.rooms where id = p_group_id;
  if not found then
    raise exception 'Room not found' using errcode = 'P0002';
  end if;

  -- Only an existing active co-owner (or original owner) may add others
  if v_room.created_by <> auth.uid() then
    if not exists (
      select 1 from public.group_multisig_owners
      where group_id = p_group_id
        and user_id  = auth.uid()
        and removed_at is null
    ) then
      raise exception 'Only an existing group owner can add a co-owner' using errcode = '42501';
    end if;
  end if;

  insert into public.group_multisig_owners (group_id, wallet_address, user_id, added_by)
  values (p_group_id, p_new_wallet, p_new_user_id, auth.uid())
  on conflict (group_id, wallet_address) do update
    set removed_at = null,
        user_id    = excluded.user_id,
        added_by   = excluded.added_by,
        added_at   = timezone('utc', now())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.add_group_multisig_owner(text, text, uuid) to authenticated;

-- ── 8. Helper RPC: remove a co-owner ──────────────────────────────────────────
create or replace function public.remove_group_multisig_owner(
  p_group_id      text,
  p_target_wallet text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room         public.rooms%rowtype;
  v_owner_count  int;
begin
  select * into v_room from public.rooms where id = p_group_id;
  if not found then
    raise exception 'Room not found' using errcode = 'P0002';
  end if;

  -- Only the primary owner can remove a co-owner
  if v_room.created_by <> auth.uid() then
    raise exception 'Only the primary owner can remove a co-owner' using errcode = '42501';
  end if;

  -- Cannot remove yourself (primary owner) without transferring ownership first
  if p_target_wallet = v_room.owner_wallet then
    raise exception 'Cannot remove the primary owner wallet. Transfer ownership first.' using errcode = '22023';
  end if;

  -- Soft-delete
  update public.group_multisig_owners
  set removed_at = timezone('utc', now())
  where group_id = p_group_id and wallet_address = p_target_wallet and removed_at is null;

  -- Validate required_approvals <= remaining owner count
  select count(*) into v_owner_count
  from public.group_multisig_owners
  where group_id = p_group_id and removed_at is null;

  update public.group_multisig_config
  set required_approvals = least(required_approvals, greatest(v_owner_count, 1)),
      updated_at = timezone('utc', now())
  where group_id = p_group_id;

  return true;
end;
$$;

grant execute on function public.remove_group_multisig_owner(text, text) to authenticated;

-- ── 9. Expire stale proposals ─────────────────────────────────────────────────
create or replace function public.expire_multisig_proposals()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.multisig_proposals
  set status = 'expired'
  where status = 'pending'
    and expires_at < timezone('utc', now());

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.expire_multisig_proposals() to authenticated;

comment on table public.group_multisig_owners  is 'Co-owners of multisig-enabled groups';
comment on table public.group_multisig_config  is 'Per-group multisig approval threshold configuration';
comment on table public.multisig_proposals     is 'Pending sensitive-action proposals awaiting co-owner approval';
comment on table public.multisig_approvals     is 'Individual owner signatures approving a multisig proposal';
