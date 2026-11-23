/**
 * Group join-request collection endpoints.
 *
 * POST /api/groups/[id]/join-requests
 *   Submit a join request for a private group.
 *
 * GET /api/groups/[id]/join-requests?status=pending|approved|rejected|cancelled|all
 *   List join requests. Only group owners and moderators may list requests.
 */
import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import { requireGroupRole } from "@/lib/middleware/group-roles";
import { recordGroupAuditEvent } from "@/lib/blockchain/audit";
import { notifyJoinRequestReceived } from "@/lib/notifications/service";
import {
  mapCreateJoinRequestRpcError,
  mapJoinRequestRow,
  parseJoinRequestStatusFilter,
  validateJoinRequestMessage,
  type CreateJoinRequestRpcRow,
  type GroupJoinRequestRow,
} from "@/lib/groups/join-requests";

type SubmitJoinRequestBody = {
  message?: string;
};

export async function POST(
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
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      console.error("[groups/join-requests] auth error:", authError);
      return NextResponse.json(
        { error: "Unable to verify authentication" },
        { status: 401 },
      );
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: SubmitJoinRequestBody = await request
      .json()
      .catch(() => ({} as SubmitJoinRequestBody));

    const messageError = validateJoinRequestMessage(body.message);
    if (messageError) {
      return NextResponse.json({ error: messageError }, { status: 400 });
    }

    // Eligibility, membership, and duplicate checks run inside the function so
    // private group rows never need to be readable by non-members.
    const { data, error } = await supabase
      .rpc("create_group_join_request", {
        p_group_id: groupId,
        p_message: body.message ?? null,
      })
      .maybeSingle();

    if (error) {
      const mapped = mapCreateJoinRequestRpcError(error);
      if (mapped) {
        return NextResponse.json(
          { error: mapped.error },
          { status: mapped.status },
        );
      }
      throw error;
    }

    const created = data as CreateJoinRequestRpcRow | null;
    if (!created) {
      throw new Error("create_group_join_request returned no row");
    }

    const audit = await recordGroupAuditEvent({
      supabase,
      groupId,
      eventType: "join_request_created",
      actorUserId: user.id,
      targetUserId: user.id,
      metadata: {
        request_id: created.id,
        wallet_address: created.wallet_address,
        has_message: Boolean(created.message),
      },
    });

    if (created.group_owner_user_id && created.group_owner_user_id !== user.id) {
      const notification = await notifyJoinRequestReceived(
        supabase,
        created.group_owner_user_id,
        groupId,
        created.group_name,
        created.wallet_address,
      );

      if (!notification.delivered && notification.deliveryError) {
        console.warn(
          `[groups/join-requests] realtime delivery failed for ${created.group_owner_user_id}: ${notification.deliveryError}`,
        );
      }
    }

    console.info(
      `[groups/join-requests] join request ${created.id} created for group ${groupId} by user ${user.id}`,
    );

    return NextResponse.json(
      {
        success: true,
        request: mapJoinRequestRow(created),
        audit: audit ?? undefined,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error(
      `[groups/join-requests] POST /api/groups/${groupId}/join-requests error:`,
      error,
    );
    return NextResponse.json(
      { error: "Failed to create join request" },
      { status: 500 },
    );
  }
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
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      console.error("[groups/join-requests] auth error:", authError);
      return NextResponse.json(
        { error: "Unable to verify authentication" },
        { status: 401 },
      );
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const roleCheck = await requireGroupRole({
      supabase,
      groupId,
      minimumRole: "moderator",
      userId: user.id,
    });

    if (roleCheck instanceof NextResponse) {
      return roleCheck;
    }

    const statusFilter = parseJoinRequestStatusFilter(
      request.nextUrl.searchParams.get("status"),
    );

    let query = supabase
      .from("group_join_requests")
      .select("*", { count: "exact" })
      .eq("group_id", groupId)
      .order("created_at", { ascending: false });

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    return NextResponse.json({
      success: true,
      group_id: groupId,
      reviewer_role: roleCheck.role,
      status: statusFilter,
      total: count ?? 0,
      requests: ((data ?? []) as GroupJoinRequestRow[]).map(mapJoinRequestRow),
    });
  } catch (error) {
    console.error(
      `[groups/join-requests] GET /api/groups/${groupId}/join-requests error:`,
      error,
    );
    return NextResponse.json(
      { error: "Failed to fetch join requests" },
      { status: 500 },
    );
  }
}
