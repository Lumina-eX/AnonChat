/**
 * Join request detail and cancellation.
 *
 * GET    /api/join-requests/[requestId]
 * DELETE /api/join-requests/[requestId]  (requester cancels a pending request)
 */
import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import { requireGroupRole } from "@/lib/middleware/group-roles";
import { recordGroupAuditEvent } from "@/lib/blockchain/audit";
import {
  mapJoinRequestRow,
  type GroupJoinRequestRow,
} from "@/lib/groups/join-requests";

async function loadRequest(
  supabase: Awaited<ReturnType<typeof createClient>>,
  requestId: string,
) {
  return supabase
    .from("group_join_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;

  if (!requestId) {
    return NextResponse.json(
      { error: "Request ID is required" },
      { status: 400 },
    );
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      console.error("[join-requests] auth error:", authError);
      return NextResponse.json(
        { error: "Unable to verify authentication" },
        { status: 401 },
      );
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: record, error } = await loadRequest(supabase, requestId);

    if (error) throw error;
    if (!record) {
      return NextResponse.json(
        { error: "Join request not found" },
        { status: 404 },
      );
    }

    if (record.user_id !== user.id) {
      const roleCheck = await requireGroupRole({
        supabase,
        groupId: record.group_id,
        minimumRole: "moderator",
        userId: user.id,
      });

      if (roleCheck instanceof NextResponse) {
        return roleCheck;
      }
    }

    return NextResponse.json({
      success: true,
      request: mapJoinRequestRow(record as GroupJoinRequestRow),
    });
  } catch (error) {
    console.error(
      `[join-requests] GET /api/join-requests/${requestId} error:`,
      error,
    );
    return NextResponse.json(
      { error: "Failed to fetch join request" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;

  if (!requestId) {
    return NextResponse.json(
      { error: "Request ID is required" },
      { status: 400 },
    );
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      console.error("[join-requests] auth error:", authError);
      return NextResponse.json(
        { error: "Unable to verify authentication" },
        { status: 401 },
      );
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: record, error } = await loadRequest(supabase, requestId);
    if (error) throw error;
    if (!record) {
      return NextResponse.json(
        { error: "Join request not found" },
        { status: 404 },
      );
    }

    if (record.user_id !== user.id) {
      return NextResponse.json(
        { error: "Only the requester can cancel this join request." },
        { status: 403 },
      );
    }

    if (record.status !== "pending") {
      return NextResponse.json(
        { error: "Only pending join requests can be cancelled." },
        { status: 409 },
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("group_join_requests")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      return NextResponse.json(
        { error: "Join request has already been reviewed." },
        { status: 409 },
      );
    }

    const audit = await recordGroupAuditEvent({
      supabase,
      groupId: record.group_id,
      eventType: "join_request_cancelled",
      actorUserId: user.id,
      targetUserId: user.id,
      metadata: {
        request_id: requestId,
        wallet_address: record.wallet_address,
      },
    });

    return NextResponse.json({
      success: true,
      request: mapJoinRequestRow(updated as GroupJoinRequestRow),
      audit: audit ?? undefined,
    });
  } catch (error) {
    console.error(
      `[join-requests] DELETE /api/join-requests/${requestId} error:`,
      error,
    );
    return NextResponse.json(
      { error: "Failed to cancel join request" },
      { status: 500 },
    );
  }
}
