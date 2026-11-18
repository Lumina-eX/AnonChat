/**
 * POST /api/groups/[id]/multisig/approve
 *
 * A co-owner approves an existing pending proposal by supplying their
 * Ed25519 signature over the canonical proposal hash.
 *
 * Request body:
 * {
 *   proposalId:   string  // UUID of the proposal to approve
 *   walletAddress: string  // Approver's Stellar public key
 *   signature:    string  // Ed25519 hex sig over SHA-256(proposalId + groupId + actionType + actionPayload)
 * }
 *
 * The signature is NOT over a nonce here — it is over the proposal hash
 * (deterministic, computed from proposal content). This allows co-owners to
 * sign offline and submit the approval later, which is the correct multi-sig
 * security model. The nonce is still consumed to prevent replay of the HTTP
 * request itself.
 *
 * Flow:
 *  1. Authenticate via Supabase session + wallet nonce (prevents HTTP replay)
 *  2. Verify caller is an active co-owner
 *  3. Fetch the proposal and validate it is still "pending"
 *  4. Verify Ed25519 signature over the canonical proposal hash
 *  5. Record the approval
 *  6. If quorum is reached → update proposal to "approved"
 *  7. Return updated proposal + whether quorum was reached
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  verifyWalletAuthorization,
  ensureWalletMatchesUser,
  resolveWalletFromUser,
} from "@/lib/auth/wallet-authorization";
import {
  getMultisigConfig,
  isMultisigOwner,
  addApproval,
} from "@/lib/groups/multisig";

type ApproveBody = {
  proposalId?: string;
  walletAddress?: string;
  signature?: string;
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

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: ApproveBody = await request.json().catch(() => ({}));

    const { proposalId } = body;
    if (!proposalId || typeof proposalId !== "string" || proposalId.trim() === "") {
      return NextResponse.json({ error: "proposalId is required" }, { status: 400 });
    }

    // Verify wallet ownership via nonce (prevents HTTP replay of approval requests)
    const auth = await verifyWalletAuthorization(body, "multisig_approve", {
      supabase,
      groupId,
    });
    if (!auth.ok) return auth.response;

    // Ensure wallet belongs to the authenticated user
    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .eq("id", user.id)
      .maybeSingle();

    const callerWallet = resolveWalletFromUser(user, callerProfile);
    const walletMismatch = ensureWalletMatchesUser(auth.walletAddress, callerWallet);
    if (walletMismatch) return walletMismatch;

    // Confirm group exists
    const { data: group } = await supabase
      .from("rooms")
      .select("id, created_by")
      .eq("id", groupId)
      .maybeSingle();

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Confirm multisig is enabled
    const config = await getMultisigConfig(supabase, groupId);
    if (!config) {
      return NextResponse.json(
        { error: "Multisig is not enabled for this group" },
        { status: 400 },
      );
    }

    // Caller must be an active co-owner
    const callerIsOwner =
      group.created_by === user.id ||
      (await isMultisigOwner(supabase, groupId, auth.walletAddress));

    if (!callerIsOwner) {
      return NextResponse.json(
        { error: "Only a registered co-owner can approve a proposal" },
        { status: 403 },
      );
    }

    // Add the approval (signature is verified against proposal hash inside addApproval)
    const result = await addApproval(supabase, {
      proposalId: proposalId.trim(),
      groupId,
      approverUserId: user.id,
      approverWallet: auth.walletAddress,
      signature: body.signature!,
      signedNonce: auth.nonce,
    });

    if (!result.ok) {
      const status =
        result.error === "Proposal not found"
          ? 404
          : result.error?.includes("already approved")
            ? 409
            : result.error?.includes("Signature")
              ? 401
              : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    console.info(
      `[multisig/approve] approval recorded for proposal ${proposalId} by ` +
        `${auth.walletAddress.substring(0, 8)}... quorum=${result.quorumReached}`,
    );

    return NextResponse.json({
      success: true,
      proposal: result.proposal,
      quorumReached: result.quorumReached,
      message: result.quorumReached
        ? "Quorum reached. The proposal is approved and can now be executed."
        : `Approval recorded. ${
            (result.proposal?.requiredApprovals ?? config.requiredApprovals) -
            (result.proposal?.approvalCount ?? 1)
          } more approval(s) needed.`,
    });
  } catch (err) {
    console.error("[multisig/approve] POST error:", err);
    return NextResponse.json({ error: "Failed to record approval" }, { status: 500 });
  }
}
