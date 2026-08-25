import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

const ALLOWED_EMOJIS = new Set(["👍", "❤️", "😂", "😮", "😢", "🎉"])

type RouteContext = {
  params: Promise<{ messageId: string }>
}

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
}

async function ensureMessageAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  messageId: string,
  userId: string,
) {
  const { data: message, error } = await supabase
    .from("messages")
    .select("id, room_id")
    .eq("id", messageId)
    .maybeSingle()

  if (error) throw error
  if (!message) return null

  const { data: membership, error: membershipError } = await supabase
    .from("room_members")
    .select("id, removed_at")
    .eq("room_id", message.room_id)
    .eq("user_id", userId)
    .maybeSingle()

  if (membershipError) throw membershipError
  if (!membership || membership.removed_at) return false
  return message
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { supabase, user } = await getAuthenticatedUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { messageId } = await params
    const body = await request.json().catch(() => ({}))
    const { emoji } = body
    if (typeof emoji !== "string" || !ALLOWED_EMOJIS.has(emoji)) {
      return NextResponse.json({ error: "Invalid reaction" }, { status: 400 })
    }

    const access = await ensureMessageAccess(supabase, messageId, user.id)
    if (!access) {
      return NextResponse.json({ error: access === null ? "Message not found" : "Forbidden" }, { status: access === null ? 404 : 403 })
    }

    const { data, error } = await supabase
      .from("message_reactions")
      .upsert(
        { message_id: messageId, user_id: user.id, emoji },
        { onConflict: "message_id,user_id,emoji" },
      )
      .select("message_id, user_id, emoji")
      .single()

    if (error) throw error
    return NextResponse.json({ reaction: data }, { status: 201 })
  } catch (error) {
    console.error("[v0] POST /api/messages/[messageId]/reactions error:", error)
    return NextResponse.json({ error: "Failed to add reaction" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { supabase, user } = await getAuthenticatedUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { messageId } = await params
    const body = await request.json().catch(() => ({}))
    const { emoji } = body
    if (typeof emoji !== "string" || !ALLOWED_EMOJIS.has(emoji)) {
      return NextResponse.json({ error: "Invalid reaction" }, { status: 400 })
    }

    const access = await ensureMessageAccess(supabase, messageId, user.id)
    if (!access) {
      return NextResponse.json({ error: access === null ? "Message not found" : "Forbidden" }, { status: access === null ? 404 : 403 })
    }

    const { error } = await supabase
      .from("message_reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", user.id)
      .eq("emoji", emoji)

    if (error) throw error
    return NextResponse.json({ success: true, messageId, emoji })
  } catch (error) {
    console.error("[v0] DELETE /api/messages/[messageId]/reactions error:", error)
    return NextResponse.json({ error: "Failed to remove reaction" }, { status: 500 })
  }
}
