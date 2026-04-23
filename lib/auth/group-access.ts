import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateStellarAddress } from "@/lib/auth/validation";

export type GroupAccessResult =
  | { success: true }
  | { success: false; response: NextResponse };

/**
 * Middleware-like utility to validate wallet membership before allowing access to group resources.
 * Checks against both direct wallet membership (group_membership) and user-profile membership (room_members).
 * 
 * @param roomId - The UUID of the chat room/group
 * @param walletAddress - The Stellar wallet address to validate
 * @returns Promise<GroupAccessResult>
 */
export async function validateGroupAccess(
  roomId: string,
  walletAddress: string
): Promise<GroupAccessResult> {
  // 1. Input Validation
  if (!roomId) {
    return {
      success: false,
      response: NextResponse.json({ error: "Missing roomId" }, { status: 400 }),
    };
  }

  if (!walletAddress || !validateStellarAddress(walletAddress)) {
    console.warn(`[GroupAccess] Invalid wallet address provided: ${walletAddress}`);
    return {
      success: false,
      response: NextResponse.json({ error: "Invalid or missing wallet address" }, { status: 400 }),
    };
  }

  try {
    const supabase = await createClient();

    // 2. Check direct wallet membership (group_membership)
    // Checks the 'group_membership' table introduced for wallet-based tracking
    const { data: walletMembership, error: walletError } = await supabase
      .from("group_membership")
      .select("id")
      .eq("room_id", roomId)
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    if (walletError && walletError.code !== "PGRST116") {
      console.error("[GroupAccess] Database error checking group_membership:", walletError);
    }

    if (walletMembership) {
      return { success: true };
    }

    // 3. Check user profile membership (room_members)
    // Fallback to checking if the wallet belongs to a user profile that is a member
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    if (profile) {
      const { data: roomMember } = await supabase
        .from("room_members")
        .select("id")
        .eq("room_id", roomId)
        .eq("user_id", profile.id)
        .maybeSingle();

      if (roomMember) {
        return { success: true };
      }
    }

    // 4. Access Denied
    console.warn(`[GroupAccess] Unauthorized access attempt: Wallet ${walletAddress} is not a member of room ${roomId}`);
    return {
      success: false,
      response: NextResponse.json(
        { error: "Unauthorized: You are not a member of this group" },
        { status: 403 }
      ),
    };

  } catch (err) {
    console.error("[GroupAccess] Unexpected error during validation:", err);
    return {
      success: false,
      response: NextResponse.json(
        { error: "Internal server error during access validation" },
        { status: 500 }
      ),
    };
  }
}