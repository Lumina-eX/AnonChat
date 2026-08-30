-- Migration 020: Owner/moderator group member removal
-- Removes wallet membership and revokes auth-user room access atomically.

-- Keep the audit event constraint compatible whether migration 019 has run or not.
alter table public.group_audit_events
  drop constraint if exists group_audit_events_event_type_check;

alter table public.group_audit_events
  add constraint group_audit_events_event_type_check
  check (
    event_type in (
      'group_created', 'member_joined', 'member_left', 'member_removed',
      'role_assigned', 'role_revoked'
    )
  );

-- Allow activity feeds to record direct member removals.
alter table public.room_activity_logs
  drop constraint if exists room_activity_logs_event_type_check;

alter table public.room_activity_logs
  add constraint room_activity_logs_event_type_check
  check (
    event_type in (
      'group_created', 'user_joined', 'user_left', 'ownership_transferred',
      'member_removed'
    )
  );

-- The route performs a preflight check for a helpful response, but this RPC is
-- the authoritative enforcement boundary and re-checks every privilege.
create or replace function public.remove_group_member(
  p_group_id text,
  p_target_wallet text,
  p_actor_wallet text
)
returns table (
  group_membership_id uuid,
  room_membership_id uuid,
  target_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.group_membership%rowtype;
  v_group public.rooms%rowtype;
  v_actor_role text;
  v_target_user_id uuid;
  v_room_membership_id uuid;
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

  select * into v_target
  from public.group_membership
  where group_id = p_group_id
    and wallet_address = p_target_wallet
  for update;

  if not found then
    raise exception 'Target wallet is not a member of this group' using errcode = 'P0002';
  end if;

  if p_target_wallet = coalesce(v_group.owner_wallet, '')
     or v_target.role = 'owner' then
    raise exception 'The group owner cannot be removed' using errcode = '22023';
  end if;

  -- Do not trust the wallet supplied to the RPC. It must belong to the
  -- authenticated Supabase user, with the primary owner binding as a fallback
  -- for legacy profiles that predate wallet_address.
  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.wallet_address = p_actor_wallet
  ) and not (
    v_group.created_by = auth.uid()
    and p_actor_wallet = coalesce(v_group.owner_wallet, '')
  ) then
    raise exception 'Actor wallet does not match the authenticated user' using errcode = '42501';
  end if;

  -- The primary owner, an active multisig owner, or a role-assigned owner/
  -- moderator may perform the removal.
  if p_actor_wallet = coalesce(v_group.owner_wallet, '')
     and v_group.created_by = auth.uid() then
    v_actor_role := 'owner';
  elsif exists (
    select 1
    from public.group_multisig_owners gmo
    where gmo.group_id = p_group_id
      and gmo.wallet_address = p_actor_wallet
      and gmo.user_id = auth.uid()
      and gmo.removed_at is null
  ) then
    v_actor_role := 'owner';
  else
    select gm.role into v_actor_role
    from public.group_membership gm
    where gm.group_id = p_group_id
      and gm.wallet_address = p_actor_wallet;
  end if;

  if coalesce(v_actor_role, '') not in ('owner', 'moderator') then
    raise exception 'Only group owners and moderators can remove members' using errcode = '42501';
  end if;

  select p.id into v_target_user_id
  from public.profiles p
  where p.wallet_address = p_target_wallet;

  if v_target_user_id is not null then
    update public.room_members
    set removed_at = timezone('utc'::text, now())
    where room_id = p_group_id
      and user_id = v_target_user_id
      and removed_at is null
    returning id into v_room_membership_id;
  end if;

  delete from public.group_membership
  where id = v_target.id;

  return query
  select v_target.id, v_room_membership_id, v_target_user_id;
end;
$$;

grant execute on function public.remove_group_member(text, text, text) to authenticated;

comment on function public.remove_group_member is
  'Atomically removes a non-owner group member for an owner or moderator and revokes matching room access';

-- Add the new notification type while retaining existing notification rows.
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in ('group_added', 'ownership_transferred', 'member_removed'));
