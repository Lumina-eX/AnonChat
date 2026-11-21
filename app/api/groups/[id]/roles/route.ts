/**
 * Group Member Role Management API
 *
 * GET    /api/groups/[id]/roles       - List all members with their roles
 * POST   /api/groups/[id]/roles       - Assign or update a member's role (owner/moderator only)
 * DELETE /api/groups/[id]/roles       - Revoke a member's elevated role (set back to 'member')
 *
 * Requires:
 * 1. Supabase session authentication
 * 2. Wallet signature over a one-time nonce (proves wallet ownership)
 * 3. Caller must have sufficient role permissions
 *
 * Role hierarchy: owner > moderator > member
 * - Owner has full control
 * - Moderator can manage members and moderate content
 * - Member is a standard participant
 */

import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import {
  ensureWalletMatchesUser,
  resolveWalletFromUser,
  verifyWalletAuthorization,
} from "@/lib/auth/wallet-authorization"
import { auditLog } from "@/lib/auth/signed-message-middleware"
import { requireGroupRole } from "@/lib/middleware/group-roles"
import type { GroupRole } from "@/lib/middleware/group-roles"

// ── Request body types ───────────────────────────────────────────────────────

type AssignRoleBody = {
  walletAddress?: string
  signature?: string
  targetWallet?: string
  role?: string
}

type RevokeRoleBody = {
  walletAddress?: string
  signature?: string
  targetWallet?: string
}

// ── GET: List members with roles ─────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: groupId } = await params

  if (!groupId) {
    return NextResponse.json({ error: "Group ID is required" }, { status: 400 })
  }

  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError) {
      console.error("[groups/roles] auth error:", authError)
      return NextResponse.json(
        { error: "Unable to verify authentication" },
        { status: 401 }
      )
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Verify the group exists
    const { data: group, error: groupError } = await supabase
      .from("rooms")
      .select("id, name, created_by")
      .eq("id", groupId)
      .maybeSingle()

    if (groupError) {
      console.error("[groups/roles] group lookup error:", groupError)
      return NextResponse.json(
        { error: "Failed to retrieve group" },
        { status: 500 }
      )
    }

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 })
    }

    // Fetch all members with their roles via the helper function
    const { data: members, error: membersError } = await supabase
      .rpc("get_group_members_with_roles", { p_group_id: groupId })

    if (membersError) {
      // Fallback: query the table directly if the RPC is not yet created
      console.warn(
        "[groups/roles] RPC get_group_members_with_roles not available, using direct query:",
        membersError
      )

      const { data: directMembers, error: directError } = await supabase
        .from("group_membership")
        .select("wallet_address, role, joined_at")
        .eq("group_id", groupId)
        .order("joined_at", { ascending: true })

      if (directError) {
        console.error("[groups/roles] member fetch error:", directError)
        return NextResponse.json(
          { error: "Failed to fetch members" },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        group_id: groupId,
        members: (directMembers ?? []).map((m: { wallet_address: string; role: string; joined_at: string }) => ({
          wallet_address: m.wallet_address,
          role: m.role,
          joined_at: m.joined_at,
        })),
      })
    }

    return NextResponse.json({
      success: true,
      group_id: groupId,
      members: (members ?? []).map((m: { wallet_address: string; role: string; joined_at: string }) => ({
        wallet_address: m.wallet_address,
        role: m.role,
        joined_at: m.joined_at,
      })),
    })
  } catch (error) {
    console.error(
      `[groups/roles] GET /api/groups/${groupId}/roles error:`,
      error
    )
    return NextResponse.json(
      { error: "Failed to fetch member roles" },
      { status: 500 }
    )
  }
}

// ── POST: Assign or update a role ────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: groupId } = await params

  if (!groupId) {
    return NextResponse.json({ error: "Group ID is required" }, { status: 400 })
  }

  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError) {
      console.error("[groups/roles] auth error:", authError)
      return NextResponse.json(
        { error: "Unable to verify authentication" },
        { status: 401 }
      )
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body: AssignRoleBody = await request.json().catch(() => ({}))

    // Verify wallet signature for authorization
    const auth = await verifyWalletAuthorization(body, "assign_role", {
      supabase,
      groupId,
    })
    if (!auth.ok) {
      return auth.response
    }

    // Validate caller identity
    const { data: callerProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError) {
      console.error("[groups/roles] profile lookup error:", profileError)
      return NextResponse.json(
        { error: "Failed to retrieve caller profile" },
        { status: 500 }
      )
    }

    const callerWallet = resolveWalletFromUser(user, callerProfile)
    const walletMismatch = ensureWalletMatchesUser(
      auth.walletAddress,
      callerWallet
    )
    if (walletMismatch) {
      return walletMismatch
    }

    // Verify the group exists
    const { data: group, error: groupError } = await supabase
      .from("rooms")
      .select("id, name, created_by, owner_wallet")
      .eq("id", groupId)
      .maybeSingle()

    if (groupError) {
      console.error("[groups/roles] group lookup error:", groupError)
      return NextResponse.json(
        { error: "Failed to retrieve group" },
        { status: 500 }
      )
    }

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 })
    }

    // ── Validate request body ───────────────────────────────────────────────
    const { targetWallet, role } = body

    if (!targetWallet || typeof targetWallet !== "string") {
      return NextResponse.json(
        { error: "targetWallet is required" },
        { status: 400 }
      )
    }

    if (!role || typeof role !== "string") {
      return NextResponse.json(
        { error: "role is required" },
        { status: 400 }
      )
    }

    const validRoles: GroupRole[] = ["owner", "moderator", "member"]
    if (!validRoles.includes(role as GroupRole)) {
      return NextResponse.json(
        {
          error: `Invalid role. Must be one of: ${validRoles.join(", ")}`,
        },
        { status: 400 }
      )
    }

    // ── Check caller has sufficient permissions ─────────────────────────────
    // Only owners can assign the "owner" role
    // Owners and moderators can assign "moderator" and "member" roles
    const requiredRole: GroupRole = role === "owner" ? "owner" : "moderator"

    const roleCheck = await requireGroupRole({
      supabase,
      groupId,
      minimumRole: requiredRole,
      callerWallet,
      userId: user.id,
    })

    if (roleCheck instanceof NextResponse) {
      return roleCheck
    }

    // ── Verify target is a member of the group ─────────────────────────────
    const { data: targetMembership, error: targetError } = await supabase
      .from("group_membership")
      .select("wallet_address, role")
      .eq("group_id", groupId)
      .eq("wallet_address", targetWallet)
      .maybeSingle()

    if (targetError) {
      console.error("[groups/roles] target member lookup error:", targetError)
      return NextResponse.json(
        { error: "Failed to look up target member" },
        { status: 500 }
      )
    }

    if (!targetMembership) {
      return NextResponse.json(
        { error: "Target wallet is not a member of this group" },
        { status: 404 }
      )
    }

    // ── Prevent changing the room owner's role ─────────────────────────────
    if (
      group.owner_wallet === targetWallet &&
      role !== "owner"
    ) {
      return NextResponse.json(
        {
          error:
            "Cannot change the primary owner's role. The owner always has the 'owner' role.",
        },
        { status: 403 }
      )
    }

    // ── Update the role ────────────────────────────────────────────────────
    const { error: updateError } = await supabase
      .from("group_membership")
      .update({ role })
      .eq("group_id", groupId)
      .eq("wallet_address", targetWallet)

    if (updateError) {
      console.error("[groups/roles] role update error:", updateError)
      return NextResponse.json(
        { error: "Failed to update member role" },
        { status: 500 }
      )
    }

    // ── Audit log ──────────────────────────────────────────────────────────
    auditLog("assign_role", auth.walletAddress, {
      groupId,
      targetWallet,
      previousRole: targetMembership.role,
      newRole: role,
      assignedBy: user.id,
    })

    console.info(
      `[groups/roles] Role "${role}" assigned to wallet ${targetWallet.substring(0, 8)}... in group ${groupId} by user ${user.id}`
    )

    return NextResponse.json(
      {
        success: true,
        group_id: groupId,
        target_wallet: targetWallet,
        role,
        previous_role: targetMembership.role,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error(
      `[groups/roles] POST /api/groups/${groupId}/roles error:`,
      error
    )
    return NextResponse.json(
      { error: "Failed to assign role" },
      { status: 500 }
    )
  }
}

// ── DELETE: Revoke a role (set back to 'member') ─────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: groupId } = await params

  if (!groupId) {
    return NextResponse.json({ error: "Group ID is required" }, { status: 400 })
  }

  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError) {
      console.error("[groups/roles] auth error:", authError)
      return NextResponse.json(
        { error: "Unable to verify authentication" },
        { status: 401 }
      )
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body: RevokeRoleBody = await request.json().catch(() => ({}))

    // Verify wallet signature for authorization
    const auth = await verifyWalletAuthorization(body, "revoke_role", {
      supabase,
      groupId,
    })
    if (!auth.ok) {
      return auth.response
    }

    // Validate caller identity
    const { data: callerProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError) {
      console.error("[groups/roles] profile lookup error:", profileError)
      return NextResponse.json(
        { error: "Failed to retrieve caller profile" },
        { status: 500 }
      )
    }

    const callerWallet = resolveWalletFromUser(user, callerProfile)
    const walletMismatch = ensureWalletMatchesUser(
      auth.walletAddress,
      callerWallet
    )
    if (walletMismatch) {
      return walletMismatch
    }

    // Verify the group exists
    const { data: group, error: groupError } = await supabase
      .from("rooms")
      .select("id, name, created_by, owner_wallet")
      .eq("id", groupId)
      .maybeSingle()

    if (groupError) {
      console.error("[groups/roles] group lookup error:", groupError)
      return NextResponse.json(
        { error: "Failed to retrieve group" },
        { status: 500 }
      )
    }

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 })
    }

    const { targetWallet } = body

    if (!targetWallet || typeof targetWallet !== "string") {
      return NextResponse.json(
        { error: "targetWallet is required" },
        { status: 400 }
      )
    }

    // ── Check caller has sufficient permissions ─────────────────────────────
    // Only owners can revoke roles from moderators
    // Owners and moderators can revoke roles from members
    const roleCheck = await requireGroupRole({
      supabase,
      groupId,
      minimumRole: "moderator",
      callerWallet,
      userId: user.id,
    })

    if (roleCheck instanceof NextResponse) {
      return roleCheck
    }

    // ── Get target member's current role ────────────────────────────────────
    const { data: targetMembership, error: targetError } = await supabase
      .from("group_membership")
      .select("wallet_address, role")
      .eq("group_id", groupId)
      .eq("wallet_address", targetWallet)
      .maybeSingle()

    if (targetError) {
      console.error("[groups/roles] target member lookup error:", targetError)
      return NextResponse.json(
        { error: "Failed to look up target member" },
        { status: 500 }
      )
    }

    if (!targetMembership) {
      return NextResponse.json(
        { error: "Target wallet is not a member of this group" },
        { status: 404 }
      )
    }

    // ── Prevent revoking the owner's role ──────────────────────────────────
    if (targetMembership.role === "owner") {
      return NextResponse.json(
        {
          error:
            "Cannot revoke the owner's role. Transfer ownership first.",
        },
        { status: 403 }
      )
    }

    // ── Only owners can revoke moderator roles ─────────────────────────────
    if (targetMembership.role === "moderator" && roleCheck.role !== "owner") {
      return NextResponse.json(
        {
          error:
            "Only owners can revoke moderator roles.",
        },
        { status: 403 }
      )
    }

    // If already a member, nothing to revoke
    if (targetMembership.role === "member") {
      return NextResponse.json(
        {
          success: true,
          message: "Target is already a member with no elevated role.",
          group_id: groupId,
          target_wallet: targetWallet,
          role: "member",
        },
        { status: 200 }
      )
    }

    // ── Revoke the role (set back to member) ───────────────────────────────
    const { error: updateError } = await supabase
      .from("group_membership")
      .update({ role: "member" })
      .eq("group_id", groupId)
      .eq("wallet_address", targetWallet)

    if (updateError) {
      console.error("[groups/roles] role revocation error:", updateError)
      return NextResponse.json(
        { error: "Failed to revoke role" },
        { status: 500 }
      )
    }

    // ── Audit log ──────────────────────────────────────────────────────────
    auditLog("revoke_role", auth.walletAddress, {
      groupId,
      targetWallet,
      previousRole: targetMembership.role,
      revokedBy: user.id,
    })

    console.info(
      `[groups/roles] Role revoked for wallet ${targetWallet.substring(0, 8)}... in group ${groupId} by user ${user.id}`
    )

    return NextResponse.json(
      {
        success: true,
        group_id: groupId,
        target_wallet: targetWallet,
        previous_role: targetMembership.role,
        role: "member",
      },
      { status: 200 }
    )
  } catch (error) {
    console.error(
      `[groups/roles] DELETE /api/groups/${groupId}/roles error:`,
      error
    )
    return NextResponse.json(
      { error: "Failed to revoke role" },
      { status: 500 }
    )
  }
}
