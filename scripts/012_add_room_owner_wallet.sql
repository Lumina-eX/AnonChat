-- Migration: Add owner_wallet to rooms for wallet-based group ownership
-- This stores the Stellar wallet address that owns the room.

ALTER TABLE public.rooms
ADD COLUMN IF NOT EXISTS owner_wallet text NULL;

COMMENT ON COLUMN public.rooms.owner_wallet IS
  'Stellar wallet address that owns this chat room/group';

CREATE INDEX IF NOT EXISTS rooms_owner_wallet_idx ON public.rooms(owner_wallet);
