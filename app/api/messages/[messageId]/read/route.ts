import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

/**
 * POST /api/messages/[messageId]/read
 * Mark a message as read by the current user
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  try {
    const { messageId } = await params
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!messageId) {
      return NextResponse.json({ error: "Message ID is required" }, { status: 400 })
    }

    // Verify message exists and user has access to the room
    const { data: message, error: messageError } = await supabase
      .from("messages")
      .select("id, room_id")
      .eq("id", messageId)
      .single()

    if (messageError || !message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 })
    }

    // Verify user is a member of the room
    const { data: membership, error: memberError } = await supabase
      .from("room_members")
      .select("id, removed_at")
      .eq("room_id", message.room_id)
      .eq("user_id", user.id)
      .single()

    if (memberError || !membership) {
      return NextResponse.json(
        { error: "You are not a member of this room" },
        { status: 403 },
      )
    }

    if (membership.removed_at) {
      return NextResponse.json(
        { error: "You have been removed from this room" },
        { status: 403 },
      )
    }

    // Insert or update the read receipt
    const { data: readReceipt, error: insertError } = await supabase
      .from("message_reads")
      .upsert(
        {
          message_id: messageId,
          user_id: user.id,
          read_at: new Date().toISOString(),
        },
        { onConflict: "message_id,user_id" },
      )
      .select()

    if (insertError) {
      console.error("[read-receipt] Error marking message as read:", insertError)
      throw insertError
    }

    return NextResponse.json(
      {
        success: true,
        readReceipt: readReceipt?.[0],
      },
      { status: 200 },
    )
  } catch (error) {
    console.error("[read-receipt] POST error:", error)
    return NextResponse.json(
      { error: "Failed to mark message as read" },
      { status: 500 },
    )
  }
}

/**
 * GET /api/messages/[messageId]/read
 * Get all read receipts for a message (who has read it and when)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  try {
    const { messageId } = await params
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!messageId) {
      return NextResponse.json({ error: "Message ID is required" }, { status: 400 })
    }

    // Verify message exists and user has access to the room
    const { data: message, error: messageError } = await supabase
      .from("messages")
      .select("id, room_id, user_id")
      .eq("id", messageId)
      .single()

    if (messageError || !message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 })
    }

    // Verify user is a member of the room
    const { data: membership, error: memberError } = await supabase
      .from("room_members")
      .select("id, removed_at")
      .eq("room_id", message.room_id)
      .eq("user_id", user.id)
      .single()

    if (memberError || !membership) {
      return NextResponse.json(
        { error: "You are not a member of this room" },
        { status: 403 },
      )
    }

    if (membership.removed_at) {
      return NextResponse.json(
        { error: "You have been removed from this room" },
        { status: 403 },
      )
    }

    // Get all read receipts for this message with user info
    const { data: readReceipts, error: readError } = await supabase
      .from("message_reads")
      .select(
        `
        id,
        user_id,
        read_at,
        profiles:user_id (
          id,
          display_name,
          avatar_url,
          wallet_address
        )
      `,
      )
      .eq("message_id", messageId)
      .order("read_at", { ascending: true })

    if (readError) {
      console.error("[read-receipt] Error fetching read receipts:", readError)
      throw readError
    }

    const readCount = readReceipts?.length || 0
    const senderRead = readReceipts?.some((r) => r.user_id === message.user_id) || false

    return NextResponse.json(
      {
        messageId,
        readCount,
        senderRead,
        readReceipts: readReceipts || [],
      },
      { status: 200 },
    )
  } catch (error) {
    console.error("[read-receipt] GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch read receipts" },
      { status: 500 },
    )
  }
}
