import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { searchParams } = new URL(request.url)
    const roomId = searchParams.get("room_id")
    const rawLimit = Number.parseInt(searchParams.get("limit") || "50")
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50
    const rawOffset = Number.parseInt(searchParams.get("offset") || "0")
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0
    const before = searchParams.get("before")

    if (!roomId) {
      return NextResponse.json({ error: "room_id is required" }, { status: 400 })
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized. You must be logged in to view messages." }, { status: 401 })
    }

    // Verify user is a member of this room
    const { data: membership, error: memberErr } = await supabase
      .from("room_members")
      .select("id, removed_at")
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (memberErr) throw memberErr

    if (!membership) {
      return NextResponse.json({ error: "Forbidden. You are not a member of this room." }, { status: 403 })
    }

    if (membership.removed_at) {
      return NextResponse.json({ error: "Forbidden. You have been removed from this room." }, { status: 403 })
    }

    const pageLimit = Math.min(limit + 1, 101)

    let query = supabase
      .from("messages")
      .select("*, profiles(display_name, avatar_url)")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })

    if (before) {
      query = query.lt("created_at", before).range(0, pageLimit - 1)
    } else {
      query = query.range(offset, offset + pageLimit - 1)
    }

    const { data, error } = await query

    if (error) throw error

    const messages = Array.isArray(data) ? [...data] : []
    const hasMore = messages.length > limit
    if (hasMore) {
      messages.pop()
    }

    const lastMessage = messages[messages.length - 1] as { created_at?: string } | undefined
    const nextCursor = hasMore && lastMessage?.created_at ? lastMessage.created_at : null

    return NextResponse.json({ messages, hasMore, nextCursor })
  } catch (error) {
    console.error("[v0] GET /api/messages error:", error)
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
  }
}

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
    const { room_id, content } = body

    if (!room_id || !content) {
      return NextResponse.json({ error: "room_id and content are required" }, { status: 400 })
    }

    const { data: membership, error: memberErr } = await supabase
      .from("room_members")
      .select("id, removed_at")
      .eq("room_id", room_id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (memberErr) throw memberErr

    if (membership?.removed_at) {
      return NextResponse.json(
        { error: "You have been removed from this room and cannot send messages" },
        { status: 403 }
      )
    }

    if (!membership) {
      const { error: insertMemberErr } = await supabase.from("room_members").insert({
        room_id,
        user_id: user.id,
      })
      if (insertMemberErr) throw insertMemberErr
    }

    const { data, error } = await supabase
      .from("messages")
      .insert({
        user_id: user.id,
        room_id,
        content,
        is_encrypted: false,
      })
      .select()

    if (error) throw error

    return NextResponse.json({ message: data[0], success: true }, { status: 201 })
  } catch (error) {
    console.error("[v0] POST /api/messages error:", error)
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 })
  }
}
