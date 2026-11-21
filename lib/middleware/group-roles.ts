import { NextResponse } from "next/server"
import { resolveRoomOwnerWallet } from "../auth/wallet-owner"
import { isMultisigOwner } from "@/lib/groups/multisig"

export type GroupRole = "owner" | "moderator" | "member"

const ROLE_HIERARCHY: Record<GroupRole, number> = {
  owner: 3,
  moderator: 2,
  member: 1,
}

type RequireGroupRoleParams = {
  supabase: any
  groupId: string
  minimumRole: GroupRole
  callerWallet?: string | null
  userId?: string | null
}

type RequireGroupRoleResult = {
  authorized: true
  role: GroupRole
  ownerWallet: string | null
  ownerUserId: string | null
}

/**
 * Verifies that the caller (by wallet or user id) has at least the minimum
 * required role within a group.
 *
 * Role hierarchy: owner (3) > moderator (2) > member (1)
 *
 * - Owner can do everything, including assigning roles and managing settings.
 * - Moderator can manage members, moderate content, and enforce rules.
 * - Member is a standard participant with basic chat permissions.
 *
 * If the user is not a member of the group, the room owner check is used as
 * a fallback (owner always has full access).
 *
 * Returns an object with `authorized: true` when the check passes, otherwise
 * returns a `NextResponse` with a properly shaped 403 Unauthorized JSON body.
 */
export async function requireGroupRole({
  supabase,
  groupId,
  minimumRole,
  callerWallet,
  userId,
}: RequireGroupRoleParams): Promise<RequireGroupRoleResult | NextResponse> {
  try {
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("id, owner_wallet, created_by")
      .eq("id", groupId)
      .maybeSingle()

    if (roomError) {
      console.error("[requireGroupRole] room lookup error:", roomError)
      return NextResponse.json({ error: "Failed to retrieve group" }, { status: 500 })
    }

    if (!room) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 })
    }

    const ownerWallet = await resolveRoomOwnerWallet(supabase, room)
    let effectiveRole: GroupRole = "member"
    let resolvedWallet: string | null = null

    // ── Resolve caller identity ────────────────────────────────────────────────
    if (callerWallet) {
      resolvedWallet = callerWallet
    } else if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("wallet_address")
        .eq("id", userId)
        .maybeSingle()

      if (profile?.wallet_address) {
        resolvedWallet = profile.wallet_address
      }
    }

    if (!resolvedWallet) {
      console.warn(
        `[requireGroupRole] unable to resolve identity for group ${groupId}`
      )
      return NextResponse.json(
        { error: "Unauthorized", message: "Could not determine caller identity." },
        { status: 403 }
      )
    }

    // ── Check room owner (always has owner role) ──────────────────────────────
    if (ownerWallet && ownerWallet === resolvedWallet) {
      return { authorized: true, role: "owner", ownerWallet, ownerUserId: room.created_by }
    }

    // ── Check multi-sig owner (also has owner role) ──────────────────────────
    if (ownerWallet) {
      const coOwner = await isMultisigOwner(supabase, groupId, resolvedWallet)
      if (coOwner) {
        return { authorized: true, role: "owner", ownerWallet, ownerUserId: room.created_by }
      }
    }

    // ── Check group_membership role ──────────────────────────────────────────
    const { data: membership, error: memberError } = await supabase
      .from("group_membership")
      .select("role")
      .eq("group_id", groupId)
      .eq("wallet_address", resolvedWallet)
      .maybeSingle()

    if (memberError) {
      console.error("[requireGroupRole] membership lookup error:", memberError)
      return NextResponse.json({ error: "Failed to check membership" }, { status: 500 })
    }

    if (membership?.role) {
      effectiveRole = membership.role as GroupRole
    } else {
      // Not a member at all
      console.warn(
        `[requireGroupRole] wallet ${resolvedWallet.substring(0, 8)}... is not a member of group ${groupId}`
      )
      return NextResponse.json(
        { error: "Unauthorized", message: "You are not a member of this group." },
        { status: 403 }
      )
    }

    const userRank = ROLE_HIERARCHY[effectiveRole] ?? 0
    const minRank = ROLE_HIERARCHY[minimumRole] ?? 0

    if (userRank >= minRank) {
      return { authorized: true, role: effectiveRole, ownerWallet, ownerUserId: room.created_by }
    }

    console.warn(
      `[requireGroupRole] wallet ${resolvedWallet.substring(0, 8)}... has role "${effectiveRole}" but "${minimumRole}" is required for group ${groupId}`
    )
    return NextResponse.json(
      {
        error: "Unauthorized",
        message: `You need the "${minimumRole}" role or higher to perform this action. Your current role is "${effectiveRole}".`,
        currentRole: effectiveRole,
        requiredRole: minimumRole,
      },
      { status: 403 }
    )
  } catch (err) {
    console.error("[requireGroupRole] unexpected error:", err)
    return NextResponse.json({ error: "Failed to verify role" }, { status: 500 })
  }
}

export default requireGroupRole
