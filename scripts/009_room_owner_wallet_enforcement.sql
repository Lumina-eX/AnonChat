-- Tie room ownership to Stellar wallet addresses and enforce wallet-based updates

alter table public.rooms
add column if not exists owner_wallet text;

-- Best-effort backfill using wallet-login deterministic email convention
update public.rooms r
set owner_wallet = upper(split_part(u.email, '@', 1))
from auth.users u
where r.created_by = u.id
  and r.owner_wallet is null
  and u.email like '%@wallet.anonchat.local';

create index if not exists rooms_owner_wallet_idx on public.rooms(owner_wallet);

-- Keep existing policy if present, then replace with wallet-bound policies
drop policy if exists "Users can create rooms" on public.rooms;
drop policy if exists "Room creators can update their rooms" on public.rooms;

create policy "Users can create rooms"
  on public.rooms for insert
  with check (
    auth.uid() = created_by
    and owner_wallet is not null
    and upper(owner_wallet) = upper(
      coalesce(
        auth.jwt() -> 'user_metadata' ->> 'wallet_address',
        split_part(auth.jwt() ->> 'email', '@', 1)
      )
    )
  );

create policy "Room creators can update their rooms"
  on public.rooms for update
  using (
    auth.uid() = created_by
    and owner_wallet is not null
    and upper(owner_wallet) = upper(
      coalesce(
        auth.jwt() -> 'user_metadata' ->> 'wallet_address',
        split_part(auth.jwt() ->> 'email', '@', 1)
      )
    )
  )
  with check (
    auth.uid() = created_by
    and owner_wallet is not null
    and upper(owner_wallet) = upper(
      coalesce(
        auth.jwt() -> 'user_metadata' ->> 'wallet_address',
        split_part(auth.jwt() ->> 'email', '@', 1)
      )
    )
  );

