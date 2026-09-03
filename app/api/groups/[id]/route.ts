/**
 * DELETE /api/groups/[id]
 *
 * Securely deletes a group. Requires:
 *   1. Supabase session authentication
 *   2. Wallet signature over a one-time nonce (proves wallet ownership)
 *   3. Caller must be the group owner
 *
 * Request body:
 *   { walletAddress: string, signature: string }
 */

import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import {
  ensureWalletMatchesUser,
  resolveWalletFromUser,
  verifyWalletAuthorization,
} from "@/lib/auth/wallet-authorization";
import { auditLog } from "@/lib/auth/signed-message-middleware";
import {
  requiresMultisigApproval,
  isMultisigOwner,
  getProposalWithApprovals,
  markProposalExecuted,
} from "@/lib/groups/multisig";

type DeleteGroupBody = {
  walletAddress?: string;
  signature?: string;
  /** When multisig is enabled, callers must supply an approved proposalId */
  proposalId?: string;
};

export async function DELETE(
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
      console.error("[delete-group] auth error:", authError);
      return NextResponse.json(
        { error: "Unable to verify authentication" },
        { status: 401 },
      );
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: DeleteGroupBody = await request.json().catch(() => ({}));

    const auth = await verifyWalletAuthorization(body, "delete_group", {
      supabase,
      groupId,
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
      console.error("[delete-group] profile lookup error:", profileError);
      return NextResponse.json(
        { error: "Failed to retrieve caller profile" },
        { status: 500 },
      );
    }

    const callerWallet = resolveWalletFromUser(user, callerProfile);
    const walletMismatch = ensureWalletMatchesUser(auth.walletAddress, callerWallet);
    if (walletMismatch) {
      return walletMismatch;
    }

    const { data: group, error: groupError } = await supabase
      .from("rooms")
      .select("id, name, created_by")
      .eq("id", groupId)
      .maybeSingle();

    if (groupError) {
      console.error("[delete-group] group lookup error:", groupError);
      return NextResponse.json(
        { error: "Failed to retrieve group" },
        { status: 500 },
      );
    }

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    if (group.created_by !== user.id) {
      console.warn(
        `[delete-group] user ${user.id} attempted delete on group ${groupId} they do not own`,
      );
      return NextResponse.json(
        { error: "Forbidden. Only the group owner can delete this group." },
        { status: 403 },
      );
    }

    // ── Multisig gate ─────────────────────────────────────────────────────────
    const multisigConfig = await requiresMultisigApproval(supabase, groupId);
    if (multisigConfig) {
      const { proposalId } = body;
      if (!proposalId) {
        return NextResponse.json(
          {
            error:
              "This group requires multi-signature approval to delete. " +
              "Create a proposal via POST /api/groups/:id/multisig/propose and include the " +
              "approved proposalId in this request body.",
            multisigRequired: true,
            requiredApprovals: multisigConfig.requiredApprovals,
          },
          { status: 403 },
        );
      }

      // Verify the proposal is approved and targets this action
      const proposal = await getProposalWithApprovals(supabase, proposalId, groupId);
      if (!proposal) {
        return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
      }
      if (proposal.actionType !== "delete_group") {
        return NextResponse.json(
          { error: "Proposal action type does not match delete_group" },
          { status: 400 },
        );
      }
      if (proposal.status !== "approved") {
        return NextResponse.json(
          {
            error: `Proposal is not yet approved (status: ${proposal.status}). ` +
              `${proposal.requiredApprovals - proposal.approvalCount} more approval(s) needed.`,
            proposal,
          },
          { status: 403 },
        );
      }
      if (new Date(proposal.expiresAt) < new Date()) {
        return NextResponse.json({ error: "Proposal has expired" }, { status: 410 });
      }
    } else if (group.created_by !== user.id) {
      // Single-owner path already checked above; this branch is unreachable but kept for safety
      return NextResponse.json(
        { error: "Forbidden. Only the group owner can delete this group." },
        { status: 403 },
      );
    }

    const { data: rpcData, error: rpcError } = await supabase
      .rpc("delete_room_as_owner", { p_room_id: groupId })
      .maybeSingle();

    if (rpcError) {
      if (rpcError.code === "P0002") {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }
      if (rpcError.code === "42501") {
        return NextResponse.json(
          { error: "Forbidden. Only the group owner can delete this group." },
          { status: 403 },
        );
      }

      console.error("[delete-group] RPC error:", rpcError);
      return NextResponse.json(
        { error: "Failed to delete group" },
        { status: 500 },
      );
    }

    auditLog("delete_group", auth.walletAddress, {
      groupId,
      groupName: group.name,
      deletedCounts: rpcData,
    });

    // Mark the multisig proposal as executed if one was used
    if (body.proposalId) {
      await markProposalExecuted(supabase, body.proposalId).catch((e) =>
        console.warn("[delete-group] failed to mark proposal executed:", e),
      );
    }

    console.info(`[delete-group] Group ${groupId} deleted by user ${user.id}`);

    return NextResponse.json(
      {
        success: true,
        group_id: groupId,
        deleted: rpcData,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error(`[delete-group] DELETE /api/groups/${groupId} unexpected error:`, error);
    return NextResponse.json({ error: "Failed to delete group" }, { status: 500 });
  }
}
