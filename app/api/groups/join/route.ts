import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { validateInviteCode, incrementInviteUseCount } from "@/lib/groups/invite"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: "Request body is required" }, { status: 400 })
    }

    const { code } = body as { code?: string }

    const validation = await validateInviteCode(supabase, code ?? "")

    if (!validation.valid) {
      console.warn(
        `[groups/join] Invalid invite attempt — user: ${user.id}, code: ${code ?? "(none)"}, reason: ${validation.error}`
      )
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    const { roomId, inviteCode } = validation

    // Verify the group still exists
    const { data: group } = await supabase
      .from("rooms")
      .select("id, name")
      .eq("id", roomId)
      .maybeSingle()

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 })
    }

    // Insert membership record
    const { data: membership, error: membershipError } = await supabase
      .from("room_members")
      .insert({ user_id: user.id, room_id: roomId })
      .select("user_id, room_id, joined_at")
      .single()

    if (membershipError) {
      // Unique constraint violation — user is already a member
      if (membershipError.code === "23505") {
        console.info(`[groups/join] User ${user.id} is already a member of group ${roomId}`)
        return NextResponse.json({ success: true, message: "Already a member" })
      }
      throw membershipError
    }

    // Atomically increment invite usage count (non-blocking on failure)
    await incrementInviteUseCount(supabase, inviteCode)

    console.info(
      `[groups/join] User ${user.id} joined group ${roomId} via invite code ${inviteCode}`
    )

    return NextResponse.json({
      success: true,
      group: { id: group.id, name: group.name },
      membership: {
        user_id: membership.user_id,
        group_id: membership.room_id,
        joined_at: membership.joined_at,
      },
    })
  } catch (error) {
    console.error("[groups/join] POST /api/groups/join error:", error)
    return NextResponse.json({ error: "Failed to join group" }, { status: 500 })
  }
}
