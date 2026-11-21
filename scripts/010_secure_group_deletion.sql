-- Secure group deletion: only a room owner can delete a room and its related data.
-- The function is transactional when called through Postgres and explicitly removes
-- records that do not all have room-level ON DELETE CASCADE constraints in older installs.

create or replace function public.delete_room_as_owner(p_room_id text)
returns table (
  deleted_room_id text,
  deleted_messages bigint,
  deleted_room_members bigint,
  deleted_room_removal_votes bigint,
  deleted_group_memberships bigint,
  deleted_invites bigint,
  deleted_file_references bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
begin
  select * into v_room
  from public.rooms
  where id = p_room_id;

  if not found then
    raise exception 'Room not found' using errcode = 'P0002';
  end if;

  if v_room.created_by <> auth.uid() then
    raise exception 'Only the group owner can delete this group' using errcode = '42501';
  end if;

  delete from public.messages where room_id = p_room_id;
  get diagnostics deleted_messages = row_count;

  delete from public.room_removal_votes where room_id = p_room_id;
  get diagnostics deleted_room_removal_votes = row_count;

  delete from public.encrypted_file_references where room_id = p_room_id;
  get diagnostics deleted_file_references = row_count;

  delete from public.invites where room_id = p_room_id;
  get diagnostics deleted_invites = row_count;

  delete from public.group_membership where group_id = p_room_id;
  get diagnostics deleted_group_memberships = row_count;

  delete from public.room_members where room_id = p_room_id;
  get diagnostics deleted_room_members = row_count;

  delete from public.rooms where id = p_room_id;

  deleted_room_id := p_room_id;
  return next;
end;
$$;

grant execute on function public.delete_room_as_owner(text) to authenticated;
