import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import {
  generateInviteCode,
  buildExpiresAt,
} from "@/lib/groups/invite"

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
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Verify the group exists
    const { data: group, error: groupError } = await supabase
      .from("rooms")
      .select("id, name, created_by, is_private")
      .eq("id", groupId)
      .maybeSingle()

    if (groupError) throw groupError
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 })
    }

    // Only the group creator or an existing member can generate an invite
    const isCreator = group.created_by === user.id

    if (!isCreator) {
      const { data: membership } = await supabase
        .from("room_members")
        .select("user_id")
        .eq("room_id", groupId)
        .eq("user_id", user.id)
        .maybeSingle()

      if (!membership) {
        return NextResponse.json(
          { error: "Only group members can generate invite codes" },
          { status: 403 }
        )
      }
    }

    const body = await request.json().catch(() => ({}))
    const { expires_in, max_uses } = body as {
      expires_in?: number
      max_uses?: number
    }

    if (max_uses !== undefined && (!Number.isInteger(max_uses) || max_uses < 1)) {
      return NextResponse.json(
        { error: "max_uses must be a positive integer" },
        { status: 400 }
      )
    }

    if (expires_in !== undefined && (!Number.isInteger(expires_in) || expires_in < 1)) {
      return NextResponse.json(
        { error: "expires_in must be a positive integer (seconds)" },
        { status: 400 }
      )
    }

    const code = generateInviteCode()
    const expiresAt = buildExpiresAt(expires_in)

    const { data: invite, error: insertError } = await supabase
      .from("invites")
      .insert({
        code,
        room_id: groupId,
        created_by: user.id,
        expires_at: expiresAt,
        max_uses: max_uses ?? null,
        use_count: 0,
      })
      .select("code, room_id, created_at, expires_at, max_uses")
      .single()

    if (insertError) throw insertError

    console.info(`[groups/invite] Invite code generated for group ${groupId} by user ${user.id}`)

    return NextResponse.json(
      {
        success: true,
        invite: {
          code: invite.code,
          group_id: invite.room_id,
          created_at: invite.created_at,
          expires_at: invite.expires_at,
          max_uses: invite.max_uses,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error(`[groups/invite] POST /api/groups/${groupId}/invite error:`, error)
    return NextResponse.json({ error: "Failed to generate invite code" }, { status: 500 })
  }
}
