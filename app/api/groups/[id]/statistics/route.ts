/**
 * GET /api/groups/[id]/statistics
 *
 * Returns aggregated group message activity for owners and moderators.
 * Response contains only numeric / metadata fields — never message content.
 *
 * Query params:
 *   - page (default 1)         pagination for messagesPerDay
 *   - limit (default 30, max 90)
 *   - activeDays (default 7)   window for activeMembers
 */

import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { requireGroupRole } from "@/lib/middleware/group-roles"
import { resolveWalletFromUser } from "@/lib/auth/wallet-authorization"
import {
  activeMembersCutoffIso,
  aggregateMessagesPerDay,
  assertSafeStatisticsPayload,
  buildDailyDateWindow,
  buildStatisticsResponse,
  countActiveMembers,
  normalizeStatisticsQuery,
  parsePositiveInteger,
  toUtcDateString,
} from "@/lib/groups/message-statistics"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError) {
      console.error("[groups/statistics] auth error:", authError)
      return NextResponse.json(
        { error: "Unable to verify authentication" },
        { status: 401 },
      )
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: groupId } = await params
    if (!groupId) {
      return NextResponse.json({ error: "Group ID is required" }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const { page, limit, activeDays } = normalizeStatisticsQuery({
      page: parsePositiveInteger(searchParams.get("page"), 1),
      limit: parsePositiveInteger(searchParams.get("limit"), 30),
      activeDays: parsePositiveInteger(searchParams.get("activeDays"), 7),
    })

    const { data: callerProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError) {
      console.error("[groups/statistics] profile lookup error:", profileError)
      return NextResponse.json(
        { error: "Failed to retrieve caller profile" },
        { status: 500 },
      )
    }

    const callerWallet = resolveWalletFromUser(user, callerProfile)

    const roleCheck = await requireGroupRole({
      supabase,
      groupId,
      minimumRole: "moderator",
      callerWallet,
      userId: user.id,
    })

    if (roleCheck instanceof NextResponse) {
      return roleCheck
    }

    const { data: group, error: groupError } = await supabase
      .from("rooms")
      .select("id, created_at")
      .eq("id", groupId)
      .maybeSingle()

    if (groupError) {
      console.error("[groups/statistics] group lookup error:", groupError)
      return NextResponse.json({ error: "Failed to retrieve group" }, { status: 500 })
    }

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 })
    }

    const groupCreatedAt: string | null = group.created_at ?? null

    // Total messages — count only, never select content columns.
    const { count: totalMessages, error: totalError } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("room_id", groupId)

    if (totalError) {
      console.error("[groups/statistics] totalMessages error:", totalError)
      return NextResponse.json(
        { error: "Failed to aggregate message statistics" },
        { status: 500 },
      )
    }

    // Member count — prefer active room_members, fall back to group_membership.
    let memberCount = 0
    const { count: roomMemberCount, error: roomMemberError } = await supabase
      .from("room_members")
      .select("id", { count: "exact", head: true })
      .eq("room_id", groupId)
      .is("removed_at", null)

    if (roomMemberError) {
      console.warn("[groups/statistics] room_members count error:", roomMemberError)
    } else {
      memberCount = roomMemberCount ?? 0
    }

    if (memberCount === 0) {
      const { count: groupMemberCount, error: groupMemberError } = await supabase
        .from("group_membership")
        .select("id", { count: "exact", head: true })
        .eq("group_id", groupId)

      if (groupMemberError) {
        console.error("[groups/statistics] group_membership count error:", groupMemberError)
        return NextResponse.json(
          { error: "Failed to aggregate member statistics" },
          { status: 500 },
        )
      }
      memberCount = groupMemberCount ?? 0
    }

    // Active members — distinct posters in the recent window (user_id only).
    const cutoff = activeMembersCutoffIso(activeDays)
    const { data: activeRows, error: activeError } = await supabase
      .from("messages")
      .select("user_id")
      .eq("room_id", groupId)
      .gte("created_at", cutoff)
      .not("user_id", "is", null)

    if (activeError) {
      console.error("[groups/statistics] activeMembers error:", activeError)
      return NextResponse.json(
        { error: "Failed to aggregate active member statistics" },
        { status: 500 },
      )
    }

    const activeMembers = countActiveMembers(activeRows ?? [])

    // Paginated daily breakdown window (newest first).
    const endDate = toUtcDateString(new Date())
    const { dates, totalDays } = buildDailyDateWindow({
      endDate,
      page,
      limit,
      earliestDate: groupCreatedAt,
    })

    let messagesPerDay = dates.map((date) => ({ date, count: 0 }))

    if (dates.length > 0) {
      const rangeStart = `${dates[dates.length - 1]}T00:00:00.000Z`
      const rangeEndExclusive = new Date(`${dates[0]}T00:00:00.000Z`)
      rangeEndExclusive.setUTCDate(rangeEndExclusive.getUTCDate() + 1)

      // Select only created_at — never content / ciphertext fields.
      const { data: dailyRows, error: dailyError } = await supabase
        .from("messages")
        .select("created_at")
        .eq("room_id", groupId)
        .gte("created_at", rangeStart)
        .lt("created_at", rangeEndExclusive.toISOString())

      if (dailyError) {
        console.error("[groups/statistics] messagesPerDay error:", dailyError)
        return NextResponse.json(
          { error: "Failed to aggregate daily message statistics" },
          { status: 500 },
        )
      }

      messagesPerDay = aggregateMessagesPerDay(dailyRows ?? [], dates)
    }

    const payload = buildStatisticsResponse({
      groupId,
      totalMessages: totalMessages ?? 0,
      activeMembers,
      activeMembersWindowDays: activeDays,
      memberCount,
      groupCreatedAt,
      messagesPerDay,
      page,
      limit,
      totalDays,
    })

    if (!assertSafeStatisticsPayload(payload)) {
      console.error("[groups/statistics] unsafe payload blocked")
      return NextResponse.json(
        { error: "Failed to build safe statistics response" },
        { status: 500 },
      )
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error("[groups/statistics] GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch group statistics" },
      { status: 500 },
    )
  }
}
