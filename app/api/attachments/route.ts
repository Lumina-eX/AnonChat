import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { message_id, group_id, original_filename, mime_type, file_size } = body

    // Validate required fields
    if (!message_id || !group_id || !original_filename || !mime_type || file_size === undefined) {
      return NextResponse.json({ error: "message_id, group_id, original_filename, mime_type, and file_size are required" }, { status: 400 })
    }

    // Validate message exists and user has access
    const { data: message, error: messageErr } = await supabase
      .from("messages")
      .select("room_id, user_id")
      .eq("id", message_id)
      .maybeSingle()

    if (messageErr) throw messageErr
    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 })
    }

    // Verify user is a member of the room
    const { data: membership, error: memberErr } = await supabase
      .from("room_members")
      .select("id, removed_at")
      .eq("room_id", message.room_id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (memberErr) throw memberErr
    if (!membership) {
      return NextResponse.json({ error: "Forbidden. You are not a member of this room." }, { status: 403 })
    }
    if (membership.removed_at) {
      return NextResponse.json({ error: "Forbidden. You have been removed from this room." }, { status: 403 })
    }

    // Check that the message belongs to the specified group
    if (message.room_id !== group_id) {
      return NextResponse.json({ error: "Message does not belong to the specified group" }, { status: 400 })
    }

    // Validate MIME type
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/gif", "video/mp4", "video/quicktime", "application/pdf", "text/plain", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
    if (!allowedMimeTypes.includes(mime_type)) {
      return NextResponse.json({ error: "Unsupported MIME type" }, { status: 400 })
    }

    // Validate file size (max 50MB)
    const maxFileSize = 50 * 1024 * 1024 // 50MB
    if (file_size > maxFileSize) {
      return NextResponse.json({ error: "File size exceeds maximum limit of 50MB" }, { status: 400 })
    }

    // Validate filename (no path traversal, max length)
    if (original_filename.length > 255) {
      return NextResponse.json({ error: "Filename is too long" }, { status: 400 })
    }
    if (/[/"<>|]/.test(original_filename)) {
      return NextResponse.json({ error: "Filename contains invalid characters" }, { status: 400 })
    }

    // Check if attachment metadata already exists for this message
    const { data: existingAttachment } = await supabase
      .from("attachment_metadata")
      .select("id")
      .eq("message_id", message_id)
      .single()

    if (existingAttachment) {
      return NextResponse.json({ error: "Attachment metadata already exists for this message" }, { status: 409 })
    }

    // Insert attachment metadata
    const { data, error } = await supabase
      .from("attachment_metadata")
      .insert({
        message_id,
        group_id,
        original_filename,
        mime_type,
        file_size,
        uploaded_by: user.id,
      })
      .select()
      .single()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ error: "Failed to create attachment metadata" }, { status: 500 })
    }

    return NextResponse.json({ attachment: data }, { status: 201 })
  } catch (error) {
    console.error("[v0] POST /api/attachments error:", error)
    return NextResponse.json({ error: "Failed to create attachment metadata" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { searchParams } = new URL(request.url)
    const messageId = searchParams.get("message_id")
    const groupId = searchParams.get("group_id")

    if (!messageId && !groupId) {
      return NextResponse.json({ error: "Either message_id or group_id query parameter is required" }, { status: 400 })
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let query = supabase.from("attachment_metadata").select(`

    `)

    if (messageId) {
      // Verify message exists and user has access
      const { data: message, error: messageErr } = await supabase
        .from("messages")
        .select("room_id")
        .eq("id", messageId)
        .maybeSingle()

      if (messageErr) throw messageErr
      if (!message) {
        return NextResponse.json({ error: "Message not found" }, { status: 404 })
      }

      // Check membership
      const { data: membership, error: memberErr } = await supabase
        .from("room_members")
        .select("id, removed_at")
        .eq("room_id", message.room_id)
        .eq("user_id", user.id)
        .maybeSingle()

      if (memberErr) throw memberErr
      if (!membership) {
        return NextResponse.json({ error: "Forbidden. You are not a member of this room." }, { status: 403 })
      }
      if (membership.removed_at) {
        return NextResponse.json({ error: "Forbidden. You have been removed from this room." }, { status: 403 })
      }

      query = query.eq("message_id", messageId)
    }

    if (groupId) {
      // Check membership for group_id queries
      const { data: membership, error: memberErr } = await supabase
        .from("room_members")
        .select("id, removed_at")
        .eq("room_id", groupId)
        .eq("user_id", user.id)
        .maybeSingle()

      if (memberErr) throw memberErr
      if (!membership) {
        return NextResponse.json({ error: "Forbidden. You are not a member of this group." }, { status: 403 })
      }
      if (membership.removed_at) {
        return NextResponse.json({ error: "Forbidden. You have been removed from this group." }, { status: 403 })
      }

      query = query.eq("group_id", groupId)
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json({ attachments: data || [] })
  } catch (error) {
    console.error("[v0] GET /api/attachments error:", error)
    return NextResponse.json({ error: "Failed to fetch attachment metadata" }, { status: 500 })
  }
}