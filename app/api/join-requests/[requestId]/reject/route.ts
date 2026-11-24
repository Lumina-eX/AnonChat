/**
 * POST /api/join-requests/[requestId]/reject
 *
 * Rejects a pending join request. Requires:
 *   1. Supabase session authentication
 *   2. Wallet signature over a one-time nonce
 *   3. Caller must be a group owner or moderator
 */
import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import {
  ensureWalletMatchesUser,
  resolveWalletFromUser,
  verifyWalletAuthorization,
  type WalletAuthPayload,
} from "@/lib/auth/wallet-authorization";
import { recordGroupAuditEvent } from "@/lib/blockchain/audit";
import { notifyJoinRequestReviewed } from "@/lib/notifications/service";
import {
  mapJoinRequestRow,
  mapReviewJoinRequestRpcError,
  type RejectJoinRequestRpcRow,
} from "@/lib/groups/join-requests";

type RejectJoinRequestBody = WalletAuthPayload & {
  reason?: string;
};

export async function POST(
  request: NextRequest,
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
      console.error("[join-requests/reject] auth error:", authError);
      return NextResponse.json(
        { error: "Unable to verify authentication" },
        { status: 401 },
      );
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: joinRequest, error: requestError } = await supabase
      .from("group_join_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    if (requestError) throw requestError;
    if (!joinRequest) {
      return NextResponse.json(
        { error: "Join request not found" },
        { status: 404 },
      );
    }

    if (joinRequest.status !== "pending") {
      return NextResponse.json(
        { error: "Join request has already been reviewed." },
        { status: 409 },
      );
    }

    const body: RejectJoinRequestBody = await request
      .json()
      .catch(() => ({}));

    const auth = await verifyWalletAuthorization(body, "reject_join_request", {
      supabase,
      groupId: joinRequest.group_id,
    });
    if (!auth.ok) {
      return auth.response;
    }

    const { data: callerProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error(
        "[join-requests/reject] profile lookup error:",
        profileError,
      );
      return NextResponse.json(
        { error: "Failed to retrieve caller profile" },
        { status: 500 },
      );
    }

    const callerWallet = resolveWalletFromUser(user, callerProfile);
    const walletMismatch = ensureWalletMatchesUser(
      auth.walletAddress,
      callerWallet,
    );
    if (walletMismatch) {
      return walletMismatch;
    }

    const { data: rpcData, error: rpcError } = await supabase
      .rpc("reject_group_join_request", {
        p_request_id: requestId,
        p_actor_wallet: callerWallet,
      })
      .maybeSingle();

    if (rpcError) {
      const mapped = mapReviewJoinRequestRpcError(rpcError);
      if (mapped) {
        return NextResponse.json(
          { error: mapped.error },
          { status: mapped.status },
        );
      }

      console.error("[join-requests/reject] rejection RPC error:", rpcError);
      return NextResponse.json(
        { error: "Failed to reject join request" },
        { status: 500 },
      );
    }

    const updated = rpcData as RejectJoinRequestRpcRow | null;
    if (!updated) {
      console.error(
        `[join-requests/reject] rejection RPC returned no row for ${requestId}`,
      );
      return NextResponse.json(
        { error: "Failed to reject join request" },
        { status: 500 },
      );
    }

    const audit = await recordGroupAuditEvent({
      supabase,
      groupId: joinRequest.group_id,
      eventType: "join_request_rejected",
      actorUserId: user.id,
      targetUserId: joinRequest.user_id,
      metadata: {
        request_id: requestId,
        wallet_address: joinRequest.wallet_address,
        reviewer_role: updated.actor_role,
        reason:
          typeof body.reason === "string" && body.reason.trim()
            ? body.reason.trim().slice(0, 500)
            : null,
      },
    });

    const notification = await notifyJoinRequestReviewed(
      supabase,
      joinRequest.user_id,
      joinRequest.group_id,
      updated.group_name,
      "rejected",
    );

    if (!notification.delivered && notification.deliveryError) {
      console.warn(
        `[join-requests/reject] notification delivery failed for ${joinRequest.user_id}: ${notification.deliveryError}`,
      );
    }

    console.info(
      `[join-requests/reject] request ${requestId} rejected by user ${user.id}`,
    );

    return NextResponse.json({
      success: true,
      request: mapJoinRequestRow(updated),
      audit: audit ?? undefined,
      notification: notification.notification ?? undefined,
    });
  } catch (error) {
    console.error(
      `[join-requests/reject] POST /api/join-requests/${requestId}/reject error:`,
      error,
    );
    return NextResponse.json(
      { error: "Failed to reject join request" },
      { status: 500 },
    );
  }
}
