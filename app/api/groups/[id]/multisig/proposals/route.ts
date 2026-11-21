/**
 * GET /api/groups/[id]/multisig/proposals
 *
 * Returns paginated proposals for a group. Accessible to all group members
 * so everyone can observe the approval workflow.
 *
 * Query parameters:
 *   page   – page number (default: 1)
 *   limit  – items per page (default: 20, max: 100)
 *   status – filter by status: pending | approved | executed | rejected | expired
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listProposals } from "@/lib/groups/multisig";

const VALID_STATUSES = new Set(["pending", "approved", "executed", "rejected", "expired"]);

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
  if (!groupId) {
    return NextResponse.json({ error: "Group ID is required" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Confirm caller is a group member or owner
    const { data: group } = await supabase
      .from("rooms")
      .select("id, created_by")
      .eq("id", groupId)
      .maybeSingle();

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    if (group.created_by !== user.id) {
      const { data: membership } = await supabase
        .from("room_members")
        .select("user_id")
        .eq("room_id", groupId)
        .eq("user_id", user.id)
        .is("removed_at", null)
        .maybeSingle();

      if (!membership) {
        return NextResponse.json(
          { error: "You are not a member of this group" },
          { status: 403 },
        );
      }
    }

    const { searchParams } = new URL(request.url);
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const limit = Math.min(parsePositiveInt(searchParams.get("limit"), 20), 100);
    const status = searchParams.get("status");

    if (status && !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }

    const { proposals, total } = await listProposals(supabase, groupId, {
      page,
      limit,
      status: status ?? undefined,
    });

    return NextResponse.json({
      groupId,
      proposals,
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error("[multisig/proposals] GET error:", err);
    return NextResponse.json({ error: "Failed to fetch proposals" }, { status: 500 });
  }
}
