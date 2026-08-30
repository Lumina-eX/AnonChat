import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { recordGroupAuditEvent } from "@/lib/blockchain/audit"
import {
  paginateGroupMembers,
  verifyGroupMemberAccess,
  type SortField,
  type SortOrder,
} from "@/lib/groups/members-pagination"

function parseOptionalInt(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : NaN
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

    // 1. Strict Access Control Check
    const accessCheck = await verifyGroupMemberAccess(supabase, roomId, user.id)
    if (!accessCheck.authorized) {
      if (accessCheck.reason === "not_found") {
        return NextResponse.json({ error: "Room not found" }, { status: 404 })
      }
      return NextResponse.json(
        { error: "Unauthorized: You are not a member of this group" },
        { status: 403 }
      )
    }

    // 2. Parse Query Parameters
    const { searchParams } = new URL(request.url)
    const limitParam = searchParams.get("limit")
    const offsetParam = searchParams.get("offset")
    const pageParam = searchParams.get("page")
    const cursor = searchParams.get("cursor") || undefined
    const sortBy = (searchParams.get("sortBy") || "joinDate") as SortField
    const sortOrder = (searchParams.get("sortOrder") || searchParams.get("order") || "asc") as SortOrder

    const limit = parseOptionalInt(limitParam)
    const offset = parseOptionalInt(offsetParam)
    const page = parseOptionalInt(pageParam)

    if (Number.isNaN(limit) || Number.isNaN(offset) || Number.isNaN(page)) {
      return NextResponse.json(
        { error: "limit, offset, and page must be valid integers" },
        { status: 400 }
      )
    }

    // 3. Paginate Group Members
    const paginationResult = await paginateGroupMembers(supabase, {
      roomId,
      currentUserId: user.id,
      limit,
      offset,
      page,
      cursor,
      sortBy,
      sortOrder,
    })

    return NextResponse.json(paginationResult, { status: 200 })
  } catch (error: any) {
    console.error("[rooms/members] GET error:", error)
    return NextResponse.json(
      { error: error?.message || "Failed to fetch members" },
      { status: 500 }
    )
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
