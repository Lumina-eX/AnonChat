import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import { logInviteExpiration } from "@/lib/groups/invite";
import { recordGroupAuditEvent } from "@/lib/blockchain/audit";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: groupId } = await params;

  if (!groupId) {
    return NextResponse.json({ error: "Group ID is required" }, { status: 400 });
  }

  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify user is group owner or member
    const { data: group, error: groupError } = await supabase
      .from("rooms")
      .select("id, name, created_by")
      .eq("id", groupId)
      .maybeSingle();

    if (groupError) throw groupError;
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const isCreator = group.created_by === user.id;

    if (!isCreator) {
      const { data: membership } = await supabase
        .from("room_members")
        .select("user_id")
        .eq("room_id", groupId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!membership) {
        return NextResponse.json(
          { error: "Only group members can invalidate invite codes" },
          { status: 403 },
        );
      }
    }

    const body = await request.json().catch(() => ({}));
    const { invite_code, reason = "Manually invalidated by group owner" } = body as {
      invite_code?: string;
      reason?: string;
    };

    if (!invite_code) {
      return NextResponse.json(
        { error: "Invite code is required" },
        { status: 400 },
      );
    }

    // Verify the invite exists and belongs to this group
    const { data: invite, error: inviteError } = await supabase
      .from("invites")
      .select("code, room_id")
      .eq("code", invite_code.trim())
      .maybeSingle();

    if (inviteError) throw inviteError;
    if (!invite) {
      return NextResponse.json(
        { error: "Invite code not found" },
        { status: 404 },
      );
    }

    if (invite.room_id !== groupId) {
      return NextResponse.json(
        { error: "Invite code does not belong to this group" },
        { status: 403 },
      );
    }

    // Log the invalidation
    await logInviteExpiration(
      supabase,
      invite_code,
      groupId,
      "manually_invalidated",
      {
        invalidated_by: user.id,
        reason: reason,
        invalidated_at: new Date().toISOString(),
      },
    );

    // Record audit event
    await recordGroupAuditEvent({
      supabase,
      groupId,
      eventType: "invite_expired",
      actorUserId: user.id,
      metadata: {
        invite_code: invite_code,
        reason: "manually_invalidated",
        invalidation_reason: reason,
        invalidated_by: user.id,
      },
    });

    console.info(
      `[invalidate-invite] Invite ${invite_code} invalidated in group ${groupId} by user ${user.id}`,
    );

    return NextResponse.json(
      {
        success: true,
        message: "Invite code has been invalidated",
        invite: {
          code: invite_code,
          group_id: groupId,
          invalidated_at: new Date().toISOString(),
          reason: reason,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error(
      `[invalidate-invite] POST /api/groups/${groupId}/invites/invalidate error:`,
      error,
    );
    return NextResponse.json(
      { error: "Failed to invalidate invite code" },
      { status: 500 },
    );
  }
}
