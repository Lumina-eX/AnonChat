import { validateStellarAddress } from "./validation";

/**
 * Extracts the wallet address from Supabase user metadata.
 */
export function getWalletAddressFromUser(user: any): string | null {
  if (!user || typeof user !== "object") return null;

  const metadata = (user as any).user_metadata as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata.wallet_address !== "string") return null;

  const walletAddress = metadata.wallet_address;
  return validateStellarAddress(walletAddress) ? walletAddress : null;
}

/**
 * Resolves the owner wallet address for a room, preferring the explicit room field.
 * Falls back to the creator's profile wallet address when available.
 */
export async function resolveRoomOwnerWallet(
  supabase: any,
  room: { owner_wallet?: string | null; created_by?: string }
): Promise<string | null> {
  if (room?.owner_wallet && validateStellarAddress(room.owner_wallet)) {
    return room.owner_wallet;
  }

  if (!room?.created_by) {
    return null;
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("wallet_address")
    .eq("id", room.created_by)
    .maybeSingle();

  if (error || !profile || typeof profile.wallet_address !== "string") {
    return null;
  }

  return validateStellarAddress(profile.wallet_address) ? profile.wallet_address : null;
}
