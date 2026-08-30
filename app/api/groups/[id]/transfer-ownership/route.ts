/**
 * POST /api/groups/[id]/transfer-ownership
 *
 * Allows the current group owner to transfer ownership to another member.
 *
 * Request body:
 * {
 * walletAddress: string           // Caller's Stellar public key
 * signature: string               // Hex-encoded Ed25519 signature of the nonce
 * newOwnerWalletAddress: string   // Stellar public key of the new owner
 * }
 *
 * Flow:
 * 1. Authenticate caller via Supabase session
 * 2. Validate inputs (wallet address format, required fields)
 * 3. Consume the one-time nonce for the caller's wallet (prevents replay)
 * 4. Verify the Ed25519 signature over the nonce
 * 5. Resolve the new owner's user ID from their wallet address
 * 6. Confirm the new owner is an active member of the group
 * 7. Call transfer_room_ownership RPC (atomic DB update + audit log)
 * 8. Write a room_activity_logs entry for transparency
 * 9. Optionally submit a Stellar transaction recording the transfer on-chain
 */

import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { validateWalletAddressWithMessage } from "@/lib/auth/validation"
import {
  ensureWalletMatchesUser,
  resolveWalletFromUser,
  verifyWalletAuthorization,
} from "@/lib/auth/wallet-authorization"
import { verifyWalletSignature } from "@/lib/auth/stellar-verify";
import { auditLog } from "@/lib/auth/signed-message-middleware"
import { insertRoomActivity } from "@/lib/activity/room-activity"
import {
  submitMetadataHash,
  getTransactionExplorerUrl,
} from "@/lib/blockchain/stellar-service"
import { computeHash } from "@/lib/blockchain/metadata-hash"
import {
  logBlockchainOperation,
  generateCorrelationId,
} from "@/lib/blockchain/logger"
import type { SupabaseClient } from "@supabase/supabase-js"
import { requireGroupOwner } from "@/lib/middleware/group-ownership"
import { notifyOwnershipTransferred } from "@/lib/notifications/service"
import {
  requiresMultisigApproval,
  getProposalWithApprovals,
  markProposalExecuted,
} from "@/lib/groups/multisig"

// ── Types ─────────────────────────────────────────────────────────────────────

type TransferOwnershipBody = {
  newOwnerWalletAddress?: string
  walletAddress?: string
  signature?: string
  /** When multisig is enabled, supply an approved proposalId to authorise the transfer */
  proposalId?: string
}

type RpcTransferResult = {
  transferred_room_id: string
  previous_owner_id: string
  new_owner_id: string
  transfer_log_id: string
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = generateCorrelationId()
  const { id: groupId } = await params

  if (!groupId) {
    return NextResponse.json({ error: "Group ID is required" }, { status: 400 })
  }

  try {
    const supabase = await createClient()

    // ── 1. Authenticate caller ────────────────────────────────────────────────
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError) {
      console.error("[transfer-ownership] auth error:", authError)
      return NextResponse.json(
        { error: "Unable to verify authentication" },
        { status: 401 }
      )
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // ── 2. Parse and validate request body ───────────────────────────────────
    const body: TransferOwnershipBody = await request.json().catch(() => ({}))

    const { newOwnerWalletAddress, walletAddress, signature } = body

    if (!newOwnerWalletAddress) {
      return NextResponse.json(
        { error: "newOwnerWalletAddress is required" },
        { status: 400 }
      )
    }

    const walletError = validateWalletAddressWithMessage(newOwnerWalletAddress)
    if (walletError) {
      return NextResponse.json({ error: walletError }, { status: 400 })
    }

    // ── 3. Verify wallet authorization (nonce + signature) ──────────────────
    const auth = await verifyWalletAuthorization(
      { walletAddress, signature },
      "transfer_ownership",
      { supabase, groupId },
    )
    if (!auth.ok) {
      return auth.response
    }

    const { data: callerProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError) {
      console.error("[transfer-ownership] profile lookup error:", profileError)
      return NextResponse.json(
        { error: "Failed to retrieve caller profile" },
        { status: 500 }
      )
    }

    const callerWallet = resolveWalletFromUser(user, callerProfile)
    const walletMismatch = ensureWalletMatchesUser(auth.walletAddress, callerWallet)
    if (walletMismatch) {
      return walletMismatch
    }

    // ── Guard: callerWallet must be non-null before signature verification ────
    if (!callerWallet) {
      return NextResponse.json(
        { error: "No wallet address associated with this account." },
        { status: 400 }
      )
    }

    const nonce = auth.nonce

    // ── 5. Verify the Ed25519 signature ───────────────────────────────────────
    if (!signature) {
      return NextResponse.json(
        { error: "Signature is required for verification." },
        { status: 400 }
      )
    }

    const isValid = verifyWalletSignature(callerWallet, nonce, signature)

    // ── 6. Verify the group exists and the caller is the current owner ────────
    const ownerCheck = await requireGroupOwner({
      supabase,
      groupId,
      callerWallet,
      userId: user.id,
    })

    if (ownerCheck instanceof NextResponse) {
      return ownerCheck
    }

    // ── 4. Verify the group exists and the caller is the current owner ────────
    const { data: group, error: groupError } = await supabase
      .from("rooms")
      .select("id, name, created_by, is_private")
      .eq("id", groupId)
      .maybeSingle()

    if (groupError) {
      console.error("[transfer-ownership] group lookup error:", groupError)
      return NextResponse.json(
        { error: "Failed to retrieve group" },
        { status: 500 }
      )
    }

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 })
    }

    if (group.created_by !== user.id) {
      console.warn(
        `[transfer-ownership] user ${user.id} attempted transfer on group ${groupId} they do not own`
      )
      return NextResponse.json(
        { error: "Forbidden. Only the current group owner can transfer ownership." },
        { status: 403 }
      )
    }

    // ── Multisig gate ─────────────────────────────────────────────────────────
    const multisigConfig = await requiresMultisigApproval(supabase, groupId)
    if (multisigConfig) {
      const { proposalId } = body
      if (!proposalId) {
        return NextResponse.json(
          {
            error:
              "This group requires multi-signature approval to transfer ownership. " +
              "Create a proposal via POST /api/groups/:id/multisig/propose and include the " +
              "approved proposalId in this request body.",
            multisigRequired: true,
            requiredApprovals: multisigConfig.requiredApprovals,
          },
          { status: 403 },
        )
      }

      const proposal = await getProposalWithApprovals(supabase, proposalId, groupId)
      if (!proposal) {
        return NextResponse.json({ error: "Proposal not found" }, { status: 404 })
      }
      if (proposal.actionType !== "transfer_ownership") {
        return NextResponse.json(
          { error: "Proposal action type does not match transfer_ownership" },
          { status: 400 },
        )
      }
      if (proposal.status !== "approved") {
        return NextResponse.json(
          {
            error: `Proposal is not yet approved (status: ${proposal.status}). ` +
              `${proposal.requiredApprovals - proposal.approvalCount} more approval(s) needed.`,
            proposal,
          },
          { status: 403 },
        )
      }
      if (new Date(proposal.expiresAt) < new Date()) {
        return NextResponse.json({ error: "Proposal has expired" }, { status: 410 })
      }
      // Validate the newOwnerWallet matches the proposal payload
      const payloadWallet = proposal.actionPayload?.newOwnerWallet
      if (payloadWallet && payloadWallet !== newOwnerWalletAddress) {
        return NextResponse.json(
          { error: "newOwnerWalletAddress does not match the approved proposal payload" },
          { status: 400 },
        )
      }
    }

    // ── 7. Resolve the new owner's user ID from their wallet address ──────────
    const { data: newOwnerProfile, error: newOwnerProfileError } =
      await supabase
        .from("profiles")
        .select("id, wallet_address")
        .eq("wallet_address", newOwnerWalletAddress)
        .maybeSingle()

    if (newOwnerProfileError) {
      console.error(
        "[transfer-ownership] new owner profile lookup error:",
        newOwnerProfileError
      )
      return NextResponse.json(
        { error: "Failed to look up new owner profile" },
        { status: 500 }
      )
    }

    if (!newOwnerProfile) {
      return NextResponse.json(
        {
          error:
            "New owner wallet address not found. The new owner must have logged in at least once.",
        },
        { status: 404 }
      )
    }

    const newOwnerId: string = newOwnerProfile.id

    if (newOwnerId === user.id) {
      return NextResponse.json(
        { error: "New owner must be different from the current owner." },
        { status: 400 }
      )
    }

    // ── 8. Confirm the new owner is an active member of the group ─────────────
    // Check room_members (user-based) first, then group_membership (wallet-based)
    const { data: roomMember } = await supabase
      .from("room_members")
      .select("user_id, removed_at")
      .eq("room_id", groupId)
      .eq("user_id", newOwnerId)
      .maybeSingle()

    const newOwnerIsRoomMember =
      roomMember !== null && roomMember.removed_at === null

    let newOwnerIsGroupMember = false
    if (!newOwnerIsRoomMember) {
      const { data: groupMember } = await supabase
        .from("group_membership")
        .select("id")
        .eq("group_id", groupId)
        .eq("wallet_address", newOwnerWalletAddress)
        .maybeSingle()

      newOwnerIsGroupMember = groupMember !== null
    }

    if (!newOwnerIsRoomMember && !newOwnerIsGroupMember) {
      return NextResponse.json(
        {
          error:
            "The new owner must be an active member of the group before ownership can be transferred.",
        },
        { status: 422 }
      )
    }

    // ── 9. Optional: submit on-chain record of the transfer ───────────────────
    let stellarTxHash: string | null = null
    let explorerUrl: string | null = null

    try {
      const transferMetadata = {
        event: "ownership_transferred",
        group_id: groupId,
        previous_owner: callerWallet,
        new_owner: newOwnerWalletAddress,
        timestamp: new Date().toISOString(),
      }
      const metadataHash = computeHash(transferMetadata as any)
      const result = await submitMetadataHash(groupId, metadataHash)

      if (result.success && result.transactionHash) {
        stellarTxHash = result.transactionHash
        explorerUrl = getTransactionExplorerUrl(result.transactionHash)

        logBlockchainOperation(
          "info",
          "Ownership transfer recorded on-chain",
          { groupId, transactionHash: stellarTxHash },
          correlationId
        )
      } else {
        logBlockchainOperation(
          "warn",
          "On-chain recording skipped or failed — transfer will proceed off-chain",
          { groupId, error: result.error ? { type: "BlockchainError", message: result.error } : undefined },
          correlationId
        )
      }
    } catch (blockchainErr: any) {
      // Non-fatal: the DB transfer is the source of truth
      logBlockchainOperation(
        "error",
        "Blockchain submission error during ownership transfer",
        {
          groupId,
          error: {
            type: blockchainErr.name || "UnknownError",
            message: blockchainErr.message || "Unknown error",
          },
        },
        correlationId
      )
    }

    // ── 10. Atomically transfer ownership + write audit log via RPC ───────────
    const { data: rpcData, error: rpcError } = await supabase
      .rpc("transfer_room_ownership", {
        p_room_id: groupId,
        p_new_owner_id: newOwnerId,
        p_signature: signature,
        p_signed_nonce: nonce,
        p_previous_owner_wallet: callerWallet,
        p_new_owner_wallet: newOwnerWalletAddress,
        p_stellar_tx_hash: stellarTxHash,
      })
      .maybeSingle()

    if (rpcError) {
      // Map well-known Postgres error codes to HTTP responses
      if (rpcError.code === "P0002") {
        return NextResponse.json({ error: "Group not found" }, { status: 404 })
      }
      if (rpcError.code === "42501") {
        return NextResponse.json(
          { error: "Forbidden. Only the current group owner can transfer ownership." },
          { status: 403 }
        )
      }
      if (rpcError.code === "22023") {
        return NextResponse.json(
          { error: "New owner must be different from the current owner." },
          { status: 400 }
        )
      }

      console.error("[transfer-ownership] RPC error:", rpcError)
      return NextResponse.json(
        { error: "Failed to transfer ownership" },
        { status: 500 }
      )
    }

    const result = rpcData as RpcTransferResult | null

    // ── 11. Write room_activity_logs entry (best-effort, non-fatal) ───────────
    try {
      await insertRoomActivity(supabase as unknown as SupabaseClient, {
        room_id: groupId,
        event_type: "ownership_transferred",
        actor_user_id: user.id,
        target_user_id: newOwnerId,
        metadata: {
          previous_owner_wallet: callerWallet,
          new_owner_wallet: newOwnerWalletAddress,
          transfer_log_id: result?.transfer_log_id ?? null,
          stellar_tx_hash: stellarTxHash,
        },
      })
    } catch (activityErr) {
      console.warn(
        "[transfer-ownership] failed to insert ownership_transferred activity log:",
        activityErr
      )
    }

    auditLog("transfer_ownership", auth.walletAddress, {
      groupId,
      newOwnerWalletAddress,
      transferLogId: result?.transfer_log_id ?? null,
    })

    // Mark the multisig proposal as executed if one was used
    if (body.proposalId) {
      await markProposalExecuted(supabase, body.proposalId).catch((e) =>
        console.warn("[transfer-ownership] failed to mark proposal executed:", e),
      )
    }

    console.info(
      `[transfer-ownership] Group ${groupId} ownership transferred from user ${user.id} to user ${newOwnerId}`
    )

    const [newOwnerNotification, previousOwnerNotification] = await Promise.all([
      notifyOwnershipTransferred(supabase, {
        userId: newOwnerId,
        groupId,
        groupName: group.name,
        role: "new_owner",
      }),
      notifyOwnershipTransferred(supabase, {
        userId: user.id,
        groupId,
        groupName: group.name,
        role: "previous_owner",
        counterpartyWallet: newOwnerWalletAddress,
      }),
    ])

    for (const result of [newOwnerNotification, previousOwnerNotification]) {
      if (!result.delivered && result.deliveryError) {
        console.warn(
          `[transfer-ownership] Notification stored but realtime delivery failed: ${result.deliveryError}`,
        )
      }
    }

    return NextResponse.json(
      {
        success: true,
        group_id: groupId,
        previous_owner_id: result?.previous_owner_id ?? user.id,
        new_owner_id: result?.new_owner_id ?? newOwnerId,
        transfer_log_id: result?.transfer_log_id ?? null,
        blockchain: {
          submitted: stellarTxHash !== null,
          transactionHash: stellarTxHash ?? undefined,
          explorerUrl: explorerUrl ?? undefined,
        },
        notifications: {
          new_owner: newOwnerNotification.notification ?? undefined,
          previous_owner: previousOwnerNotification.notification ?? undefined,
        },
      },
      { status: 200 }
    )
  } catch (error) {
    console.error(
      `[transfer-ownership] POST /api/groups/${groupId}/transfer-ownership unexpected error:`,
      error
    )
    logBlockchainOperation(
      "error",
      "Unexpected error during ownership transfer",
      {
        groupId,
        error: {
          type: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      },
      correlationId
    )
    return NextResponse.json(
      { error: "Failed to transfer ownership" },
      { status: 500 }
    )
  }
}