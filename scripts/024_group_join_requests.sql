-- Migration 024: Private group join requests
-- Stores membership requests for private groups and provides security-definer
-- functions for creating, approving, and rejecting requests. Approval creates
-- membership and updates the request in a single transaction.

create table if not exists public.group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id text not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_address text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  message text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewer_wallet text,
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- A user may have only one pending request per group, while keeping the
-- history of previous rejected/cancelled requests.
create unique index if not exists group_join_requests_pending_unique_idx
  on public.group_join_requests(group_id, user_id)
  where status = 'pending';

create index if not exists group_join_requests_group_status_idx
  on public.group_join_requests(group_id, status, created_at desc);

create index if not exists group_join_requests_user_idx
  on public.group_join_requests(user_id, created_at desc);

alter table public.group_join_requests enable row level security;

-- Visibility helpers run as the definer so policies can consult membership,
-- co-owner, and profile tables without recursive RLS evaluation.
create or replace function public.is_group_member(p_group_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (
      select 1 from public.room_members rm
      where rm.room_id = p_group_id
        and rm.user_id = auth.uid()
        and rm.removed_at is null
    )
    or exists (
      select 1
      from public.group_membership gm
      join public.profiles p on p.wallet_address = gm.wallet_address
      where gm.group_id = p_group_id
        and p.id = auth.uid()
    )
    or exists (
      select 1 from public.group_multisig_owners gmo
      where gmo.group_id = p_group_id
        and gmo.user_id = auth.uid()
        and gmo.removed_at is null
    );
$$;

create or replace function public.is_group_reviewer(p_group_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (
      select 1 from public.rooms r
      where r.id = p_group_id
        and r.created_by = auth.uid()
    )
    or exists (
      select 1
      from public.group_membership gm
      join public.profiles p on p.wallet_address = gm.wallet_address
      where gm.group_id = p_group_id
        and p.id = auth.uid()
        and gm.role in ('owner', 'moderator')
    )
    or exists (
      select 1 from public.group_multisig_owners gmo
      where gmo.group_id = p_group_id
        and gmo.user_id = auth.uid()
        and gmo.removed_at is null
    );
$$;

-- Reviewers can be the room creator, a wallet-based member with an elevated
-- role, or a multi-signature co-owner.
drop policy if exists "Requesters and reviewers can view join requests"
  on public.group_join_requests;

create policy "Requesters and reviewers can view join requests"
  on public.group_join_requests for select
  using (
    auth.uid() = user_id
    or public.is_group_reviewer(group_id)
  );

create policy "Users can create their own join requests"
  on public.group_join_requests for insert
  with check (auth.uid() = user_id);

create policy "Requesters can cancel their pending requests"
  on public.group_join_requests for update
  using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id);

grant select, insert, update on public.group_join_requests to authenticated;

-- Private rooms are hidden from non-creators by the base rooms policy. Members
-- and co-owners still need to read the room row to list and review requests.
drop policy if exists "Group members can view their private rooms"
  on public.rooms;

create policy "Group members can view their private rooms"
  on public.rooms for select
  using (
    created_by = auth.uid()
    or public.is_group_member(id)
  );

-- Extend audit and notification constraints for the new lifecycle events.
-- Wallet verification events are included because reviewing a request also
-- records the signature check in the group audit trail.
alter table public.group_audit_events
  drop constraint if exists group_audit_events_event_type_check;

alter table public.group_audit_events
  add constraint group_audit_events_event_type_check
  check (
    event_type in (
      'group_created', 'member_joined', 'member_left', 'member_removed',
      'role_assigned', 'role_revoked',
      'wallet_verified', 'wallet_verification_failed',
      'join_request_created', 'join_request_approved',
      'join_request_rejected', 'join_request_cancelled'
    )
  );

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'group_added', 'ownership_transferred', 'member_removed',
      'group_join_requested', 'group_join_request_approved',
      'group_join_request_rejected'
    )
  );

-- Resolves the caller's role for a group, or null when the wallet does not
-- belong to the authenticated user or is not an owner/moderator.
create or replace function public.resolve_group_actor_role(
  p_group_id text,
  p_actor_wallet text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.rooms%rowtype;
  v_role text;
begin
  if auth.uid() is null or p_actor_wallet is null then
    return null;
  end if;

  select * into v_group
  from public.rooms
  where id = p_group_id;

  if not found then
    return null;
  end if;

  -- Do not trust the wallet supplied to the RPC. It must belong to the
  -- authenticated Supabase user, with the primary owner binding as a fallback.
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.wallet_address = p_actor_wallet
  ) and not (
    v_group.created_by = auth.uid()
    and p_actor_wallet = coalesce(v_group.owner_wallet, '')
  ) then
    return null;
  end if;

  if v_group.created_by = auth.uid()
     and p_actor_wallet = coalesce(v_group.owner_wallet, '') then
    return 'owner';
  end if;

  if exists (
    select 1
    from public.group_multisig_owners gmo
    where gmo.group_id = v_group.id
      and gmo.wallet_address = p_actor_wallet
      and gmo.user_id = auth.uid()
      and gmo.removed_at is null
  ) then
    return 'owner';
  end if;

  select gm.role into v_role
  from public.group_membership gm
  where gm.group_id = v_group.id
    and gm.wallet_address = p_actor_wallet;

  return v_role;
end;
$$;

-- Creates a pending join request for a private group. Eligibility and
-- duplicate checks run inside the function so private room rows do not need
-- to be exposed to non-members through RLS.
create or replace function public.create_group_join_request(
  p_group_id text,
  p_message text default null
)
returns table (
  id uuid,
  group_id text,
  user_id uuid,
  wallet_address text,
  status text,
  message text,
  reviewed_by uuid,
  reviewer_wallet text,
  reviewed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  group_name text,
  group_owner_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.rooms%rowtype;
  v_wallet text;
  v_request public.group_join_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select * into v_group
  from public.rooms
  where id = p_group_id;

  if not found then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;

  if not coalesce(v_group.is_private, false) then
    raise exception 'Join requests are only available for private groups.'
      using errcode = 'P0004';
  end if;

  select p.wallet_address into v_wallet
  from public.profiles p
  where p.id = auth.uid();

  if v_wallet is null then
    raise exception 'Could not determine caller wallet address'
      using errcode = 'P0007';
  end if;

  if exists (
    select 1 from public.group_membership gm
    where gm.group_id = p_group_id
      and gm.wallet_address = v_wallet
  ) or exists (
    select 1 from public.room_members rm
    where rm.room_id = p_group_id
      and rm.user_id = auth.uid()
      and rm.removed_at is null
  ) then
    raise exception 'You are already a member of this group.'
      using errcode = 'P0005';
  end if;

  select * into v_request
  from public.group_join_requests gjr
  where gjr.group_id = p_group_id
    and gjr.user_id = auth.uid()
    and gjr.status = 'pending';

  if found then
    raise exception 'You already have a pending join request for this group.'
      using errcode = 'P0006';
  end if;

  insert into public.group_join_requests (
    group_id, user_id, wallet_address, message, status
  )
  values (
    p_group_id, auth.uid(), v_wallet, nullif(btrim(p_message), ''), 'pending'
  )
  returning * into v_request;

  return query
  select v_request.id, v_request.group_id, v_request.user_id,
    v_request.wallet_address, v_request.status, v_request.message,
    v_request.reviewed_by, v_request.reviewer_wallet, v_request.reviewed_at,
    v_request.created_at, v_request.updated_at, v_group.name, v_group.created_by;
exception
  when unique_violation then
    raise exception 'You already have a pending join request for this group.'
      using errcode = 'P0006';
end;
$$;

-- Atomic approval: authorization is re-checked here, membership is created,
-- and the request is marked approved in a single transaction. Any failure
-- rolls the whole operation back. The row lock prevents two reviewers from
-- approving the same request concurrently.
drop function if exists public.approve_group_join_request(uuid, text);

create or replace function public.approve_group_join_request(
  p_request_id uuid,
  p_actor_wallet text
)
returns table (
  request_id uuid,
  group_id text,
  requester_user_id uuid,
  wallet_address text,
  membership_id uuid,
  group_name text,
  actor_role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.group_join_requests%rowtype;
  v_group public.rooms%rowtype;
  v_actor_role text;
  v_membership_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select * into v_request
  from public.group_join_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Join request not found' using errcode = 'P0002';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Join request has already been reviewed' using errcode = '22023';
  end if;

  select * into v_group
  from public.rooms
  where id = v_request.group_id;

  if not found then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;

  v_actor_role := public.resolve_group_actor_role(v_group.id, p_actor_wallet);

  if coalesce(v_actor_role, '') not in ('owner', 'moderator') then
    raise exception 'Only group owners and moderators can approve join requests'
      using errcode = '42501';
  end if;

  insert into public.group_membership (group_id, wallet_address, role)
  values (v_group.id, v_request.wallet_address, 'member')
  on conflict (group_id, wallet_address) do nothing;

  select gm.id into v_membership_id
  from public.group_membership gm
  where gm.group_id = v_group.id
    and gm.wallet_address = v_request.wallet_address;

  insert into public.room_members (user_id, room_id)
  values (v_request.user_id, v_group.id)
  on conflict (user_id, room_id)
  do update set removed_at = null;

  update public.group_join_requests
  set status = 'approved',
      reviewed_by = auth.uid(),
      reviewer_wallet = p_actor_wallet,
      reviewed_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  where id = v_request.id;

  return query
  select v_request.id, v_group.id, v_request.user_id, v_request.wallet_address,
    v_membership_id, v_group.name, v_actor_role;
end;
$$;

-- Atomic rejection: reviewers update the request through this function because
-- the requester-only RLS policy intentionally blocks direct reviewer updates.
create or replace function public.reject_group_join_request(
  p_request_id uuid,
  p_actor_wallet text
)
returns table (
  id uuid,
  group_id text,
  user_id uuid,
  wallet_address text,
  status text,
  message text,
  reviewed_by uuid,
  reviewer_wallet text,
  reviewed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  group_name text,
  actor_role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.group_join_requests%rowtype;
  v_group public.rooms%rowtype;
  v_actor_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select * into v_request
  from public.group_join_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Join request not found' using errcode = 'P0002';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Join request has already been reviewed' using errcode = '22023';
  end if;

  select * into v_group
  from public.rooms
  where id = v_request.group_id;

  if not found then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;

  v_actor_role := public.resolve_group_actor_role(v_group.id, p_actor_wallet);

  if coalesce(v_actor_role, '') not in ('owner', 'moderator') then
    raise exception 'Only group owners and moderators can reject join requests'
      using errcode = '42501';
  end if;

  update public.group_join_requests
  set status = 'rejected',
      reviewed_by = auth.uid(),
      reviewer_wallet = p_actor_wallet,
      reviewed_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  where id = v_request.id
  returning * into v_request;

  return query
  select v_request.id, v_request.group_id, v_request.user_id,
    v_request.wallet_address, v_request.status, v_request.message,
    v_request.reviewed_by, v_request.reviewer_wallet, v_request.reviewed_at,
    v_request.created_at, v_request.updated_at, v_group.name, v_actor_role;
end;
$$;

grant execute on function public.is_group_member(text) to authenticated;
grant execute on function public.is_group_reviewer(text) to authenticated;
grant execute on function public.resolve_group_actor_role(text, text) to authenticated;
grant execute on function public.create_group_join_request(text, text) to authenticated;
grant execute on function public.approve_group_join_request(uuid, text) to authenticated;
grant execute on function public.reject_group_join_request(uuid, text) to authenticated;

comment on table public.group_join_requests is
  'Membership requests for private groups, including reviewer and lifecycle metadata';

comment on function public.create_group_join_request is
  'Creates a pending join request after checking private-group eligibility and duplicates';

comment on function public.approve_group_join_request is
  'Atomically approves a pending join request and creates group/room membership';

comment on function public.reject_group_join_request is
  'Atomically rejects a pending join request as an authorized reviewer';
