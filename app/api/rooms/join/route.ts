import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { validateInviteCode, incrementInviteUseCount } from "@/lib/groups/invite"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { inviteCode, groupId } = body as { inviteCode?: string; groupId?: string }

    if (!inviteCode && !groupId) {
      return NextResponse.json({ error: "inviteCode or groupId is required" }, { status: 400 })
    }

    let roomId: string | undefined = groupId
    let validatedCode: string | undefined

    if (inviteCode) {
      const validation = await validateInviteCode(supabase, inviteCode)

      if (!validation.valid) {
        console.warn(
          `[rooms/join] Invalid invite attempt — user: ${user.id}, code: ${inviteCode}, reason: ${validation.error}`
        )
        return NextResponse.json({ error: validation.error }, { status: validation.status })
      }

      roomId = validation.roomId
      validatedCode = validation.inviteCode
    }

    // verify room exists
    const { data: room } = await supabase.from("rooms").select("id").eq("id", roomId).maybeSingle()
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 })

    // insert membership
    const { data: membership, error: membershipError } = await supabase
      .from("room_members")
      .insert({ user_id: user.id, room_id: roomId })
      .select()

    if (membershipError) {
      // unique violation -> already a member
      if (membershipError.code === "23505") {
        return NextResponse.json({ message: "Already a member", success: true })
      }
      throw membershipError
    }

    if (validatedCode) {
      await incrementInviteUseCount(supabase, validatedCode)
      console.info(`[rooms/join] User ${user.id} joined room ${roomId} via invite code ${validatedCode}`)
    }

    return NextResponse.json({ success: true, membership: membership?.[0] })
  } catch (error) {
    console.error("POST /api/rooms/join error:", error)
    return NextResponse.json({ error: "Failed to join room" }, { status: 500 })
  }
}
