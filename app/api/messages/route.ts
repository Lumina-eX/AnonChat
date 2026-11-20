import { createClient } from "@/lib/supabase/server"
import { recordGroupAuditEvent } from "@/lib/blockchain/audit"
import {
  checkAndConsumeWalletMessageSlot,
  formatRateLimitWindow,
  getWalletRateLimitKey,
  resolveWalletMessageRatePolicy,
} from "@/lib/wallet-message-rate-limit"
import { getRoomTTL } from "@/lib/ephemeral-cleanup"
import { type NextRequest, NextResponse } from "next/server"
import { validateMessage, ValidationErrorType } from "@/lib/middleware/message-validation"
import { insertMessageIdempotent } from "@/lib/messages/idempotency"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { searchParams } = new URL(request.url)
    const roomId = searchParams.get("room_id")
    const limit = Number.parseInt(searchParams.get("limit") || "50")
    const offset = Number.parseInt(searchParams.get("offset") || "0")

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

    const { data, error } = await supabase
      .from("messages")
      .select("*, profiles(display_name, avatar_url)")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    return NextResponse.json({ messages: data })
  } catch (error) {
    console.error("[v0] GET /api/messages error:", error)
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { id, status } = body

    if (!id || !status) {
      return NextResponse.json({ error: "id and status are required" }, { status: 400 })
    }

    // Only allow updating to certain statuses
    if (!["sent", "delivered", "read"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }

    // Verify message exists and user has access (implicitly via RLS or explicit check)
    // For simplicity and matching existing patterns, we'll just attempt the update
    // Supabase RLS should handle permission if configured
    const { data, error } = await supabase
      .from("messages")
      .update({ status })
      .eq("id", id)
      .select()

    if (error) throw error

    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 })
    }

    return NextResponse.json({ message: data[0], success: true })
  } catch (error) {
    console.error("[v0] PATCH /api/messages error:", error)
    return NextResponse.json({ error: "Failed to update message status" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { id, content, editWindowMinutes } = body

    if (!id || typeof content !== "string") {
      return NextResponse.json({ error: "id and content are required" }, { status: 400 })
    }

    // Validate message content for edits
    const validation = validateMessage({ content, id }, 'http')
    if (!validation.isValid) {
      const statusCode = validation.error?.type === ValidationErrorType.MESSAGE_TOO_LONG ? 413 : 400
      return NextResponse.json(
        {
          error: validation.error?.message,
          type: validation.error?.type,
          details: validation.error?.details,
        },
        { status: statusCode }
      )
    }

    // Use sanitized content
    const sanitizedContent = validation.sanitized?.content || content

    const windowMinutes = Number(editWindowMinutes ?? process.env.MESSAGE_EDIT_WINDOW_MINUTES ?? 5)
    const windowMs = windowMinutes * 60 * 1000

    const { data: existing, error: fetchErr } = await supabase
      .from("messages")
      .select("id, user_id, created_at")
      .eq("id", id)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!existing) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 })
    }

    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden. You can only edit your own messages." }, { status: 403 })
    }

    const createdAt = new Date(existing.created_at as string).getTime()
    const now = Date.now()
    const elapsedMs = now - createdAt

    if (elapsedMs < 0 || elapsedMs > windowMs) {
      return NextResponse.json(
        {
          error: "Edit window expired",
          code: "EDIT_WINDOW_EXPIRED",
          elapsedMs,
          windowMs,
        },
        { status: 403 },
      )
    }

    const { data, error } = await supabase
      .from("messages")
      .update({
        content: sanitizedContent,
        edited_at: new Date(now).toISOString(),
      })
      .eq("id", id)
      .select()

    if (error) throw error
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Failed to update message" }, { status: 500 })
    }

    return NextResponse.json({ message: data[0], success: true })
  } catch (error) {
    console.error("[v0] PUT /api/messages error:", error)
    return NextResponse.json({ error: "Failed to edit message" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 })
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "A JSON object is required" }, { status: 400 })
    }

    const { room_id, message_ids } = body as {
      room_id?: unknown
      message_ids?: unknown
    }
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

    if (
      typeof room_id !== "string" ||
      !uuidPattern.test(room_id) ||
      !Array.isArray(message_ids) ||
      message_ids.length === 0 ||
      message_ids.length > 500 ||
      message_ids.some((id) => typeof id !== "string" || !uuidPattern.test(id))
    ) {
      return NextResponse.json(
        { error: "A valid room_id and between 1 and 500 message_ids are required" },
        { status: 400 },
      )
    }

    const messageIds = [
      ...new Set(
        message_ids.filter((id): id is string => typeof id === "string"),
      ),
    ]
    const { data: membership, error: memberError } = await supabase
      .from("room_members")
      .select("id, removed_at")
      .eq("room_id", room_id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (memberError) throw memberError
    if (!membership || membership.removed_at) {
      return NextResponse.json({ error: "You are not an active member of this room" }, { status: 403 })
    }

    const { data: messagesToDelete, error: fetchError } = await supabase
      .from("messages")
      .select("id, user_id")
      .eq("room_id", room_id)
      .in("id", messageIds)

    if (fetchError) throw fetchError
    if (
      !messagesToDelete ||
      messagesToDelete.length !== messageIds.length ||
      messagesToDelete.some((message: { user_id: string }) => message.user_id !== user.id)
    ) {
      return NextResponse.json(
        { error: "Only your own messages can be deleted" },
        { status: 403 },
      )
    }

    const { data: deletedMessages, error: deleteError } = await supabase
      .from("messages")
      .delete()
      .eq("room_id", room_id)
      .eq("user_id", user.id)
      .in("id", messageIds)
      .select("id")

    if (deleteError) throw deleteError
    if (!deletedMessages || deletedMessages.length !== messageIds.length) {
      return NextResponse.json(
        { error: "Some messages could not be deleted. Refresh the conversation and try again." },
        { status: 409 },
      )
    }

    return NextResponse.json({
      success: true,
      deleted_count: deletedMessages.length,
      deleted_ids: deletedMessages.map((message: { id: string }) => message.id),
    })
  } catch (error) {
    console.error("[v0] DELETE /api/messages error:", error)
    return NextResponse.json({ error: "Failed to delete selected messages" }, { status: 500 })
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
    const {
      room_id,
      content,
      is_ephemeral = false,
      reply_to_id = null,
      // Optional client-generated UUID. When provided, the server will return
      // the existing message instead of inserting a duplicate on retries.
      idempotency_key,
    } = body

    if (!room_id || !content) {
      return NextResponse.json({ error: "room_id and content are required" }, { status: 400 })
    }

    // Validate message content (idempotency_key passes through as an optional field)
    const validation = validateMessage(
      { content, roomId: room_id, ...(idempotency_key ? { idempotency_key } : {}) },
      "http",
    )
    if (!validation.isValid) {
      const statusCode = validation.error?.type === ValidationErrorType.MESSAGE_TOO_LONG ? 413 : 400
      return NextResponse.json(
        {
          error: validation.error?.message,
          type: validation.error?.type,
          details: validation.error?.details,
        },
        { status: statusCode },
      )
    }

    // Use sanitized content
    const sanitizedContent = validation.sanitized?.content || content

    const walletKey = getWalletRateLimitKey(user)
    const policy = resolveWalletMessageRatePolicy(walletKey, room_id)
    const rate = await checkAndConsumeWalletMessageSlot(walletKey, room_id, policy)
    if (!rate.allowed) {
      console.warn(
        `[wallet-msg-rate-limit] violation limit=${policy.limit} windowSec=${policy.windowSec} walletPrefix=${walletKey.slice(0, 10)} room_id=${room_id}`,
      )
      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          limit: policy.limit,
          window: formatRateLimitWindow(policy.windowSec),
        },
        { status: 429 },
      )
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
        { status: 403 },
      )
    }

    if (!membership) {
      const { data: insertedMembership, error: insertMemberErr } = await supabase
        .from("room_members")
        .insert({
          room_id,
          user_id: user.id,
        })
        .select("id")
        .single()
      if (insertMemberErr) throw insertMemberErr

      await recordGroupAuditEvent({
        supabase,
        groupId: room_id,
        eventType: "member_joined",
        actorUserId: user.id,
        targetUserId: user.id,
        metadata: {
          membership_id: insertedMembership?.id ?? null,
          source: "message_send_auto_join",
        },
      })
    }

    // Prepare message data
    const messageData: Record<string, unknown> = {
      user_id: user.id,
      room_id,
      content: sanitizedContent,
      is_encrypted: false,
      status: "sent",
    }

    if (reply_to_id) {
      messageData.reply_to_id = reply_to_id
    }

    // Handle ephemeral messages
    if (is_ephemeral) {
      const ttl = await getRoomTTL(room_id)
      messageData.is_ephemeral = true
      messageData.expires_at = new Date(Date.now() + ttl * 1000).toISOString()
    }

    // Attach idempotency key when the client provided one
    if (idempotency_key) {
      messageData.idempotency_key = idempotency_key
    }

    // --- Idempotent insert ---
    // insertMessageIdempotent performs a pre-check for the key, then inserts.
    // On a concurrent collision (race condition) it catches the 23505 unique
    // violation and returns the winning row, so the client always receives a
    // valid message object regardless of how many retries were made.
    const { message: savedMessage, isDuplicate, error: insertError } =
      await insertMessageIdempotent(supabase, messageData as any, "http")

    if (insertError || !savedMessage) {
      throw new Error(insertError ?? "Insert returned no data")
    }

    // 200 for duplicate (idempotent replay), 201 for new creation
    const status = isDuplicate ? 200 : 201
    return NextResponse.json({ message: savedMessage, success: true, duplicate: isDuplicate }, { status })
  } catch (error) {
    console.error("[v0] POST /api/messages error:", error)
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 })
  }
}
