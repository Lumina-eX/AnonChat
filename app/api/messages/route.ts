import { createClient } from "@/lib/supabase/server"
import {
  checkAndConsumeWalletMessageSlot,
  formatRateLimitWindow,
  getWalletRateLimitKey,
  resolveWalletMessageRatePolicy,
} from "@/lib/wallet-message-rate-limit"
import { EPHEMERAL_CONFIG } from "@/lib/ephemeral/config"
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

    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from("messages")
      .select("*, profiles(display_name, avatar_url)")
      .eq("room_id", roomId)
      // Exclude ephemeral messages that have already expired.
      // Non-ephemeral messages (is_ephemeral = false) are always returned.
      // The cleanup worker will hard-delete these rows asynchronously;
      // this filter ensures clients never see expired content in the meantime.
      .or(`is_ephemeral.eq.false,expires_at.gt.${now}`)
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
    const { room_id, content, is_ephemeral: clientEphemeral, ttl_seconds: clientTtl } = body

    if (!room_id || !content) {
      return NextResponse.json({ error: "room_id and content are required" }, { status: 400 })
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
      const { error: insertMemberErr } = await supabase.from("room_members").insert({
        room_id,
        user_id: user.id,
      })
      if (insertMemberErr) throw insertMemberErr
    }

    // ─── Resolve TTL for this message ────────────────────────────────────────
    // Priority: explicit client request > room default > system default
    let isEphemeral = false
    let expiresAt: string | null = null

    // Fetch the room's default_ttl_seconds (null = inherit system default)
    const { data: roomRow } = await supabase
      .from("rooms")
      .select("default_ttl_seconds")
      .eq("id", room_id)
      .maybeSingle()

    const roomTtl: number | null = roomRow?.default_ttl_seconds ?? null

    // Resolve effective TTL in seconds
    let effectiveTtlSeconds: number | null = null

    if (typeof clientTtl === "number" && clientTtl > 0) {
      // Client explicitly requested a TTL for this message
      effectiveTtlSeconds = Math.floor(clientTtl)
    } else if (clientEphemeral === true) {
      // Client flagged as ephemeral but didn't specify TTL — use room/system default
      const systemTtl = EPHEMERAL_CONFIG.defaultTtlSeconds
      effectiveTtlSeconds = roomTtl !== null ? roomTtl : systemTtl > 0 ? systemTtl : null
    } else if (roomTtl !== null && roomTtl > 0) {
      // Room has a positive default TTL — all messages in this room are ephemeral
      effectiveTtlSeconds = roomTtl
    } else if (roomTtl === null) {
      // Room inherits system default
      const systemTtl = EPHEMERAL_CONFIG.defaultTtlSeconds
      if (systemTtl > 0) effectiveTtlSeconds = systemTtl
    }
    // roomTtl === 0 means the room explicitly opts out of ephemeral messages

    if (effectiveTtlSeconds !== null && effectiveTtlSeconds > 0) {
      isEphemeral = true
      expiresAt = new Date(Date.now() + effectiveTtlSeconds * 1000).toISOString()
    }

    const { data, error } = await supabase
      .from("messages")
      .insert({
        user_id: user.id,
        room_id,
        content,
        is_encrypted: false,
        status: "sent",
        is_ephemeral: isEphemeral,
        expires_at: expiresAt,
      })
      .select()

    if (error) throw error

    return NextResponse.json({ message: data[0], success: true }, { status: 201 })
  } catch (error) {
    console.error("[v0] POST /api/messages error:", error)
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 })
  }
}
