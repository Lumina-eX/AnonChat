/**
 * POST /api/groups/[id]/multisig/propose
 *
 * A co-owner opens a new approval proposal for a sensitive group action.
 * The proposer's own signature counts as the first approval toward quorum.
 *
 * Request body:
 * {
 *   walletAddress:  string              // Caller's Stellar public key
 *   signature:      string              // Ed25519 hex sig of the nonce
 *   actionType:     MultisigActionType  // e.g. "delete_group"
 *   actionPayload?: Record<string, unknown>  // e.g. { newOwnerWallet: "G..." }
 *   expiresInHours?: number             // Default: 24
 * }
 *
 * Flow:
 *  1. Authenticate caller (Supabase session + wallet signature over nonce)
 *  2. Verify caller is an active co-owner of the group
 *  3. Validate actionType & payload
 *  4. Insert proposal + first approval (proposer counts as first signer)
 *  5. If requiredApprovals == 1 the proposal transitions to "approved" immediately
 *  6. Return the proposal object (callers can poll /proposals or /approve next)
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
  createProposal,
} from "@/lib/groups/multisig";
import type { MultisigActionType } from "@/types/blockchain";

const VALID_ACTION_TYPES = new Set<MultisigActionType>([
  "delete_group",
  "transfer_ownership",
  "remove_member",
  "regenerate_invite",
  "update_multisig_owners",
]);

type ProposeBody = {
  walletAddress?: string;
  signature?: string;
  actionType?: MultisigActionType;
  actionPayload?: Record<string, unknown>;
  expiresInHours?: number;
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

    const body: ProposeBody = await request.json().catch(() => ({}));

    // Verify wallet signature over nonce
    const auth = await verifyWalletAuthorization(body, "multisig_propose", {
      supabase,
      groupId,
    });
    if (!auth.ok) return auth.response;

    // Ensure wallet matches authenticated user
    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .eq("id", user.id)
      .maybeSingle();

    const callerWallet = resolveWalletFromUser(user, callerProfile);
    const walletMismatch = ensureWalletMatchesUser(auth.walletAddress, callerWallet);
    if (walletMismatch) return walletMismatch;

    // Validate actionType
    const { actionType, actionPayload = {}, expiresInHours } = body;
    if (!actionType || !VALID_ACTION_TYPES.has(actionType)) {
      return NextResponse.json(
        { error: `actionType must be one of: ${[...VALID_ACTION_TYPES].join(", ")}` },
        { status: 400 },
      );
    }

    // Confirm group exists
    const { data: group } = await supabase
      .from("rooms")
      .select("id, name, created_by")
      .eq("id", groupId)
      .maybeSingle();

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Confirm multisig is enabled for this group
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
        { error: "Only a registered co-owner can propose an action" },
        { status: 403 },
      );
    }

    // Validate action-specific payload
    const payloadError = validateActionPayload(actionType, actionPayload);
    if (payloadError) {
      return NextResponse.json({ error: payloadError }, { status: 400 });
    }

    // Create proposal (proposer's approval is recorded internally)
    const result = await createProposal(supabase, {
      groupId,
      actionType,
      actionPayload,
      proposedBy: user.id,
      proposerWallet: auth.walletAddress,
      proposerSignature: body.signature!,
      signedNonce: auth.nonce,
      requiredApprovals: config.requiredApprovals,
      expiresInHours: expiresInHours ?? 24,
    });

    if (!result.ok || !result.proposal) {
      return NextResponse.json(
        { error: result.error ?? "Failed to create proposal" },
        { status: 500 },
      );
    }

    console.info(
      `[multisig/propose] proposal ${result.proposal.id} created for group ${groupId} ` +
        `action=${actionType} by ${auth.walletAddress.substring(0, 8)}...`,
    );

    const statusCode = result.proposal.status === "approved" ? 201 : 202;

    return NextResponse.json(
      {
        success: true,
        proposal: result.proposal,
        message:
          result.proposal.status === "approved"
            ? "Proposal approved immediately (single-owner quorum reached). Execute the action now."
            : `Proposal created. Waiting for ${config.requiredApprovals - 1} more approval(s).`,
      },
      { status: statusCode },
    );
  } catch (err) {
    console.error("[multisig/propose] POST error:", err);
    return NextResponse.json({ error: "Failed to create proposal" }, { status: 500 });
  }
}

// ── Payload validators ────────────────────────────────────────────────────────

function validateActionPayload(
  actionType: MultisigActionType,
  payload: Record<string, unknown>,
): string | null {
  switch (actionType) {
    case "transfer_ownership": {
      if (
        typeof payload.newOwnerWallet !== "string" ||
        payload.newOwnerWallet.length !== 56 ||
        !payload.newOwnerWallet.startsWith("G")
      ) {
        return "transfer_ownership requires a valid newOwnerWallet in actionPayload";
      }
      break;
    }
    case "remove_member": {
      if (
        typeof payload.targetUserId !== "string" ||
        payload.targetUserId.trim() === ""
      ) {
        return "remove_member requires targetUserId in actionPayload";
      }
      break;
    }
    case "update_multisig_owners": {
      if (
        !Array.isArray(payload.add) &&
        !Array.isArray(payload.remove) &&
        typeof payload.requiredApprovals !== "number"
      ) {
        return "update_multisig_owners requires at least one of: add (array), remove (array), requiredApprovals (number)";
      }
      break;
    }
    case "delete_group":
    case "regenerate_invite":
      // No payload required
      break;
  }
  return null;
}
