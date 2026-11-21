-- Migration 019: Group Member Role Management
-- Adds role-based permissions within groups (Owner, Moderator, Member).
-- Backward compatible: existing members default to 'member' role.

-- ── 1. Add role column to group_membership ─────────────────────────────────────
-- The role column supports three tiers: owner, moderator, member.
-- Default is 'member' so existing records are treated as standard participants.
alter table public.group_membership
 add column if not exists role text not null default 'member'
 check (role in ('owner', 'moderator', 'member'));

comment on column public.group_membership.role is
 'Group role: owner (full control), moderator (manage members/content), member (standard participant)';

-- ── 2. Index on role for efficient role-based queries ──────────────────────────
create index if not exists group_membership_role_idx
 on public.group_membership(role);

-- ── 3. RLS policies for role management ────────────────────────────────────────

-- Only owners and moderators can update roles for other members
create policy "Owners and moderators can manage member roles"
 on public.group_membership for update
 using (
   auth.role() = 'authenticated'
   and (
     -- Caller is the owner of the room
     exists (
       select 1 from public.rooms r
       where r.id = group_membership.group_id
       and r.created_by = auth.uid()
     )
     or
     -- Caller is a moderator (or owner) in this group
     exists (
       select 1 from public.group_membership gm
       where gm.group_id = group_membership.group_id
       and gm.wallet_address = (
         select wallet_address from public.profiles where id = auth.uid()
       )
       and gm.role in ('owner', 'moderator')
     )
   )
 )
 with check (
   auth.role() = 'authenticated'
   and (
     exists (
       select 1 from public.rooms r
       where r.id = group_membership.group_id
       and r.created_by = auth.uid()
     )
     or
     exists (
       select 1 from public.group_membership gm
       where gm.group_id = group_membership.group_id
       and gm.wallet_address = (
         select wallet_address from public.profiles where id = auth.uid()
       )
       and gm.role in ('owner', 'moderator')
     )
   )
 );

-- Drop the old insert/delete policies and replace with role-aware ones
drop policy if exists "Authenticated users can insert group membership" on public.group_membership;
drop policy if exists "Authenticated users can delete group membership" on public.group_membership;

-- Authenticated users can insert their own membership (joining)
create policy "Authenticated users can insert their own membership"
 on public.group_membership for insert
 with check (
   auth.role() = 'authenticated'
   and (
     -- User is inserting their own record
     wallet_address = (select wallet_address from public.profiles where id = auth.uid())
     or
     -- User is an owner or moderator inserting others
     exists (
       select 1 from public.group_membership gm
       where gm.group_id = group_membership.group_id
       and gm.wallet_address = (select wallet_address from public.profiles where id = auth.uid())
       and gm.role in ('owner', 'moderator')
     )
     or
     -- User is the room owner
     exists (
       select 1 from public.rooms r
       where r.id = group_membership.group_id
       and r.created_by = auth.uid()
     )
   )
 );

-- Authenticated users can delete their own membership (leaving)
-- Owners and moderators can remove other members
create policy "Owners and moderators can delete member records"
 on public.group_membership for delete
 using (
   auth.role() = 'authenticated'
   and (
     -- User is deleting their own record (leaving)
     wallet_address = (select wallet_address from public.profiles where id = auth.uid())
     or
     -- User is an owner or moderator removing others
     exists (
       select 1 from public.group_membership gm
       where gm.group_id = group_membership.group_id
       and gm.wallet_address = (select wallet_address from public.profiles where id = auth.uid())
       and gm.role in ('owner', 'moderator')
     )
     or
     -- User is the room owner
     exists (
       select 1 from public.rooms r
       where r.id = group_membership.group_id
       and r.created_by = auth.uid()
     )
   )
 );

-- ── 4. Update audit event types to include role management events ─────────────
-- Extend the check constraint on group_audit_events.event_type to include
-- the new role_assigned and role_revoked event types.
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

-- ── 5. Helper function: get role for a wallet in a group ───────────────────────
create or replace function public.get_group_member_role(
 p_group_id text,
 p_wallet_address text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
 v_role text;
begin
 select gm.role into v_role
 from public.group_membership gm
 where gm.group_id = p_group_id
   and gm.wallet_address = p_wallet_address;

 return v_role;
end;
$$;

grant execute on function public.get_group_member_role(text, text) to authenticated;

comment on function public.get_group_member_role is
 'Returns the role of a wallet address within a group, or null if not a member';

-- ── 6. Helper function: check if a wallet has at least a minimum role ──────────
-- Role hierarchy: owner > moderator > member
-- Returns true if the wallet's role is at least the required minimum.
create or replace function public.check_group_member_role(
 p_group_id text,
 p_wallet_address text,
 p_minimum_role text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
 v_role text;
 v_role_rank int;
 v_min_rank int;
begin
 select gm.role into v_role
 from public.group_membership gm
 where gm.group_id = p_group_id
   and gm.wallet_address = p_wallet_address;

 if v_role is null then
   return false;
 end if;

 -- Define role hierarchy: owner=3, moderator=2, member=1
 v_role_rank := case v_role
   when 'owner' then 3
   when 'moderator' then 2
   when 'member' then 1
   else 0
 end;

 v_min_rank := case p_minimum_role
   when 'owner' then 3
   when 'moderator' then 2
   when 'member' then 1
   else 0
 end;

 return v_role_rank >= v_min_rank;
end;
$$;

grant execute on function public.check_group_member_role(text, text, text) to authenticated;

comment on function public.check_group_member_role is
 'Returns true if the wallet has at least the minimum required role in the group';

-- ── 7. Helper function: list members with their roles for a group ──────────────
create or replace function public.get_group_members_with_roles(
 p_group_id text
)
returns table (
 wallet_address text,
 role text,
 joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
 return query
 select gm.wallet_address, gm.role, gm.joined_at
 from public.group_membership gm
 where gm.group_id = p_group_id
 order by
   case gm.role
     when 'owner' then 1
     when 'moderator' then 2
     when 'member' then 3
   end,
   gm.joined_at asc;
end;
$$;

grant execute on function public.get_group_members_with_roles(text) to authenticated;

comment on function public.get_group_members_with_roles is
 'Returns all members of a group with their roles, ordered by role hierarchy';
