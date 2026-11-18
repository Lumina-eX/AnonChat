import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import {
  ensureWalletMatchesUser,
  resolveWalletFromUser,
  verifyWalletAuthorization,
} from "@/lib/auth/wallet-authorization"
import { validateWalletAddressWithMessage } from "@/lib/auth/validation"
import { requireGroupRole } from "@/lib/middleware/group-roles"
import { recordGroupAuditEvent } from "@/lib/blockchain/audit"
import { insertRoomActivity } from "@/lib/activity/room-activity"
import {
  notifyMemberRemoved,
  pushMemberRemovalRealtime,
} from "@/lib/notifications/service"
import type { SupabaseClient } from "@supabase/supabase-js"

type RemoveMemberBody = {
  walletAddress?: string
  signature?: string
  targetWallet?: string
}

type RemoveMemberRpcResult = {
  group_membership_id: string
  room_membership_id: string | null
  target_user_id: string | null
}

/**
 * DELETE /api/groups/[id]/members
 *
 * Removes a wallet member from group_membership and revokes any matching
 * room_members access. Only owners and moderators may remove members.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
      console.error("[groups/members] auth error:", authError)
      return NextResponse.json(
        { error: "Unable to verify authentication" },
        { status: 401 },
      )
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body: RemoveMemberBody = await request.json().catch(() => ({}))
    const { targetWallet } = body

    if (!targetWallet || typeof targetWallet !== "string") {
      return NextResponse.json(
        { error: "targetWallet is required" },
        { status: 400 },
      )
    }

    const targetWalletError = validateWalletAddressWithMessage(targetWallet)
    if (targetWalletError) {
      return NextResponse.json({ error: targetWalletError }, { status: 400 })
    }

    const auth = await verifyWalletAuthorization(body, "remove_member")
    if (!auth.ok) {
      return auth.response
    }

    const { data: callerProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError) {
      console.error("[groups/members] caller profile lookup error:", profileError)
      return NextResponse.json(
        { error: "Failed to retrieve caller profile" },
        { status: 500 },
      )
    }

    const callerWallet = resolveWalletFromUser(user, callerProfile)
    const walletMismatch = ensureWalletMatchesUser(auth.walletAddress, callerWallet)
    if (walletMismatch) {
      return walletMismatch
    }

    if (targetWallet === callerWallet) {
      return NextResponse.json(
        { error: "You cannot remove yourself from the group" },
        { status: 400 },
      )
    }

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

    const { data: group, error: groupError } = await supabase
      .from("rooms")
      .select("id, name, owner_wallet, created_by")
      .eq("id", groupId)
      .maybeSingle()

    if (groupError) {
      console.error("[groups/members] group lookup error:", groupError)
      return NextResponse.json(
        { error: "Failed to retrieve group" },
        { status: 500 },
      )
    }

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 })
    }

    const { data: targetMembership, error: targetError } = await supabase
      .from("group_membership")
      .select("id, wallet_address, role, joined_at")
      .eq("group_id", groupId)
      .eq("wallet_address", targetWallet)
      .maybeSingle()

    if (targetError) {
      console.error("[groups/members] target member lookup error:", targetError)
      return NextResponse.json(
        { error: "Failed to look up target member" },
        { status: 500 },
      )
    }

    if (!targetMembership) {
      return NextResponse.json(
        { error: "Target wallet is not a member of this group" },
        { status: 404 },
      )
    }

    if (targetWallet === group.owner_wallet || targetMembership.role === "owner") {
      return NextResponse.json(
        { error: "The group owner cannot be removed" },
        { status: 403 },
      )
    }

    const { data: targetProfile, error: targetProfileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("wallet_address", targetWallet)
      .maybeSingle()

    if (targetProfileError) {
      console.error("[groups/members] target profile lookup error:", targetProfileError)
      return NextResponse.json(
        { error: "Failed to look up target user" },
        { status: 500 },
      )
    }

    const { data: rpcData, error: rpcError } = await supabase
      .rpc("remove_group_member", {
        p_group_id: groupId,
        p_target_wallet: targetWallet,
        p_actor_wallet: callerWallet,
      })
      .maybeSingle()

    if (rpcError) {
      if (rpcError.code === "P0002") {
        return NextResponse.json(
          { error: "Target wallet is not a member of this group" },
          { status: 404 },
        )
      }
      if (rpcError.code === "42501") {
        return NextResponse.json(
          { error: "Forbidden. Only group owners and moderators can remove members." },
          { status: 403 },
        )
      }
      if (rpcError.code === "22023") {
        return NextResponse.json(
          { error: "The group owner cannot be removed" },
          { status: 403 },
        )
      }

      console.error("[groups/members] removal RPC error:", rpcError)
      return NextResponse.json(
        { error: "Failed to remove group member" },
        { status: 500 },
      )
    }

    const removal = rpcData as RemoveMemberRpcResult | null
    const targetUserId = removal?.target_user_id ?? targetProfile?.id ?? null

    const audit = await recordGroupAuditEvent({
      supabase,
      groupId,
      eventType: "member_removed",
      actorUserId: user.id,
      targetUserId,
      metadata: {
        target_wallet: targetWallet,
        target_role: targetMembership.role,
        group_membership_id: removal?.group_membership_id ?? targetMembership.id,
        room_membership_id: removal?.room_membership_id ?? null,
        removal_method: "owner_or_moderator_api",
      },
    })

    try {
      await insertRoomActivity(supabase as unknown as SupabaseClient, {
        room_id: groupId,
        event_type: "member_removed",
        actor_user_id: user.id,
        target_user_id: targetUserId,
        metadata: {
          target_wallet: targetWallet,
          target_role: targetMembership.role,
        },
      })
    } catch (activityError) {
      console.warn("[groups/members] failed to write room activity:", activityError)
    }

    let notification = null
    let realtime = null
    if (targetUserId) {
      const notificationResult = await notifyMemberRemoved(
        supabase,
        targetUserId,
        groupId,
        group.name,
        targetWallet,
      )
      notification = notificationResult.notification

      if (!notificationResult.delivered && notificationResult.deliveryError) {
        console.warn(
          `[groups/members] notification delivery failed for ${targetUserId}: ${notificationResult.deliveryError}`,
        )
      }

      realtime = await pushMemberRemovalRealtime(targetUserId, groupId, {
        targetWallet,
        removedBy: user.id,
      })
    }

    console.info(
      `[groups/members] wallet ${targetWallet.slice(0, 8)}... removed from group ${groupId} by ${user.id} (${roleCheck.role})`,
    )

    return NextResponse.json({
      success: true,
      group_id: groupId,
      target_wallet: targetWallet,
      target_user_id: targetUserId,
      removed_role: targetMembership.role,
      audit: audit ?? undefined,
      notification: notification ?? undefined,
      realtime: realtime ?? undefined,
    })
  } catch (error) {
    console.error(`[groups/members] DELETE /api/groups/${groupId} error:`, error)
    return NextResponse.json(
      { error: "Failed to remove group member" },
      { status: 500 },
    )
  }
}
