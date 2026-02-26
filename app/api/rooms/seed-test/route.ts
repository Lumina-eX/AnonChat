import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

function makeInviteCode() {
  return Math.random().toString(36).slice(2, 10).toUpperCase()
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`

    const walletAddress =
      (user.user_metadata as any)?.wallet_address as string | undefined;

    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .insert({
        id: roomId,
        name: "Test Room",
        description: "Seeded test room for quick joining",
        is_private: false,
        created_by: user.id,
        owner_wallet: walletAddress || null,
      })
      .select()

    if (roomError) throw roomError

    const inviteCode = makeInviteCode()
    const { data: invite, error: inviteError } = await supabase
      .from("invites")
      .insert({ code: inviteCode, room_id: roomId, created_by: user.id })
      .select()

    if (inviteError) throw inviteError

    // add membership for creator
    await supabase.from("room_members").insert({ user_id: user.id, room_id: roomId })

    return NextResponse.json({ success: true, room: room?.[0], inviteCode })
  } catch (error) {
    console.error("POST /api/rooms/seed-test error:", error)
    return NextResponse.json({ error: "Failed to seed test room" }, { status: 500 })
  }
}
