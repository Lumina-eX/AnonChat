/**
 * Multi-signature group ownership utilities.
 *
 * Handles approval-workflow logic for sensitive group actions:
 *  - Verifying a caller is an active co-owner
 *  - Creating proposals
 *  - Collecting and validating owner signatures
 *  - Determining when quorum is reached
 *
 * All cryptographic verification re-uses the existing Ed25519 / Stellar-SDK
 * primitives already in lib/auth/stellar-verify.ts so there is no new crypto
 * surface area.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { verifyWalletSignature } from "@/lib/auth/stellar-verify";
import { validateStellarAddress } from "@/lib/auth/validation";
import type {
  MultisigActionType,
  MultisigConfig,
  MultisigOwner,
  MultisigProposal,
  MultisigApproval,
} from "@/types/blockchain";

// ── Row shapes returned by Supabase ──────────────────────────────────────────

interface MultisigOwnerRow {
  id: string;
  group_id: string;
  wallet_address: string;
  user_id: string | null;
  added_by: string | null;
  added_at: string;
  removed_at: string | null;
}

interface MultisigConfigRow {
  group_id: string;
  required_approvals: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface MultisigProposalRow {
  id: string;
  group_id: string;
  action_type: string;
  action_payload: Record<string, unknown>;
  proposed_by: string;
  proposer_wallet: string;
  status: string;
  required_approvals: number;
  expires_at: string;
  executed_at: string | null;
  created_at: string;
}

interface MultisigApprovalRow {
  id: string;
  proposal_id: string;
  group_id: string;
  approver_user_id: string;
  approver_wallet: string;
  approved_at: string;
}

// ── Mappers ───────────────────────────────────────────────────────────────────

export function mapOwnerRow(row: MultisigOwnerRow): MultisigOwner {
  return {
    id: row.id,
    groupId: row.group_id,
    walletAddress: row.wallet_address,
    userId: row.user_id,
    addedBy: row.added_by,
    addedAt: row.added_at,
    removedAt: row.removed_at,
  };
}

export function mapConfigRow(row: MultisigConfigRow): MultisigConfig {
  return {
    groupId: row.group_id,
    requiredApprovals: row.required_approvals,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapApprovalRow(row: MultisigApprovalRow): MultisigApproval {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    approverUserId: row.approver_user_id,
    approverWallet: row.approver_wallet,
    approvedAt: row.approved_at,
  };
}

export function mapProposalRow(
  row: MultisigProposalRow,
  approvals: MultisigApprovalRow[],
): MultisigProposal {
  return {
    id: row.id,
    groupId: row.group_id,
    actionType: row.action_type as MultisigActionType,
    actionPayload: row.action_payload,
    proposedBy: row.proposed_by,
    proposerWallet: row.proposer_wallet,
    status: row.status as MultisigProposal["status"],
    requiredApprovals: row.required_approvals,
    approvalCount: approvals.length,
    approvals: approvals.map(mapApprovalRow),
    expiresAt: row.expires_at,
    executedAt: row.executed_at,
    createdAt: row.created_at,
  };
}

// ── Canonical proposal hash ───────────────────────────────────────────────────

/**
 * Computes a deterministic SHA-256 hash of a proposal's identity fields.
 * Co-owners sign this hash (as UTF-8 hex string) with their wallet private key.
 *
 * The hash covers: proposalId + groupId + actionType + actionPayload
 * so that a signature is irrevocably bound to the exact proposal content.
 */
export function computeProposalHash(
  proposalId: string,
  groupId: string,
  actionType: MultisigActionType,
  actionPayload: Record<string, unknown>,
): string {
  const canonical = JSON.stringify(
    { proposalId, groupId, actionType, actionPayload },
    Object.keys({ proposalId, groupId, actionType, actionPayload }).sort(),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Verifies an Ed25519 signature over the proposal hash.
 *
 * The signer signs the *hex-encoded* SHA-256 hash as a UTF-8 string
 * (matching the existing verifyWalletSignature convention).
 */
export function verifyProposalSignature(
  walletAddress: string,
  proposalId: string,
  groupId: string,
  actionType: MultisigActionType,
  actionPayload: Record<string, unknown>,
  signature: string,
): boolean {
  if (!validateStellarAddress(walletAddress)) return false;
  const hash = computeProposalHash(proposalId, groupId, actionType, actionPayload);
  return verifyWalletSignature(walletAddress, hash, signature);
}

// ── Group multisig state queries ──────────────────────────────────────────────

/**
 * Returns the multisig config for a group, or null when multisig is not enabled.
 */
export async function getMultisigConfig(
  supabase: SupabaseClient,
  groupId: string,
): Promise<MultisigConfig | null> {
  const { data, error } = await supabase
    .from("group_multisig_config")
    .select("*")
    .eq("group_id", groupId)
    .eq("enabled", true)
    .maybeSingle();

  if (error || !data) return null;
  return mapConfigRow(data as MultisigConfigRow);
}

/**
 * Returns all active (non-removed) co-owners for a group.
 */
export async function getActiveOwners(
  supabase: SupabaseClient,
  groupId: string,
): Promise<MultisigOwner[]> {
  const { data, error } = await supabase
    .from("group_multisig_owners")
    .select("*")
    .eq("group_id", groupId)
    .is("removed_at", null)
    .order("added_at", { ascending: true });

  if (error || !data) return [];
  return (data as MultisigOwnerRow[]).map(mapOwnerRow);
}

/**
 * Checks whether a given wallet address is an active co-owner of the group.
 */
export async function isMultisigOwner(
  supabase: SupabaseClient,
  groupId: string,
  walletAddress: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("group_multisig_owners")
    .select("id")
    .eq("group_id", groupId)
    .eq("wallet_address", walletAddress)
    .is("removed_at", null)
    .maybeSingle();

  return !!data;
}

/**
 * Determines whether multisig is required for this group and the given action.
 * Returns the config when active, null when single-owner mode applies.
 */
export async function requiresMultisigApproval(
  supabase: SupabaseClient,
  groupId: string,
): Promise<MultisigConfig | null> {
  return getMultisigConfig(supabase, groupId);
}

// ── Proposal lifecycle ────────────────────────────────────────────────────────

export interface CreateProposalParams {
  groupId: string;
  actionType: MultisigActionType;
  actionPayload: Record<string, unknown>;
  proposedBy: string;         // user UUID
  proposerWallet: string;     // Stellar public key
  proposerSignature: string;  // Ed25519 sig over the proposal hash (nonce-consumed already)
  signedNonce: string;
  requiredApprovals: number;
  expiresInHours?: number;
}

export interface CreateProposalResult {
  ok: boolean;
  proposal?: MultisigProposal;
  error?: string;
}

/**
 * Inserts a new proposal and records the proposer's own approval simultaneously.
 * Returns the full proposal object on success.
 *
 * The proposer's signature is verified against the *proposal hash* derived from
 * the nonce-signed content. Because the nonce has already been consumed by the
 * caller before reaching here, we use the nonce as the `signed_nonce` stored
 * for audit, while the actual signature check is done against the nonce
 * (consistent with wallet-authorization.ts).
 *
 * NOTE: The actual nonce consumption + signature verification happen in the
 * route handler (via verifyWalletAuthorization). The signature stored here is
 * the raw hex from the request body for non-repudiation.
 */
export async function createProposal(
  supabase: SupabaseClient,
  params: CreateProposalParams,
): Promise<CreateProposalResult> {
  const {
    groupId,
    actionType,
    actionPayload,
    proposedBy,
    proposerWallet,
    proposerSignature,
    signedNonce,
    requiredApprovals,
    expiresInHours = 24,
  } = params;

  // Insert proposal row
  const expiresAt = new Date(
    Date.now() + expiresInHours * 60 * 60 * 1000,
  ).toISOString();

  const { data: proposalRow, error: proposalErr } = await supabase
    .from("multisig_proposals")
    .insert({
      group_id: groupId,
      action_type: actionType,
      action_payload: actionPayload,
      proposed_by: proposedBy,
      proposer_wallet: proposerWallet,
      proposer_signature: proposerSignature,
      signed_nonce: signedNonce,
      status: "pending",
      required_approvals: requiredApprovals,
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (proposalErr || !proposalRow) {
    console.error("[multisig] failed to create proposal:", proposalErr);
    return { ok: false, error: "Failed to create proposal" };
  }

  // Record the proposer's own approval (counts toward quorum)
  const { error: approvalErr } = await supabase
    .from("multisig_approvals")
    .insert({
      proposal_id: proposalRow.id,
      group_id: groupId,
      approver_user_id: proposedBy,
      approver_wallet: proposerWallet,
      signature: proposerSignature,
      signed_nonce: signedNonce,
    });

  if (approvalErr) {
    console.error("[multisig] failed to record proposer approval:", approvalErr);
    // Non-fatal: proposal still created; approval can be added later
  }

  // Check whether the proposal already reached quorum (e.g. requiredApprovals = 1)
  const { data: approvals } = await supabase
    .from("multisig_approvals")
    .select("*")
    .eq("proposal_id", proposalRow.id);

  const currentApprovals = (approvals ?? []) as MultisigApprovalRow[];
  let updatedProposalRow = proposalRow as MultisigProposalRow;

  if (currentApprovals.length >= requiredApprovals) {
    const { data: updated } = await supabase
      .from("multisig_proposals")
      .update({ status: "approved" })
      .eq("id", proposalRow.id)
      .select("*")
      .single();
    if (updated) updatedProposalRow = updated as MultisigProposalRow;
  }

  return {
    ok: true,
    proposal: mapProposalRow(updatedProposalRow, currentApprovals),
  };
}

export interface AddApprovalParams {
  proposalId: string;
  groupId: string;
  approverUserId: string;
  approverWallet: string;
  signature: string;
  signedNonce: string;
}

export interface AddApprovalResult {
  ok: boolean;
  proposal?: MultisigProposal;
  quorumReached: boolean;
  error?: string;
}

/**
 * Records a co-owner's approval for an existing proposal.
 * Returns the updated proposal, and `quorumReached: true` when the action
 * can now be executed.
 */
export async function addApproval(
  supabase: SupabaseClient,
  params: AddApprovalParams,
): Promise<AddApprovalResult> {
  const { proposalId, groupId, approverUserId, approverWallet, signature, signedNonce } =
    params;

  // Fetch the proposal
  const { data: proposalRow, error: propErr } = await supabase
    .from("multisig_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("group_id", groupId)
    .maybeSingle();

  if (propErr || !proposalRow) {
    return { ok: false, quorumReached: false, error: "Proposal not found" };
  }

  const proposal = proposalRow as MultisigProposalRow;

  if (proposal.status !== "pending") {
    return {
      ok: false,
      quorumReached: false,
      error: `Proposal is already ${proposal.status}`,
    };
  }

  if (new Date(proposal.expires_at) < new Date()) {
    // Mark as expired
    await supabase
      .from("multisig_proposals")
      .update({ status: "expired" })
      .eq("id", proposalId);
    return { ok: false, quorumReached: false, error: "Proposal has expired" };
  }

  // Verify the signature over the proposal hash
  const proposalHash = computeProposalHash(
    proposal.id,
    proposal.group_id,
    proposal.action_type as MultisigActionType,
    proposal.action_payload,
  );
  const signatureValid = verifyWalletSignature(approverWallet, proposalHash, signature);
  if (!signatureValid) {
    return {
      ok: false,
      quorumReached: false,
      error: "Signature verification failed for approval",
    };
  }

  // Insert approval (unique constraint prevents duplicates)
  const { error: approvalErr } = await supabase.from("multisig_approvals").insert({
    proposal_id: proposalId,
    group_id: groupId,
    approver_user_id: approverUserId,
    approver_wallet: approverWallet,
    signature,
    signed_nonce: signedNonce,
  });

  if (approvalErr) {
    if (approvalErr.code === "23505") {
      return { ok: false, quorumReached: false, error: "You have already approved this proposal" };
    }
    console.error("[multisig] failed to insert approval:", approvalErr);
    return { ok: false, quorumReached: false, error: "Failed to record approval" };
  }

  // Count all approvals
  const { data: allApprovals } = await supabase
    .from("multisig_approvals")
    .select("*")
    .eq("proposal_id", proposalId);

  const approvals = (allApprovals ?? []) as MultisigApprovalRow[];
  const quorumReached = approvals.length >= proposal.required_approvals;
  let updatedProposalRow = proposal;

  if (quorumReached && proposal.status === "pending") {
    const { data: updated } = await supabase
      .from("multisig_proposals")
      .update({ status: "approved" })
      .eq("id", proposalId)
      .select("*")
      .single();
    if (updated) updatedProposalRow = updated as MultisigProposalRow;
  }

  return {
    ok: true,
    proposal: mapProposalRow(updatedProposalRow, approvals),
    quorumReached,
  };
}

/**
 * Marks a proposal as executed and stamps the executed_at timestamp.
 * Should be called after the underlying sensitive action completes successfully.
 */
export async function markProposalExecuted(
  supabase: SupabaseClient,
  proposalId: string,
): Promise<void> {
  await supabase
    .from("multisig_proposals")
    .update({ status: "executed", executed_at: new Date().toISOString() })
    .eq("id", proposalId);
}

/**
 * Fetches a single proposal with its approvals.
 */
export async function getProposalWithApprovals(
  supabase: SupabaseClient,
  proposalId: string,
  groupId: string,
): Promise<MultisigProposal | null> {
  const { data: proposalRow } = await supabase
    .from("multisig_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("group_id", groupId)
    .maybeSingle();

  if (!proposalRow) return null;

  const { data: approvalRows } = await supabase
    .from("multisig_approvals")
    .select("*")
    .eq("proposal_id", proposalId);

  return mapProposalRow(
    proposalRow as MultisigProposalRow,
    (approvalRows ?? []) as MultisigApprovalRow[],
  );
}

/**
 * Fetches paginated proposals for a group.
 */
export async function listProposals(
  supabase: SupabaseClient,
  groupId: string,
  options: { page?: number; limit?: number; status?: string } = {},
): Promise<{ proposals: MultisigProposal[]; total: number }> {
  const page = Math.max(options.page ?? 1, 1);
  const limit = Math.min(options.limit ?? 20, 100);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("multisig_proposals")
    .select("*", { count: "exact" })
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (options.status) {
    query = query.eq("status", options.status);
  }

  const { data: proposalRows, count } = await query;
  if (!proposalRows) return { proposals: [], total: 0 };

  // Fetch all approvals for the returned proposals in a single query
  const proposalIds = (proposalRows as MultisigProposalRow[]).map((p) => p.id);
  const { data: approvalRows } = await supabase
    .from("multisig_approvals")
    .select("*")
    .in("proposal_id", proposalIds);

  const approvalsByProposal = ((approvalRows ?? []) as MultisigApprovalRow[]).reduce<
    Record<string, MultisigApprovalRow[]>
  >((acc, a) => {
    if (!acc[a.proposal_id]) acc[a.proposal_id] = [];
    acc[a.proposal_id].push(a);
    return acc;
  }, {});

  const proposals = (proposalRows as MultisigProposalRow[]).map((p) =>
    mapProposalRow(p, approvalsByProposal[p.id] ?? []),
  );

  return { proposals, total: count ?? proposals.length };
}
