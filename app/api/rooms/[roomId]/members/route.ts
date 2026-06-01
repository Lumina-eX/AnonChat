import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { recordGroupAuditEvent } from "@/lib/blockchain/audit"

type MemberRow = {
  user_id: string
  joined_at: string
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { roomId } = await params
    if (!roomId) {
      return NextResponse.json({ error: "roomId is required" }, { status: 400 })
    }

    const { data: members, error } = await supabase
      .from("room_members")
      .select("user_id, joined_at, removed_at")
      .eq("room_id", roomId)
      .is("removed_at", null)
      .order("joined_at", { ascending: true })

    if (error) throw error

    return NextResponse.json({
      members: ((members ?? []) as MemberRow[]).map((m) => ({
        user_id: m.user_id,
        joined_at: m.joined_at,
        is_current_user: m.user_id === user.id,
      })),
    })
  } catch (error) {
    console.error("[rooms/members] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { roomId } = await params
    if (!roomId) {
      return NextResponse.json({ error: "roomId is required" }, { status: 400 })
    }

    const { data: membership, error: membershipError } = await supabase
      .from("room_members")
      .select("id, joined_at")
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle()

    if (membershipError) throw membershipError
    if (!membership) {
      return NextResponse.json({ error: "Active membership not found" }, { status: 404 })
    }

    const { error: deleteError } = await supabase
      .from("room_members")
      .delete()
      .eq("room_id", roomId)
      .eq("user_id", user.id)

    if (deleteError) throw deleteError

    const auditEvent = await recordGroupAuditEvent({
      supabase,
      groupId: roomId,
      eventType: "member_left",
      actorUserId: user.id,
      targetUserId: user.id,
      metadata: {
        membership_id: membership.id,
        joined_at: membership.joined_at,
      },
    })

    return NextResponse.json({
      success: true,
      message: "Left room",
      audit: auditEvent ?? undefined,
    })
  } catch (error) {
    console.error("[rooms/members] DELETE error:", error)
    return NextResponse.json({ error: "Failed to leave room" }, { status: 500 })
  }
}
