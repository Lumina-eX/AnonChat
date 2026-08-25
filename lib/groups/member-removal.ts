import { NextResponse } from "next/server"
import { recordGroupAuditEvent } from "@/lib/blockchain/audit"
import { notifyMemberRemoved } from "@/lib/notifications/service"
import { requireGroupRole } from "@/lib/middleware/group-roles"

export type RemoveGroupMemberParams = {
  supabase: any
  groupId: string
  callerWallet?: string | null
  targetWallet: string
  actorUserId?: string | null
  groupName?: string
  adminAccess?: boolean
}

export async function removeGroupMember({
  supabase,
  groupId,
  callerWallet,
  targetWallet,
  actorUserId,
  groupName,
  adminAccess,
}: RemoveGroupMemberParams): Promise<NextResponse | { success: true; group_id: string; target_wallet: string; message: string; audit?: any; notification?: any } | { success: false; error: string; status: number }> {
  try {
    if (!groupId) {
      return NextResponse.json({ error: "Group ID is required" }, { status: 400 })
    }

    if (!targetWallet || typeof targetWallet !== "string") {
      return NextResponse.json({ error: "targetWallet is required" }, { status: 400 })
    }

    const { data: group, error: groupError } = await supabase
      .from("rooms")
      .select("id, name, created_by, owner_wallet")
      .eq("id", groupId)
      .maybeSingle()

    if (groupError) {
      console.error("[groups/member-removal] group lookup error:", groupError)
      return NextResponse.json({ error: "Failed to retrieve group" }, { status: 500 })
    }

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 })
    }

    if (adminAccess === false) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You do not have permission to remove group members." },
        { status: 403 },
      )
    }

    const roleCheck = await requireGroupRole({
      supabase,
      groupId,
      minimumRole: "moderator",
      callerWallet,
      userId: actorUserId,
    })

    if (roleCheck instanceof NextResponse) {
      return roleCheck
    }

    if (roleCheck.role !== "owner" && roleCheck.role !== "moderator") {
      return NextResponse.json(
        { error: "Unauthorized", message: "Only owners and moderators can remove members." },
        { status: 403 },
      )
    }

    const { data: targetMembership, error: targetError } = await supabase
      .from("group_membership")
      .select("wallet_address, role")
      .eq("group_id", groupId)
      .eq("wallet_address", targetWallet)
      .maybeSingle()

    if (targetError) {
      console.error("[groups/member-removal] target lookup error:", targetError)
      return NextResponse.json({ error: "Failed to look up target member" }, { status: 500 })
    }

    if (!targetMembership) {
      return NextResponse.json({ error: "Target wallet is not a member of this group" }, { status: 404 })
    }

    if (group.owner_wallet === targetWallet || targetMembership.role === "owner") {
      return NextResponse.json(
        { error: "The group owner cannot be removed by moderators." },
        { status: 403 },
      )
    }

    if (roleCheck.role === "moderator" && targetMembership.role === "moderator") {
      return NextResponse.json(
        { error: "Moderators cannot remove other moderators." },
        { status: 403 },
      )
    }

    const removedUserProfile = await resolveRemovedUserProfile(supabase, targetWallet)

    if (removedUserProfile) {
      const { error: roomUpdateError } = await supabase
        .from("room_members")
        .update({ removed_at: new Date().toISOString() })
        .eq("room_id", groupId)
        .eq("user_id", removedUserProfile.id)
        .is("removed_at", null)

      if (roomUpdateError) {
        console.error("[groups/member-removal] room membership revoke error:", roomUpdateError)
        return NextResponse.json({ error: "Failed to revoke group access" }, { status: 500 })
      }
    }

    const { error: deleteError } = await supabase
      .from("group_membership")
      .delete()
      .eq("group_id", groupId)
      .eq("wallet_address", targetWallet)

    if (deleteError) {
      console.error("[groups/member-removal] delete error:", deleteError)
      return NextResponse.json({ error: "Failed to remove member" }, { status: 500 })
    }

    const auditEvent = await recordGroupAuditEvent({
      supabase,
      groupId,
      eventType: "member_removed",
      actorUserId: actorUserId ?? null,
      targetUserId: removedUserProfile?.id ?? null,
      metadata: {
        removed_wallet: targetWallet,
        removed_role: targetMembership.role,
        removed_by_role: roleCheck.role,
        removed_user_id: removedUserProfile?.id ?? null,
      },
    })

    const removedUserId = await resolveRemovedUserId(supabase, targetWallet)
    const notification =
      removedUserId && groupName
        ? await notifyMemberRemoved(supabase, removedUserId, groupId, groupName)
        : null

    return {
      success: true,
      group_id: groupId,
      target_wallet: targetWallet,
      message: "Member removed from the group",
      audit: auditEvent ?? undefined,
      notification: notification?.notification ?? undefined,
    }
  } catch (error) {
    console.error("[groups/member-removal] unexpected error:", error)
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 })
  }
}

async function resolveRemovedUserProfile(supabase: any, walletAddress: string): Promise<{ id: string } | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("wallet_address", walletAddress)
    .maybeSingle()

  return profile ?? null
}

async function resolveRemovedUserId(supabase: any, walletAddress: string): Promise<string | null> {
  return (await resolveRemovedUserProfile(supabase, walletAddress))?.id ?? null
}
