import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { recordGroupAuditEvent } from "@/lib/blockchain/audit"

export async function POST(
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
    const body = await request.json().catch(() => ({}))
    const target_user_id = body.target_user_id as string | undefined

    if (!roomId || !target_user_id) {
      return NextResponse.json(
        { error: "roomId and target_user_id are required" },
        { status: 400 }
      )
    }

    if (target_user_id === user.id) {
      return NextResponse.json(
        { error: "You cannot vote to remove yourself" },
        { status: 400 }
      )
    }

    // Ensure voter is a non-removed member
    const { data: voterMember, error: voterErr } = await supabase
      .from("room_members")
      .select("id")
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle()

    if (voterErr || !voterMember) {
      return NextResponse.json(
        { error: "You must be a member of the room to vote" },
        { status: 403 }
      )
    }

    // Ensure target is a non-removed member
    const { data: targetMember, error: targetErr } = await supabase
      .from("room_members")
      .select("id")
      .eq("room_id", roomId)
      .eq("user_id", target_user_id)
      .is("removed_at", null)
      .maybeSingle()

    if (targetErr || !targetMember) {
      return NextResponse.json(
        { error: "Target user is not an active member of this room" },
        { status: 400 }
      )
    }

    // Insert vote (unique constraint prevents duplicate)
    const { error: insertErr } = await supabase.from("room_removal_votes").insert({
      room_id: roomId,
      target_user_id,
      voter_user_id: user.id,
    })

    if (insertErr) {
      if (insertErr.code === "23505") {
        return NextResponse.json(
          { error: "You have already voted to remove this user" },
          { status: 409 }
        )
      }
      throw insertErr
    }

    // Check if removal threshold is met and apply removal
    const { data: removed, error: rpcErr } = await supabase.rpc("check_removal_threshold", {
      p_room_id: roomId,
      p_target_user_id: target_user_id,
    })

    if (rpcErr) {
      console.error("[vote-remove] check_removal_threshold error:", rpcErr)
      return NextResponse.json(
        { vote_recorded: true, removed: false, error: "Vote recorded but threshold check failed" },
        { status: 201 }
      )
    }

    const auditEvent = removed
      ? await recordGroupAuditEvent({
          supabase,
          groupId: roomId,
          eventType: "member_removed",
          actorUserId: user.id,
          targetUserId: target_user_id,
          metadata: {
            removal_reason: "membership_vote_threshold",
          },
        })
      : null

    return NextResponse.json({
      vote_recorded: true,
      removed: Boolean(removed),
      message: removed ? "User has been removed from the room" : "Vote recorded",
      audit: auditEvent ?? undefined,
    }, { status: 201 })
  } catch (error) {
    console.error("[vote-remove] error:", error)
    return NextResponse.json({ error: "Failed to record vote" }, { status: 500 })
  }
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

    const { data: votes, error } = await supabase
      .from("room_removal_votes")
      .select("target_user_id, voter_user_id, created_at")
      .eq("room_id", roomId)

    if (error) throw error

    const byTarget = (votes ?? []).reduce<Record<string, { count: number; voters: string[] }>>(
      (acc, v) => {
        const id = v.target_user_id as string
        if (!acc[id]) acc[id] = { count: 0, voters: [] }
        acc[id].count += 1
        acc[id].voters.push(v.voter_user_id as string)
        return acc
      },
      {}
    )

    return NextResponse.json({ votes: byTarget })
  } catch (error) {
    console.error("[vote-remove] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch votes" }, { status: 500 })
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
    const { searchParams } = new URL(request.url)
    const target_user_id = searchParams.get("target_user_id")

    if (!roomId || !target_user_id) {
      return NextResponse.json(
        { error: "roomId and target_user_id query params are required" },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from("room_removal_votes")
      .delete()
      .eq("room_id", roomId)
      .eq("target_user_id", target_user_id)
      .eq("voter_user_id", user.id)

    if (error) throw error

    return NextResponse.json({ success: true, message: "Vote removed" })
  } catch (error) {
    console.error("[vote-remove] DELETE error:", error)
    return NextResponse.json({ error: "Failed to remove vote" }, { status: 500 })
  }
}
