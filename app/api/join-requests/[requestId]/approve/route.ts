/**
 * POST /api/join-requests/[requestId]/approve
 *
 * Approves a pending join request. Requires:
 *   1. Supabase session authentication
 *   2. Wallet signature over a one-time nonce
 *   3. Caller must be a group owner or moderator
 *
 * Membership creation and request status update happen atomically inside the
 * approve_group_join_request database function.
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
import { mapReviewJoinRequestRpcError } from "@/lib/groups/join-requests";

type ApproveJoinRequestBody = WalletAuthPayload;

type ApproveRpcResult = {
  request_id: string;
  group_id: string;
  requester_user_id: string;
  wallet_address: string;
  membership_id: string;
  group_name: string;
  actor_role: string;
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
      console.error("[join-requests/approve] auth error:", authError);
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

    const body: ApproveJoinRequestBody = await request
      .json()
      .catch(() => ({}));

    const auth = await verifyWalletAuthorization(
      body,
      "approve_join_request",
      { supabase, groupId: joinRequest.group_id },
    );
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
        "[join-requests/approve] profile lookup error:",
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
      .rpc("approve_group_join_request", {
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

      console.error("[join-requests/approve] approval RPC error:", rpcError);
      return NextResponse.json(
        { error: "Failed to approve join request" },
        { status: 500 },
      );
    }

    const approval = rpcData as ApproveRpcResult | null;
    if (!approval) {
      console.error(
        `[join-requests/approve] approval RPC returned no row for ${requestId}`,
      );
      return NextResponse.json(
        { error: "Failed to approve join request" },
        { status: 500 },
      );
    }

    const audit = await recordGroupAuditEvent({
      supabase,
      groupId: joinRequest.group_id,
      eventType: "join_request_approved",
      actorUserId: user.id,
      targetUserId: joinRequest.user_id,
      metadata: {
        request_id: requestId,
        wallet_address: joinRequest.wallet_address,
        reviewer_role: approval.actor_role,
        membership_id: approval.membership_id ?? null,
      },
    });

    const notification = await notifyJoinRequestReviewed(
      supabase,
      joinRequest.user_id,
      joinRequest.group_id,
      approval.group_name,
      "approved",
    );

    if (!notification.delivered && notification.deliveryError) {
      console.warn(
        `[join-requests/approve] notification delivery failed for ${joinRequest.user_id}: ${notification.deliveryError}`,
      );
    }

    console.info(
      `[join-requests/approve] request ${requestId} approved by user ${user.id} for wallet ${joinRequest.wallet_address.slice(0, 8)}...`,
    );

    return NextResponse.json({
      success: true,
      request_id: requestId,
      group_id: joinRequest.group_id,
      status: "approved",
      wallet_address: joinRequest.wallet_address,
      membership_id: approval.membership_id ?? null,
      audit: audit ?? undefined,
      notification: notification.notification ?? undefined,
    });
  } catch (error) {
    console.error(
      `[join-requests/approve] POST /api/join-requests/${requestId}/approve error:`,
      error,
    );
    return NextResponse.json(
      { error: "Failed to approve join request" },
      { status: 500 },
    );
  }
}
