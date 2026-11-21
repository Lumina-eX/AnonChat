import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { getTransactionExplorerUrl } from "@/lib/blockchain/stellar-service"

const EVENT_TYPES = new Set([
  "group_created",
  "member_joined",
  "member_left",
  "member_removed",
])

const STATUSES = new Set(["pending", "submitted", "failed"])

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

type AuditEventRow = {
  event_id: string
  group_id: string
  event_type: string
  actor_user_id: string | null
  target_user_id: string | null
  transaction_hash: string | null
  stellar_memo: string | null
  metadata_hash: string
  status: string
  error_message: string | null
  created_at: string
  submitted_at: string | null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: groupId } = await params
    if (!groupId) {
      return NextResponse.json({ error: "Group ID is required" }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const page = parsePositiveInteger(searchParams.get("page"), 1)
    const limit = Math.min(parsePositiveInteger(searchParams.get("limit"), 20), 100)
    const eventType = searchParams.get("eventType")
    const status = searchParams.get("status")

    if (eventType && !EVENT_TYPES.has(eventType)) {
      return NextResponse.json({ error: "Invalid eventType filter" }, { status: 400 })
    }

    if (status && !STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 })
    }

    const from = (page - 1) * limit
    const to = from + limit - 1

    let query = supabase
      .from("group_audit_events")
      .select(
        "event_id, group_id, event_type, actor_user_id, target_user_id, transaction_hash, stellar_memo, metadata_hash, status, error_message, created_at, submitted_at",
        { count: "exact" }
      )
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .range(from, to)

    if (eventType) {
      query = query.eq("event_type", eventType)
    }

    if (status) {
      query = query.eq("status", status)
    }

    const { data, error, count } = await query
    if (error) throw error

    return NextResponse.json({
      auditTrail: ((data ?? []) as AuditEventRow[]).map((event) => ({
        eventId: event.event_id,
        groupId: event.group_id,
        eventType: event.event_type,
        actorUserId: event.actor_user_id,
        targetUserId: event.target_user_id,
        transactionHash: event.transaction_hash,
        explorerUrl: event.transaction_hash
          ? getTransactionExplorerUrl(event.transaction_hash)
          : null,
        stellarMemo: event.stellar_memo,
        metadataHash: event.metadata_hash,
        status: event.status,
        error: event.error_message,
        timestamp: event.created_at,
        submittedAt: event.submitted_at,
      })),
      pagination: {
        page,
        limit,
        total: count ?? 0,
        hasMore: from + (data?.length ?? 0) < (count ?? 0),
      },
    })
  } catch (error) {
    console.error("[groups/audit] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch audit trail" }, { status: 500 })
  }
}
