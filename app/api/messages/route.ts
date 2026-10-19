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
import {
  GroupPermissionError,
  checkGroupPermission,
} from "@/lib/authorization/group-permissions"

function permissionDeniedResponse(error: GroupPermissionError) {
  const status = error.code === "UNAUTHENTICATED" ? 401 : 403
  return NextResponse.json(
    { error: error.message, code: error.code, permission: error.permission },
    { status },
  )
}

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

    // Centralized role-based authorization for viewing group content.
    const permission = await checkGroupPermission(supabase, {
      userId: user.id,
      groupId: roomId,
      action: "view_group_content",
    })
    if (!permission.allowed) {
      return permissionDeniedResponse(permission.error)
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
    if (error instanceof GroupPermissionError) {
      console.warn("[v0] GET /api/messages permission denied:", error.code)
      return permissionDeniedResponse(error)
    }
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

    // Resolve the message's group and ownership before authorizing the update.
    const { data: existing, error: fetchErr } = await supabase
      .from("messages")
      .select("id, user_id, room_id")
      .eq("id", id)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!existing) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 })
    }

    const permission = await checkGroupPermission(supabase, {
      userId: user.id,
      groupId: existing.room_id as string,
      action: "update_message_status",
      resourceOwnerId: existing.user_id as string,
    })
    if (!permission.allowed) {
      return permissionDeniedResponse(permission.error)
    }

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
    if (error instanceof GroupPermissionError) {
      console.warn("[v0] PATCH /api/messages permission denied:", error.code)
      return permissionDeniedResponse(error)
    }
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
      .select("id, user_id, room_id, created_at")
      .eq("id", id)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!existing) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 })
    }

    // Editing is owner-only unless the group policy grants moderation capabilities.
    const permission = await checkGroupPermission(supabase, {
      userId: user.id,
      groupId: existing.room_id as string,
      action: "edit_message",
      resourceOwnerId: existing.user_id as string,
    })
    if (!permission.allowed) {
      return permissionDeniedResponse(permission.error)
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
    if (error instanceof GroupPermissionError) {
      console.warn("[v0] PUT /api/messages permission denied:", error.code)
      return permissionDeniedResponse(error)
    }
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

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("messages")
      .select("id, user_id, room_id")
      .eq("id", id)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!existing) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 })
    }

    const permission = await checkGroupPermission(supabase, {
      userId: user.id,
      groupId: existing.room_id as string,
      action: "delete_message",
      resourceOwnerId: existing.user_id as string,
    })
    if (!permission.allowed) {
      return permissionDeniedResponse(permission.error)
    }

    const { error } = await supabase.from("messages").delete().eq("id", id)
    if (error) throw error

    await recordGroupAuditEvent({
      supabase,
      groupId: existing.room_id as string,
      eventType: "message_deleted",
      actorUserId: user.id,
      targetUserId: existing.user_id as string,
      metadata: { message_id: id, permission: permission.role },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof GroupPermissionError) {
      console.warn("[v0] DELETE /api/messages permission denied:", error.code)
      return permissionDeniedResponse(error)
    }
    console.error("[v0] DELETE /api/messages error:", error)
    return NextResponse.json({ error: "Failed to delete message" }, { status: 500 })
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
        `wallet-msg-rate-limit violation limit=${policy.limit} windowSec=${policy.windowSec} walletPrefix=${walletKey.slice(0, 10)} room_id=${room_id}`,
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

    // Centralized authorization: membership + role + action evaluation.
    const permission = await checkGroupPermission(supabase, {
      userId: user.id,
      groupId: room_id,
      action: "send_message",
    })
    if (!permission.allowed) {
      return permissionDeniedResponse(permission.error)
    }

    const ttl = is_ephemeral ? getRoomTTL(room_id) : null

    const inserted = await insertMessageIdempotent(supabase, {
      room_id,
      user_id: user.id,
      content: sanitizedContent,
      is_ephemeral,
      reply_to_id,
      expires_at: ttl ? new Date(Date.now() + ttl).toISOString() : null,
      idempotency_key: idempotency_key ?? null,
    })

    return NextResponse.json({ message: inserted.message, duplicate: inserted.duplicate })
  } catch (error) {
    if (error instanceof GroupPermissionError) {
      console.warn("[v0] POST /api/messages permission denied:", error.code)
      return permissionDeniedResponse(error)
    }
    console.error("[v0] POST /api/messages error:", error)
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 })
  }
}
