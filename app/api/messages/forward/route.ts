import { createClient } from "@/lib/supabase/server"
import {
  checkAndConsumeWalletMessageSlot,
  formatRateLimitWindow,
  getWalletRateLimitKey,
  resolveWalletMessageRatePolicy,
} from "@/lib/wallet-message-rate-limit"
import { type NextRequest, NextResponse } from "next/server"

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

const PREVIEW_MAX_LENGTH = 500

type SourceMessage = {
  id: string
  room_id: string
  content: string
  created_at: string
  is_forwarded?: boolean | null
  forwarded_original_created_at?: string | null
}

/** Returns true only if the user is an active (not removed) member of the room. */
async function isActiveMember(supabase: SupabaseServerClient, roomId: string, userId: string) {
  const { data, error } = await supabase
    .from("room_members")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle()

  if (error) throw error
  return Boolean(data)
}

/**
 * Loads the source message and verifies the caller may read it.
 *
 * A message the caller cannot access is reported exactly like a deleted one
 * (404) so the endpoint can't be used to probe for messages in other groups.
 */
async function loadAccessibleSourceMessage(
  supabase: SupabaseServerClient,
  messageId: string,
  userId: string,
): Promise<{ ok: true; message: SourceMessage } | { ok: false; response: NextResponse }> {
  const unavailable = NextResponse.json(
    {
      error: "The original message is no longer available. It may have been deleted or you may no longer have access to it.",
      code: "MESSAGE_UNAVAILABLE",
    },
    { status: 404 },
  )

  const { data: message, error } = await supabase
    .from("messages")
    .select("id, room_id, content, created_at, is_forwarded, forwarded_original_created_at")
    .eq("id", messageId)
    .maybeSingle()

  // Invalid UUIDs surface as a Postgres error (22P02); treat as unavailable.
  if (error) {
    if (error.code === "22P02") return { ok: false, response: unavailable }
    throw error
  }
  if (!message) return { ok: false, response: unavailable }

  // Defense in depth: RLS already restricts reads, but check explicitly.
  if (!(await isActiveMember(supabase, message.room_id, userId))) {
    return { ok: false, response: unavailable }
  }

  return { ok: true, message: message as SourceMessage }
}

/**
 * GET /api/messages/forward?message_id=<id>
 *
 * Returns a preview of the message to forward and the groups the current user
 * can forward it to (only groups they are an active member of, excluding the
 * source group).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized. You must be logged in to forward messages." }, { status: 401 })
    }

    const messageId = new URL(request.url).searchParams.get("message_id")
    if (!messageId) {
      return NextResponse.json({ error: "message_id is required" }, { status: 400 })
    }

    const source = await loadAccessibleSourceMessage(supabase, messageId, user.id)
    if (!source.ok) return source.response

    const { data: memberships, error: membershipErr } = await supabase
      .from("room_members")
      .select("room_id, rooms(id, name)")
      .eq("user_id", user.id)
      .is("removed_at", null)

    if (membershipErr) throw membershipErr

    const destinations = (memberships || [])
      .map((m) => {
        // Supabase types embedded relations loosely; normalise object vs array.
        const rooms = m.rooms as unknown as { id: string; name: string } | { id: string; name: string }[] | null
        const room = Array.isArray(rooms) ? rooms[0] : rooms
        return room ? { id: room.id, name: room.name } : null
      })
      .filter((room): room is { id: string; name: string } => Boolean(room))
      .filter((room) => room.id !== source.message.room_id)
      .sort((a, b) => a.name.localeCompare(b.name))

    const { content } = source.message
    return NextResponse.json({
      message: {
        id: source.message.id,
        content: content.length > PREVIEW_MAX_LENGTH ? `${content.slice(0, PREVIEW_MAX_LENGTH)}…` : content,
        created_at: source.message.created_at,
        is_forwarded: Boolean(source.message.is_forwarded),
      },
      destinations,
    })
  } catch (error) {
    console.error("[forward] GET /api/messages/forward error:", error)
    return NextResponse.json({ error: "Failed to load forwarding options" }, { status: 500 })
  }
}

/**
 * POST /api/messages/forward
 * body: { message_id: string, destination_room_id: string }
 *
 * Copies the message into the destination group, marked as forwarded. Only the
 * content and the original send time are carried over; the source group and
 * original author are never exposed to the destination.
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

    const body = await request.json().catch(() => ({}))
    const { message_id, destination_room_id } = body as {
      message_id?: string
      destination_room_id?: string
    }

    if (!message_id) {
      return NextResponse.json({ error: "message_id is required" }, { status: 400 })
    }
    if (!destination_room_id) {
      return NextResponse.json({ error: "Please select a destination group" }, { status: 400 })
    }

    const source = await loadAccessibleSourceMessage(supabase, message_id, user.id)
    if (!source.ok) return source.response

    if (source.message.room_id === destination_room_id) {
      return NextResponse.json({ error: "Choose a different group to forward this message to" }, { status: 400 })
    }

    // Unlike POST /api/messages we never auto-join: forwarding is only allowed
    // into groups the user already belongs to.
    if (!(await isActiveMember(supabase, destination_room_id, user.id))) {
      return NextResponse.json(
        { error: "You can only forward messages to groups you are a member of" },
        { status: 403 },
      )
    }

    const walletKey = getWalletRateLimitKey(user)
    const policy = resolveWalletMessageRatePolicy(walletKey, destination_room_id)
    const rate = await checkAndConsumeWalletMessageSlot(walletKey, destination_room_id, policy)
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded. Please wait before forwarding more messages (${policy.limit} per ${formatRateLimitWindow(policy.windowSec)}).`,
          limit: policy.limit,
          window: formatRateLimitWindow(policy.windowSec),
        },
        { status: 429 },
      )
    }

    // When forwarding an already-forwarded message, keep the very first send time.
    const originalCreatedAt =
      source.message.is_forwarded && source.message.forwarded_original_created_at
        ? source.message.forwarded_original_created_at
        : source.message.created_at

    const { data, error } = await supabase
      .from("messages")
      .insert({
        user_id: user.id,
        room_id: destination_room_id,
        content: source.message.content,
        is_encrypted: false,
        status: "sent",
        is_forwarded: true,
        forwarded_from_message_id: source.message.id,
        forwarded_original_created_at: originalCreatedAt,
      })
      .select("id, user_id, room_id, content, created_at, status, is_forwarded, forwarded_original_created_at")
      .single()

    if (error) throw error

    return NextResponse.json({ message: data, success: true }, { status: 201 })
  } catch (error) {
    console.error("[forward] POST /api/messages/forward error:", error)
    return NextResponse.json({ error: "Failed to forward message" }, { status: 500 })
  }
}
