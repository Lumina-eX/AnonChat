-- Add an owner_wallet column to rooms so ownership can be tied to a
-- Stellar wallet address.  Existing rows will have NULL; new inserts
-- must provide a value via the application logic.

alter table if exists public.rooms
  add column if not exists owner_wallet text;

-- You may want to index by wallet for fast lookups later.
create index if not exists rooms_owner_wallet_idx on public.rooms(owner_wallet);

-- Row-level security policies need minor tweaks so that the wallet
-- address recorded on the room actually corresponds to the wallet tied to
-- the current JWT.  This prevents a malicious client from inserting an
-- arbitrary owner_wallet value.

-- upgrade insert policy to check the jwt metadata
create policy if not exists "Users can create rooms"
  on public.rooms for insert
  with check (
    auth.uid() = created_by
    and owner_wallet is not null
    and owner_wallet = (auth.jwt() ->> 'user_metadata' ->> 'wallet_address')
  );

-- update policy should similarly verify the wallet matches; existing
-- policy is redefined here for clarity
create policy if not exists "Room creators can update their rooms"
  on public.rooms for update
  using (
    auth.uid() = created_by
    and owner_wallet = (auth.jwt() ->> 'user_metadata' ->> 'wallet_address')
  );
