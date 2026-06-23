-- Migration: Invite Code Expiration System with Audit Logging
-- Description: Adds comprehensive invite expiration support with time-based and usage-based limits,
-- cleanup functions, and audit logging for expiration events.

-- Add indexes for efficient expiration queries
create index if not exists invites_expires_at_idx on public.invites(expires_at)
  where expires_at is not null;

create index if not exists invites_max_uses_idx on public.invites(max_uses, use_count)
  where max_uses is not null;

create index if not exists invites_code_created_by_idx on public.invites(code, created_by);

-- Create a table to track invite expiration events for audit purposes
create table if not exists public.invite_expiration_logs (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null references public.invites(code) on delete cascade,
  room_id text not null references public.rooms(id) on delete cascade,
  expiration_type text not null check (
    expiration_type in ('time_expired', 'usage_limit_reached', 'manually_invalidated')
  ),
  expired_at timestamptz not null default timezone('utc'::text, now()),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists invite_expiration_logs_code_idx on public.invite_expiration_logs(invite_code);
create index if not exists invite_expiration_logs_room_idx on public.invite_expiration_logs(room_id);
create index if not exists invite_expiration_logs_type_idx on public.invite_expiration_logs(expiration_type);
create index if not exists invite_expiration_logs_created_at_idx on public.invite_expiration_logs(created_at desc);

alter table public.invite_expiration_logs enable row level security;

create policy "Users can view expiration logs for their rooms"
  on public.invite_expiration_logs for select
  using (
    exists (
      select 1 from public.invites i
      where i.code = invite_expiration_logs.invite_code
        and i.created_by = auth.uid()
    )
  );

-- Function to check if an invite code is expired (time-based)
create or replace function public.is_invite_time_expired(
  p_expires_at timestamp with time zone
)
returns boolean
language sql
immutable
as $$
  select p_expires_at is not null and p_expires_at < timezone('utc'::text, now());
$$;

-- Function to check if an invite code is expired (usage-based)
create or replace function public.is_invite_usage_expired(
  p_max_uses integer,
  p_use_count integer
)
returns boolean
language sql
immutable
as $$
  select p_max_uses is not null and p_use_count >= p_max_uses;
$$;

-- Function to check if an invite is fully expired
create or replace function public.is_invite_expired(
  p_expires_at timestamp with time zone,
  p_max_uses integer,
  p_use_count integer
)
returns boolean
language sql
immutable
as $$
  select public.is_invite_time_expired(p_expires_at)
    or public.is_invite_usage_expired(p_max_uses, p_use_count);
$$;

-- Function to log invite expiration event
create or replace function public.log_invite_expiration(
  p_invite_code text,
  p_room_id text,
  p_expiration_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_log_id uuid;
begin
  insert into public.invite_expiration_logs (
    invite_code,
    room_id,
    expiration_type,
    metadata
  )
  values (p_invite_code, p_room_id, p_expiration_type, p_metadata)
  returning id into v_log_id;
  
  return v_log_id;
end;
$$;

-- Function to clean up expired invites and log events
create or replace function public.cleanup_expired_invites(
  p_room_id text default null,
  p_dry_run boolean default false
)
returns table (
  cleaned_count integer,
  time_expired_count integer,
  usage_expired_count integer,
  details text
)
language plpgsql
security definer
as $$
declare
  v_time_expired integer := 0;
  v_usage_expired integer := 0;
  v_total_cleaned integer := 0;
  v_timestamp timestamptz := timezone('utc'::text, now());
  v_invite record;
begin
  -- Find and process time-expired invites
  for v_invite in
    select code, room_id, expires_at from public.invites
    where expires_at is not null
      and expires_at < v_timestamp
      and (p_room_id is null or room_id = p_room_id)
  loop
    if not p_dry_run then
      perform public.log_invite_expiration(
        v_invite.code,
        v_invite.room_id,
        'time_expired',
        jsonb_build_object(
          'expired_at', v_invite.expires_at,
          'cleanup_at', v_timestamp
        )
      );
    end if;
    v_time_expired := v_time_expired + 1;
  end loop;

  -- Find and process usage-limit-exceeded invites
  for v_invite in
    select code, room_id, max_uses, use_count from public.invites
    where max_uses is not null
      and use_count >= max_uses
      and (p_room_id is null or room_id = p_room_id)
      and not exists (
        select 1 from public.invite_expiration_logs
        where invite_code = code
          and expiration_type = 'usage_limit_reached'
      )
  loop
    if not p_dry_run then
      perform public.log_invite_expiration(
        v_invite.code,
        v_invite.room_id,
        'usage_limit_reached',
        jsonb_build_object(
          'max_uses', v_invite.max_uses,
          'use_count', v_invite.use_count,
          'cleanup_at', v_timestamp
        )
      );
    end if;
    v_usage_expired := v_usage_expired + 1;
  end loop;

  v_total_cleaned := v_time_expired + v_usage_expired;

  return query select
    v_total_cleaned,
    v_time_expired,
    v_usage_expired,
    format('Cleaned %s expired invites (%s time-based, %s usage-based)',
      v_total_cleaned, v_time_expired, v_usage_expired);
end;
$$;

-- Function to manually invalidate an invite and log the event
create or replace function public.invalidate_invite(
  p_invite_code text,
  p_reason text default 'manually_invalidated'
)
returns boolean
language plpgsql
security definer
as $$
declare
  v_room_id text;
begin
  select room_id into v_room_id from public.invites where code = p_invite_code;
  
  if v_room_id is null then
    raise exception 'Invite code not found';
  end if;

  perform public.log_invite_expiration(
    p_invite_code,
    v_room_id,
    'manually_invalidated',
    jsonb_build_object('reason', p_reason, 'invalidated_at', timezone('utc'::text, now()))
  );

  return true;
end;
$$;

-- Function to get invite expiration status
create or replace function public.get_invite_status(
  p_invite_code text
)
returns table (
  code text,
  room_id text,
  is_expired boolean,
  is_time_expired boolean,
  is_usage_expired boolean,
  time_remaining interval,
  uses_remaining integer,
  created_at timestamptz,
  expires_at timestamptz,
  max_uses integer,
  use_count integer
)
language sql
as $$
  select
    i.code,
    i.room_id,
    public.is_invite_expired(i.expires_at, i.max_uses, i.use_count),
    public.is_invite_time_expired(i.expires_at),
    public.is_invite_usage_expired(i.max_uses, i.use_count),
    i.expires_at - timezone('utc'::text, now())::timestamp,
    case when i.max_uses is not null then i.max_uses - i.use_count else null end,
    i.created_at,
    i.expires_at,
    i.max_uses,
    i.use_count
  from public.invites i
  where i.code = p_invite_code;
$$;

comment on table public.invite_expiration_logs is
  'Audit log tracking invite expiration events (time-based, usage-based, or manual invalidation)';

comment on function public.is_invite_time_expired(timestamp with time zone) is
  'Returns true if the invite has passed its expiration time';

comment on function public.is_invite_usage_expired(integer, integer) is
  'Returns true if the invite has reached its usage limit';

comment on function public.is_invite_expired(timestamp with time zone, integer, integer) is
  'Returns true if the invite is expired by either time or usage';

comment on function public.cleanup_expired_invites(text, boolean) is
  'Identifies and logs expired invites. Returns count of expired invites. If p_dry_run=true, no logs are created.';

comment on function public.get_invite_status(text) is
  'Returns comprehensive status information for an invite code including expiration details';
