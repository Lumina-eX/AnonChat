import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

type RouteContext = {
  params: Promise<{ messageId: string }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { messageId } = await params
    const body = await request.json().catch(() => ({}))
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null

    const { data: message, error: messageError } = await supabase
      .from("messages")
      .select("id, room_id")
      .eq("id", messageId)
      .maybeSingle()

    if (messageError) throw messageError
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    const { data: membership, error: membershipError } = await supabase
      .from("room_members")
      .select("id, removed_at")
      .eq("room_id", message.room_id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (membershipError) throw membershipError
    if (!membership || membership.removed_at) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data, error } = await supabase
      .from("message_reports")
      .insert({
        message_id: messageId,
        reporter_user_id: user.id,
        reason,
      })
      .select("id, message_id, created_at")
      .single()

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "Message already reported" }, { status: 409 })
      }
      throw error
    }

    return NextResponse.json({ report: data }, { status: 201 })
  } catch (error) {
    console.error("[v0] POST /api/messages/[messageId]/report error:", error)
    return NextResponse.json({ error: "Failed to report message" }, { status: 500 })
  }
}
