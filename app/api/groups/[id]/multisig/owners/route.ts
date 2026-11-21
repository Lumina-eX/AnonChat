/**
 * Multi-sig owners management for a group.
 *
 * GET  /api/groups/[id]/multisig/owners
 *   Returns the list of active co-owners and the current multisig config.
 *   Accessible to all group members.
 *
 * POST /api/groups/[id]/multisig/owners
 *   Body: EnableMultisigRequest  → enable multisig (primary owner only)
 *       | AddMultisigOwnerRequest → add a co-owner (any active co-owner)
 *       | RemoveMultisigOwnerRequest → remove a co-owner (primary owner only)
 *
 *   The `action` field in the body discriminates the sub-operation:
 *     "enable"  – bootstrap multi-sig for the group
 *     "add"     – add a new co-owner wallet
 *     "remove"  – soft-delete a co-owner wallet
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  verifyWalletAuthorization,
  ensureWalletMatchesUser,
  resolveWalletFromUser,
} from "@/lib/auth/wallet-authorization";
import {
  getActiveOwners,
  getMultisigConfig,
  isMultisigOwner,
} from "@/lib/groups/multisig";
import { validateStellarAddress } from "@/lib/auth/validation";

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
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

    // Fetch group to confirm it exists
    const { data: group } = await supabase
      .from("rooms")
      .select("id, created_by, owner_wallet")
      .eq("id", groupId)
      .maybeSingle();

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const [owners, config] = await Promise.all([
      getActiveOwners(supabase, groupId),
      getMultisigConfig(supabase, groupId),
    ]);

    return NextResponse.json({
      groupId,
      multisigEnabled: !!config?.enabled,
      requiredApprovals: config?.requiredApprovals ?? 1,
      ownerCount: owners.length,
      owners,
      config,
    });
  } catch (err) {
    console.error("[multisig/owners] GET error:", err);
    return NextResponse.json({ error: "Failed to fetch multisig owners" }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

type OwnerActionBody = {
  action: "enable" | "add" | "remove";
  walletAddress?: string;
  signature?: string;
  // enable
  requiredApprovals?: number;
  // add
  newOwnerWallet?: string;
  // remove
  targetWallet?: string;
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

    const body: OwnerActionBody = await request.json().catch(() => ({}));
    const { action } = body;

    if (!action || !["enable", "add", "remove"].includes(action)) {
      return NextResponse.json(
        { error: 'action must be one of "enable", "add", "remove"' },
        { status: 400 },
      );
    }

    // Verify wallet ownership via nonce + signature
    const auth = await verifyWalletAuthorization(body, `multisig_owners_${action}`, {
      supabase,
      groupId,
    });
    if (!auth.ok) return auth.response;

    // Ensure the signing wallet belongs to the authenticated user
    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .eq("id", user.id)
      .maybeSingle();

    const callerWallet = resolveWalletFromUser(user, callerProfile);
    const walletMismatch = ensureWalletMatchesUser(auth.walletAddress, callerWallet);
    if (walletMismatch) return walletMismatch;

    // Fetch group
    const { data: group } = await supabase
      .from("rooms")
      .select("id, created_by, owner_wallet")
      .eq("id", groupId)
      .maybeSingle();

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // ── enable ────────────────────────────────────────────────────────────────
    if (action === "enable") {
      if (group.created_by !== user.id) {
        return NextResponse.json(
          { error: "Only the primary group owner can enable multisig" },
          { status: 403 },
        );
      }

      const requiredApprovals = Number(body.requiredApprovals);
      if (!Number.isInteger(requiredApprovals) || requiredApprovals < 1) {
        return NextResponse.json(
          { error: "requiredApprovals must be a positive integer" },
          { status: 400 },
        );
      }

      const { data: rpcResult, error: rpcErr } = await supabase.rpc(
        "enable_group_multisig",
        {
          p_group_id: groupId,
          p_required_approvals: requiredApprovals,
          p_owner_wallet: auth.walletAddress,
        },
      );

      if (rpcErr) {
        console.error("[multisig/owners] enable_group_multisig RPC error:", rpcErr);
        if (rpcErr.code === "42501") {
          return NextResponse.json(
            { error: "Only the current owner can enable multisig" },
            { status: 403 },
          );
        }
        return NextResponse.json({ error: "Failed to enable multisig" }, { status: 500 });
      }

      const result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
      console.info(
        `[multisig/owners] multisig enabled for group ${groupId} by ${auth.walletAddress.substring(0, 8)}...`,
      );

      return NextResponse.json({
        success: true,
        groupId,
        requiredApprovals: result?.required_approvals ?? requiredApprovals,
        ownerCount: result?.owner_count ?? 1,
      });
    }

    // ── add ───────────────────────────────────────────────────────────────────
    if (action === "add") {
      const { newOwnerWallet } = body;

      if (!newOwnerWallet || !validateStellarAddress(newOwnerWallet)) {
        return NextResponse.json(
          { error: "newOwnerWallet must be a valid Stellar address" },
          { status: 400 },
        );
      }

      if (newOwnerWallet === auth.walletAddress) {
        return NextResponse.json(
          { error: "You are already a co-owner" },
          { status: 400 },
        );
      }

      // Caller must be an existing active co-owner (or the primary owner)
      const callerIsOwner =
        group.created_by === user.id ||
        (await isMultisigOwner(supabase, groupId, auth.walletAddress));

      if (!callerIsOwner) {
        return NextResponse.json(
          { error: "Only an existing group owner can add a co-owner" },
          { status: 403 },
        );
      }

      // Resolve user ID for the new wallet
      const newOwnerEmail = `${newOwnerWallet.toLowerCase()}@wallet.anonchat.local`;
      const { data: newOwnerUser } = await supabase
        .from("profiles")
        .select("id")
        .eq("wallet_address", newOwnerWallet)
        .maybeSingle();

      // Fallback: look up via deterministic email pattern
      let newOwnerId: string | null = newOwnerUser?.id ?? null;
      if (!newOwnerId) {
        const { data: authUser } = await supabase
          .from("profiles")
          .select("id, wallet_address")
          .ilike("wallet_address", newOwnerWallet)
          .maybeSingle();
        newOwnerId = authUser?.id ?? null;
      }

      if (!newOwnerId) {
        return NextResponse.json(
          { error: "New owner wallet address is not registered in AnonChat" },
          { status: 404 },
        );
      }

      // Confirm the new owner is a group member
      const { data: membership } = await supabase
        .from("room_members")
        .select("user_id")
        .eq("room_id", groupId)
        .eq("user_id", newOwnerId)
        .is("removed_at", null)
        .maybeSingle();

      if (!membership) {
        return NextResponse.json(
          { error: "New owner must be an active member of the group" },
          { status: 400 },
        );
      }

      const { data: newOwnersRowId, error: addErr } = await supabase.rpc(
        "add_group_multisig_owner",
        {
          p_group_id: groupId,
          p_new_wallet: newOwnerWallet,
          p_new_user_id: newOwnerId,
        },
      );

      if (addErr) {
        console.error("[multisig/owners] add_group_multisig_owner RPC error:", addErr);
        if (addErr.code === "42501") {
          return NextResponse.json(
            { error: "Only an existing group owner can add a co-owner" },
            { status: 403 },
          );
        }
        return NextResponse.json({ error: "Failed to add co-owner" }, { status: 500 });
      }

      console.info(
        `[multisig/owners] added co-owner ${newOwnerWallet.substring(0, 8)}... to group ${groupId}`,
      );

      const [owners, config] = await Promise.all([
        getActiveOwners(supabase, groupId),
        getMultisigConfig(supabase, groupId),
      ]);

      return NextResponse.json({
        success: true,
        groupId,
        addedOwnerId: newOwnersRowId,
        ownerCount: owners.length,
        owners,
        config,
      });
    }

    // ── remove ────────────────────────────────────────────────────────────────
    if (action === "remove") {
      const { targetWallet } = body;

      if (!targetWallet || !validateStellarAddress(targetWallet)) {
        return NextResponse.json(
          { error: "targetWallet must be a valid Stellar address" },
          { status: 400 },
        );
      }

      if (group.created_by !== user.id) {
        return NextResponse.json(
          { error: "Only the primary owner can remove a co-owner" },
          { status: 403 },
        );
      }

      const { error: removeErr } = await supabase.rpc("remove_group_multisig_owner", {
        p_group_id: groupId,
        p_target_wallet: targetWallet,
      });

      if (removeErr) {
        console.error("[multisig/owners] remove error:", removeErr);
        if (removeErr.code === "42501") {
          return NextResponse.json(
            { error: "Only the primary owner can remove a co-owner" },
            { status: 403 },
          );
        }
        if (removeErr.code === "22023") {
          return NextResponse.json({ error: removeErr.message }, { status: 400 });
        }
        return NextResponse.json({ error: "Failed to remove co-owner" }, { status: 500 });
      }

      console.info(
        `[multisig/owners] removed co-owner ${targetWallet.substring(0, 8)}... from group ${groupId}`,
      );

      const [owners, config] = await Promise.all([
        getActiveOwners(supabase, groupId),
        getMultisigConfig(supabase, groupId),
      ]);

      return NextResponse.json({
        success: true,
        groupId,
        ownerCount: owners.length,
        owners,
        config,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[multisig/owners] POST error:", err);
    return NextResponse.json({ error: "Failed to manage multisig owners" }, { status: 500 });
  }
}
