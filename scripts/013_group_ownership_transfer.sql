-- Migration: Group Ownership Transfer
-- Adds an immutable audit log table for ownership transfers and a
-- security-definer RPC that atomically updates rooms.created_by and
-- writes the audit record in a single transaction.

-- ── 1. Ownership transfer audit log ──────────────────────────────────────────
create table if not exists public.ownership_transfer_logs (
  id                  uuid primary key default gen_random_uuid(),
  room_id             text not null references public.rooms(id) on delete cascade,
  previous_owner_id   uuid not null references auth.users(id) on delete set null,
  new_owner_id        uuid not null references auth.users(id) on delete set null,
  previous_owner_wallet text,
  new_owner_wallet      text,
  -- Hex-encoded Ed25519 signature supplied by the current owner to authorise
  -- the transfer.  Stored for non-repudiation; verification happens in the
  -- API layer before this RPC is called.
  signature           text not null,
  -- The nonce that was signed (consumed before the RPC is called).
  signed_nonce        text not null,
  stellar_tx_hash     text,
  created_at          timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Immutable: no UPDATE or DELETE allowed on audit rows.
alter table public.ownership_transfer_logs enable row level security;

create policy "Authenticated users can read transfer logs"
  on public.ownership_transfer_logs
  for select
  using (auth.role() = 'authenticated');

-- Only the service role (used by the RPC below) may insert.
create policy "Service role can insert transfer logs"
  on public.ownership_transfer_logs
  for insert
  with check (auth.role() = 'service_role');

create index if not exists ownership_transfer_logs_room_id_idx
  on public.ownership_transfer_logs(room_id);

create index if not exists ownership_transfer_logs_previous_owner_idx
  on public.ownership_transfer_logs(previous_owner_id);

create index if not exists ownership_transfer_logs_new_owner_idx
  on public.ownership_transfer_logs(new_owner_id);

-- ── 2. Atomic transfer RPC ────────────────────────────────────────────────────
-- Runs as SECURITY DEFINER so it can:
--   a) verify the caller is the current owner (auth.uid() = rooms.created_by)
--   b) update rooms.created_by atomically
--   c) write the immutable audit record
--
-- The API layer is responsible for:
--   • consuming the nonce
--   • verifying the Ed25519 signature
--   • confirming the new owner is a member of the group
-- before calling this function.

create or replace function public.transfer_room_ownership(
  p_room_id             text,
  p_new_owner_id        uuid,
  p_signature           text,
  p_signed_nonce        text,
  p_previous_owner_wallet text default null,
  p_new_owner_wallet      text default null,
  p_stellar_tx_hash       text default null
)
returns table (
  transferred_room_id   text,
  previous_owner_id     uuid,
  new_owner_id          uuid,
  transfer_log_id       uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room          public.rooms%rowtype;
  v_log_id        uuid;
  v_prev_owner_id uuid;
begin
  -- 1. Lock and fetch the room row
  select * into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Room not found' using errcode = 'P0002';
  end if;

  -- 2. Caller must be the current owner
  if v_room.created_by <> auth.uid() then
    raise exception 'Only the current group owner can transfer ownership'
      using errcode = '42501';
  end if;

  -- 3. New owner must differ from current owner
  if p_new_owner_id = v_room.created_by then
    raise exception 'New owner must be different from the current owner'
      using errcode = '22023';
  end if;

  v_prev_owner_id := v_room.created_by;

  -- 4. Update ownership
  update public.rooms
  set created_by = p_new_owner_id
  where id = p_room_id;

  -- 5. Write immutable audit record
  insert into public.ownership_transfer_logs (
    room_id,
    previous_owner_id,
    new_owner_id,
    previous_owner_wallet,
    new_owner_wallet,
    signature,
    signed_nonce,
    stellar_tx_hash
  ) values (
    p_room_id,
    v_prev_owner_id,
    p_new_owner_id,
    p_previous_owner_wallet,
    p_new_owner_wallet,
    p_signature,
    p_signed_nonce,
    p_stellar_tx_hash
  )
  returning id into v_log_id;

  -- 6. Return summary
  transferred_room_id := p_room_id;
  previous_owner_id   := v_prev_owner_id;
  new_owner_id        := p_new_owner_id;
  transfer_log_id     := v_log_id;
  return next;
end;
$$;

grant execute on function public.transfer_room_ownership(
  text, uuid, text, text, text, text, text
) to authenticated;
