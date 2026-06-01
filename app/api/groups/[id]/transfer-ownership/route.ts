/**
 * POST /api/groups/[id]/transfer-ownership
 *
 * Allows the current group owner to transfer ownership to another member.
 *
 * Request body:
 *   {
 *     newOwnerWalletAddress: string   // Stellar public key of the new owner
 *     signature: string               // Hex-encoded Ed25519 signature of the nonce
 *   }
 *
 * Flow:
 *   1. Authenticate caller via Supabase session
 *   2. Validate inputs (wallet address format, required fields)
 *   3. Consume the one-time nonce for the caller's wallet (prevents replay)
 *   4. Verify the Ed25519 signature over the nonce
 *   5. Resolve the new owner's user ID from their wallet address
 *   6. Confirm the new owner is an active member of the group
 *   7. Call transfer_room_ownership RPC (atomic DB update + audit log)
 *   8. Write a room_activity_logs entry for transparency
 *   9. Optionally submit a Stellar transaction recording the transfer on-chain
 */

import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { consumeNonce, verifyWalletSignature } from "@/lib/auth/stellar-verify"
import { validateWalletAddressWithMessage } from "@/lib/auth/validation"
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

// ── Types ─────────────────────────────────────────────────────────────────────

type TransferOwnershipBody = {
  newOwnerWalletAddress?: string
  signature?: string
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

    const { newOwnerWalletAddress, signature } = body

    if (!newOwnerWalletAddress || !signature) {
      return NextResponse.json(
        { error: "newOwnerWalletAddress and signature are required" },
        { status: 400 }
      )
    }

    const walletError = validateWalletAddressWithMessage(newOwnerWalletAddress)
    if (walletError) {
      return NextResponse.json({ error: walletError }, { status: 400 })
    }

    if (typeof signature !== "string" || signature.trim() === "") {
      return NextResponse.json(
        { error: "signature is required" },
        { status: 400 }
      )
    }

    // ── 3. Resolve the caller's wallet address from their profile ─────────────
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

    const callerWallet: string | null =
      callerProfile?.wallet_address ??
      // Fallback: wallet address is encoded in the deterministic email
      (user.email?.endsWith("@wallet.anonchat.local")
        ? user.email.replace("@wallet.anonchat.local", "")
        : null)

    if (!callerWallet) {
      return NextResponse.json(
        { error: "Could not determine caller wallet address" },
        { status: 400 }
      )
    }

    // ── 4. Consume the one-time nonce (prevents replay attacks) ──────────────
    const nonce = await consumeNonce(callerWallet)
    if (!nonce) {
      console.warn(
        `[transfer-ownership] nonce missing or expired for wallet: ${callerWallet.substring(0, 8)}...`
      )
      return NextResponse.json(
        { error: "Nonce not found or expired. Request a new nonce first." },
        { status: 401 }
      )
    }

    // ── 5. Verify the Ed25519 signature ───────────────────────────────────────
    const isValid = verifyWalletSignature(callerWallet, nonce, signature)
    if (!isValid) {
      console.warn(
        `[transfer-ownership] signature verification failed for wallet: ${callerWallet.substring(0, 8)}...`
      )
      return NextResponse.json(
        {
          error:
            "Signature verification failed. Wallet ownership could not be proved.",
        },
        { status: 401 }
      )
    }

    // ── 6. Verify the group exists and the caller is the current owner ────────
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

    console.info(
      `[transfer-ownership] Group ${groupId} ownership transferred from user ${user.id} to user ${newOwnerId}`
    )

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
