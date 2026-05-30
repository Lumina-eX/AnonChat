import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

/**
 * POST /api/messages/read
 * Mark one or more messages as read by the authenticated user.
 * Body: { message_ids: string[], room_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { message_ids, room_id } = body

    if (!message_ids || !Array.isArray(message_ids) || message_ids.length === 0) {
      return NextResponse.json(
        { error: "message_ids must be a non-empty array" },
        { status: 400 },
      )
    }

    if (!room_id) {
      return NextResponse.json(
        { error: "room_id is required" },
        { status: 400 },
      )
    }

    // Verify user is an active member of this room
    const { data: membership, error: memberErr } = await supabase
      .from("room_members")
      .select("id, removed_at")
      .eq("room_id", room_id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (memberErr) throw memberErr

    if (!membership || membership.removed_at) {
      return NextResponse.json(
        { error: "Forbidden. You are not an active member of this room." },
        { status: 403 },
      )
    }

    // Upsert read receipts (ON CONFLICT DO NOTHING — don't overwrite earlier reads)
    const readRows = message_ids.map((message_id: string) => ({
      message_id,
      user_id: user.id,
    }))

    const { data, error } = await supabase
      .from("message_reads")
      .upsert(readRows, {
        onConflict: "message_id,user_id",
        ignoreDuplicates: true,
      })
      .select()

    if (error) throw error

    return NextResponse.json({
      success: true,
      reads: data,
    })
  } catch (error) {
    console.error("[v0] POST /api/messages/read error:", error)
    return NextResponse.json(
      { error: "Failed to mark messages as read" },
      { status: 500 },
    )
  }
}

/**
 * GET /api/messages/read
 * Fetch read receipts for messages in a room.
 * Query: ?room_id=...&message_ids=id1,id2,id3
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const roomId = searchParams.get("room_id")
    const messageIdsParam = searchParams.get("message_ids")

    if (!roomId) {
      return NextResponse.json(
        { error: "room_id is required" },
        { status: 400 },
      )
    }

    // Verify room membership
    const { data: membership, error: memberErr } = await supabase
      .from("room_members")
      .select("id, removed_at")
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (memberErr) throw memberErr

    if (!membership || membership.removed_at) {
      return NextResponse.json(
        { error: "Forbidden. You are not an active member of this room." },
        { status: 403 },
      )
    }

    // Build query — optionally filter by specific message IDs
    let query = supabase
      .from("message_reads")
      .select("message_id, user_id, read_at")

    if (messageIdsParam) {
      const messageIds = messageIdsParam.split(",").filter(Boolean)
      if (messageIds.length > 0) {
        query = query.in("message_id", messageIds)
      }
    }

    // Only return reads for messages in the specified room
    // We need to join through messages to filter by room_id
    // Since Supabase doesn't support filtering through foreign keys in .select,
    // we query the message IDs in this room first, then filter reads
    const { data: roomMessages, error: roomMsgErr } = await supabase
      .from("messages")
      .select("id")
      .eq("room_id", roomId)

    if (roomMsgErr) throw roomMsgErr

    const roomMessageIds = roomMessages?.map((m) => m.id) || []

    if (roomMessageIds.length === 0) {
      return NextResponse.json({ reads: [] })
    }

    // If specific message_ids were requested, intersect with room messages
    let targetIds = roomMessageIds
    if (messageIdsParam) {
      const requestedIds = new Set(messageIdsParam.split(",").filter(Boolean))
      targetIds = roomMessageIds.filter((id) => requestedIds.has(id))
    }

    if (targetIds.length === 0) {
      return NextResponse.json({ reads: [] })
    }

    const { data: reads, error: readsErr } = await supabase
      .from("message_reads")
      .select("message_id, user_id, read_at")
      .in("message_id", targetIds)

    if (readsErr) throw readsErr

    return NextResponse.json({ reads: reads || [] })
  } catch (error) {
    console.error("[v0] GET /api/messages/read error:", error)
    return NextResponse.json(
      { error: "Failed to fetch read receipts" },
      { status: 500 },
    )
  }
}
