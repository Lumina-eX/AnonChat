-- Group message retention policies and safe, auditable expiry cleanup.

alter table public.messages
  add column if not exists retention_expires_at timestamptz;

create index if not exists messages_retention_expires_at_idx
  on public.messages (retention_expires_at)
  where retention_expires_at is not null;

create table if not exists public.message_retention_policies (
  room_id text primary key references public.rooms(id) on delete cascade,
  enabled boolean not null default false,
  retention_seconds integer not null default 86400
    check (retention_seconds between 300 and 2592000),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.message_retention_policies enable row level security;

create policy "Group members can view message retention policies"
  on public.message_retention_policies for select
  using (
    exists (
      select 1 from public.room_members rm
      where rm.room_id = message_retention_policies.room_id
        and rm.user_id = auth.uid()
        and rm.removed_at is null
    )
    or exists (
      select 1 from public.rooms r
      where r.id = message_retention_policies.room_id
        and r.created_by = auth.uid()
    )
  );

create table if not exists public.message_retention_policy_audit (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  previous_enabled boolean,
  previous_retention_seconds integer,
  enabled boolean not null,
  retention_seconds integer not null,
  changed_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists message_retention_policy_audit_room_changed_idx
  on public.message_retention_policy_audit (room_id, changed_at desc);

alter table public.message_retention_policy_audit enable row level security;

create policy "Group members can view message retention policy history"
  on public.message_retention_policy_audit for select
  using (
    exists (
      select 1 from public.room_members rm
      where rm.room_id = message_retention_policy_audit.room_id
        and rm.user_id = auth.uid()
        and rm.removed_at is null
    )
    or exists (
      select 1 from public.rooms r
      where r.id = message_retention_policy_audit.room_id
        and r.created_by = auth.uid()
    )
  );

create table if not exists public.message_retention_cleanup_logs (
  id uuid primary key default gen_random_uuid(),
  deleted_message_id uuid not null unique,
  room_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  deleted_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists message_retention_cleanup_logs_room_deleted_idx
  on public.message_retention_cleanup_logs (room_id, deleted_at desc);

create table if not exists public.message_retention_cleanup_retries (
  message_id uuid primary key,
  room_id text not null,
  attempts integer not null default 1,
  last_error text not null,
  last_attempt_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.message_retention_cleanup_logs enable row level security;
alter table public.message_retention_cleanup_retries enable row level security;

revoke all on public.message_retention_cleanup_logs from anon, authenticated;
revoke all on public.message_retention_cleanup_retries from anon, authenticated;
grant all on public.message_retention_cleanup_logs to service_role;
grant all on public.message_retention_cleanup_retries to service_role;

create or replace function public.set_message_retention_policy(
  p_room_id text,
  p_enabled boolean,
  p_retention_seconds integer,
  p_actor_user_id uuid
)
returns public.message_retention_policies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous public.message_retention_policies%rowtype;
  v_policy public.message_retention_policies%rowtype;
  v_changed_at timestamptz := timezone('utc'::text, now());
begin
  if p_retention_seconds < 300 or p_retention_seconds > 2592000 then
    raise exception 'Retention duration must be between 300 and 2592000 seconds'
      using errcode = '22023';
  end if;

  insert into public.message_retention_policies (room_id)
  values (p_room_id)
  on conflict (room_id) do nothing;

  select * into v_previous
  from public.message_retention_policies
  where room_id = p_room_id
  for update;

  insert into public.message_retention_policies (
    room_id, enabled, retention_seconds, updated_at, updated_by
  ) values (
    p_room_id, p_enabled, p_retention_seconds, v_changed_at, p_actor_user_id
  )
  on conflict (room_id) do update set
    enabled = excluded.enabled,
    retention_seconds = excluded.retention_seconds,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
  returning * into v_policy;

  insert into public.message_retention_policy_audit (
    room_id, actor_user_id, previous_enabled, previous_retention_seconds,
    enabled, retention_seconds, changed_at
  ) values (
    p_room_id,
    p_actor_user_id,
    case when v_previous.room_id is null then null else v_previous.enabled end,
    v_previous.retention_seconds,
    p_enabled,
    p_retention_seconds,
    v_changed_at
  );

  return v_policy;
end;
$$;

create or replace function public.delete_expired_retention_message(p_message_id uuid)
returns table (room_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.messages%rowtype;
begin
  select * into v_message
  from public.messages
  where id = p_message_id
    and retention_expires_at <= timezone('utc'::text, now())
  for update;

  if not found then
    return;
  end if;

  insert into public.message_retention_cleanup_logs (
    deleted_message_id, room_id, user_id, expires_at
  ) values (
    v_message.id, v_message.room_id, v_message.user_id, v_message.retention_expires_at
  )
  on conflict (deleted_message_id) do nothing;

  delete from public.messages where id = v_message.id;
  delete from public.message_retention_cleanup_retries where message_id = v_message.id;

  return query select v_message.room_id;
end;
$$;

create or replace function public.record_message_retention_cleanup_retry(
  p_message_id uuid,
  p_room_id text,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.message_retention_cleanup_retries (
    message_id, room_id, attempts, last_error, last_attempt_at
  ) values (
    p_message_id, p_room_id, 1, p_error, timezone('utc'::text, now())
  )
  on conflict (message_id) do update set
    room_id = excluded.room_id,
    attempts = message_retention_cleanup_retries.attempts + 1,
    last_error = excluded.last_error,
    last_attempt_at = excluded.last_attempt_at;
end;
$$;

revoke all on function public.set_message_retention_policy(text, boolean, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_expired_retention_message(uuid)
  from public, anon, authenticated;
revoke all on function public.record_message_retention_cleanup_retry(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.set_message_retention_policy(text, boolean, integer, uuid)
  to service_role;
grant execute on function public.delete_expired_retention_message(uuid)
  to service_role;
grant execute on function public.record_message_retention_cleanup_retry(uuid, text, text)
  to service_role;

comment on column public.messages.retention_expires_at is
  'Message creation-time expiry set from the group policy active when the message was created.';
comment on table public.message_retention_policy_audit is
  'Append-only history of group message retention policy changes.';
comment on table public.message_retention_cleanup_logs is
  'Audit metadata for messages removed by group retention; message content is never copied here.';
comment on table public.message_retention_cleanup_retries is
  'Retry records for retention cleanup failures; the scheduled worker retries expired messages.';
