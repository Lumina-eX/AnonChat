import { NextResponse } from "next/server"
import { resolveRoomOwnerWallet } from "../auth/wallet-owner"
import { isMultisigOwner } from "@/lib/groups/multisig"

type RequireGroupOwnerParams = {
  supabase: any
  groupId: string
  callerWallet?: string | null
  userId?: string | null
}

/**
 * Verifies that the caller (by wallet or user id) is an owner of the group.
 *
 * In single-owner mode: caller must match rooms.owner_wallet / rooms.created_by.
 * In multi-owner mode: caller must be an active entry in group_multisig_owners
 *   OR be the primary owner.
 *
 * Returns an object with `authorized: true` when check passes, otherwise
 * returns a `NextResponse` with a properly shaped 403 Unauthorized JSON body.
 */
export async function requireGroupOwner({
  supabase,
  groupId,
  callerWallet,
  userId,
}: RequireGroupOwnerParams): Promise<any> {
  try {
    const { data: room, error } = await supabase
      .from("rooms")
      .select("id, owner_wallet, created_by")
      .eq("id", groupId)
      .maybeSingle()

    if (error) {
      console.error("[requireGroupOwner] group lookup error:", error)
      return NextResponse.json({ error: "Failed to retrieve group" }, { status: 500 })
    }

    if (!room) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 })
    }

    const ownerWallet = await resolveRoomOwnerWallet(supabase, room)

    // ── Check by wallet ───────────────────────────────────────────────────────
    if (callerWallet) {
      // Primary owner fast-path
      if (ownerWallet && ownerWallet === callerWallet) {
        return { authorized: true, ownerWallet, ownerUserId: room.created_by }
      }

      // Multi-sig co-owner check
      const coOwner = await isMultisigOwner(supabase, groupId, callerWallet)
      if (coOwner) {
        return { authorized: true, ownerWallet: callerWallet, ownerUserId: room.created_by }
      }

      console.warn(
        `[requireGroupOwner] wallet ${
          callerWallet?.substring(0, 8) ?? callerWallet
        }... is not owner of group ${groupId}`
      )
      return NextResponse.json(
        { error: "Unauthorized", message: "You are not an owner of this group." },
        { status: 403 }
      )
    }

    // ── Check by user ID ──────────────────────────────────────────────────────
    if (userId) {
      if (room.created_by === userId) {
        return { authorized: true, ownerWallet, ownerUserId: room.created_by }
      }

      // Look up whether userId maps to a co-owner wallet
      const { data: profile } = await supabase
        .from("profiles")
        .select("wallet_address")
        .eq("id", userId)
        .maybeSingle()

      if (profile?.wallet_address) {
        const coOwner = await isMultisigOwner(supabase, groupId, profile.wallet_address)
        if (coOwner) {
          return { authorized: true, ownerWallet: profile.wallet_address, ownerUserId: room.created_by }
        }
      }

      console.warn(`[requireGroupOwner] user ${userId} is not owner of group ${groupId}`)
      return NextResponse.json(
        { error: "Unauthorized", message: "You are not an owner of this group." },
        { status: 403 }
      )
    }

    console.warn(`[requireGroupOwner] missing callerWallet and userId for group ${groupId}`)
    return NextResponse.json(
      { error: "Unauthorized", message: "You are not an owner of this group." },
      { status: 403 }
    )
  } catch (err) {
    console.error("[requireGroupOwner] unexpected error:", err)
    return NextResponse.json({ error: "Failed to verify ownership" }, { status: 500 })
  }
}

export default requireGroupOwner
