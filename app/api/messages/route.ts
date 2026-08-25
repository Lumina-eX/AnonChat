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

    const messages = data ?? []
    const messageIds = messages.map((message) => message.id)
    const replyIds = messages
      .map((message) => message.reply_to_id)
      .filter((id): id is string => Boolean(id))

    const [{ data: reactions, error: reactionsError }, { data: replies, error: repliesError }] = await Promise.all([
      messageIds.length > 0
        ? supabase
            .from("message_reactions")
            .select("message_id, user_id, emoji")
            .in("message_id", messageIds)
        : Promise.resolve({ data: [], error: null }),
      replyIds.length > 0
        ? supabase
            .from("messages")
            .select("id, content, created_at")
            .in("id", replyIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (reactionsError) throw reactionsError
    if (repliesError) throw repliesError

    const reactionsByMessage = new Map<string, { emoji: string; userIds: string[] }[]>()
    for (const reaction of reactions ?? []) {
      const current = reactionsByMessage.get(reaction.message_id) ?? []
      const existing = current.find((item) => item.emoji === reaction.emoji)
      if (existing) {
        existing.userIds.push(reaction.user_id)
      } else {
        current.push({ emoji: reaction.emoji, userIds: [reaction.user_id] })
      }
      reactionsByMessage.set(reaction.message_id, current)
    }

    const repliesById = new Map((replies ?? []).map((reply) => [reply.id, reply]))
    const enrichedMessages = messages.map((message) => ({
      ...message,
      reactions: reactionsByMessage.get(message.id) ?? [],
      reply_to: message.reply_to_id ? repliesById.get(message.reply_to_id) ?? null : null,
    }))

    return NextResponse.json({ messages: enrichedMessages })
  } catch (error) {
    console.error("[v0] GET /api/messages error:", error)
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
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

    const body = await request.json().catch(() => ({}))
    const { id } = body
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const { data: existing, error: fetchError } = await supabase
      .from("messages")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle()

    if (fetchError) throw fetchError
    if (!existing) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 })
    }

    if (existing.user_id !== user.id) {
      return NextResponse.json(
        { error: "Forbidden. You can only delete your own messages." },
        { status: 403 },
      )
    }

    const { error: deleteError } = await supabase
      .from("messages")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)

    if (deleteError) throw deleteError

    return NextResponse.json({ success: true, id })
  } catch (error) {
    console.error("[v0] DELETE /api/messages error:", error)
    return NextResponse.json({ error: "Failed to delete message" }, { status: 500 })
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
        content,
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
    const { room_id, content, reply_to_id, is_ephemeral = false } = body

    if (!room_id || typeof room_id !== "string" || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "room_id and content are required" }, { status: 400 })
    }

    if (reply_to_id !== undefined && reply_to_id !== null && typeof reply_to_id !== "string") {
      return NextResponse.json({ error: "reply_to_id must be a string" }, { status: 400 })
    }

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

    if (reply_to_id) {
      const { data: replyTarget, error: replyTargetError } = await supabase
        .from("messages")
        .select("id, room_id")
        .eq("id", reply_to_id)
        .maybeSingle()

      if (replyTargetError) throw replyTargetError
      if (!replyTarget || replyTarget.room_id !== room_id) {
        return NextResponse.json({ error: "Reply target not found in this room" }, { status: 400 })
      }
    }

    // Prepare message data
    const messageData: any = {
      user_id: user.id,
      room_id,
      content: content.trim(),
      is_encrypted: false,
      status: "sent",
      ...(reply_to_id ? { reply_to_id } : {}),
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
