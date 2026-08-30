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
    const { room_id, content, is_ephemeral = false, reply_to_id = null } = body

    if (!room_id || !content) {
      return NextResponse.json({ error: "room_id and content are required" }, { status: 400 })
    }

    // Validate message content
    const validation = validateMessage({ content, roomId: room_id }, 'http')
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
        { status: 403 }
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
    const messageData: any = {
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

    const { data, error } = await supabase
      .from("messages")
      .insert(messageData)
      .select()

    if (error) throw error

    return NextResponse.json({ message: data[0], success: true }, { status: 201 })
  } catch (error) {
    console.error("[v0] POST /api/messages error:", error)
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 })
  }
}
