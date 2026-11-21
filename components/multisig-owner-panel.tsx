"use client";

/**
 * MultisigOwnerPanel
 *
 * UI for group owners to:
 *  - View current co-owners and multisig config
 *  - Enable multisig (set required approvals threshold)
 *  - Add / remove co-owner wallets
 *  - View pending proposals and their approval status
 *  - Create new action proposals
 *  - Approve pending proposals
 */

import { useEffect, useState, useCallback } from "react";
import {
  Users,
  ShieldCheck,
  Plus,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { cn } from "@/lib/utils";
import { getPublicKey } from "@/app/stellar-wallet-kit";
import type {
  MultisigOwner,
  MultisigConfig,
  MultisigProposal,
  MultisigActionType,
} from "@/types/blockchain";

// ── Shared helpers ────────────────────────────────────────────────────────────

function shortenWallet(w: string) {
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

async function fetchNonceAndSign(
  walletAddress: string,
  signMessage: (msg: string) => Promise<string>,
): Promise<{ nonce: string; signature: string } | null> {
  try {
    const res = await fetch("/api/auth/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress }),
    });
    const { nonce } = await res.json();
    if (!nonce) return null;
    const signature = await signMessage(nonce);
    return { nonce, signature };
  } catch {
    return null;
  }
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: MultisigProposal["status"] }) {
  const map: Record<MultisigProposal["status"], { label: string; icon: React.ReactNode; className: string }> = {
    pending:  { label: "Pending",  icon: <Clock className="w-3 h-3" />,        className: "text-yellow-500 bg-yellow-50" },
    approved: { label: "Approved", icon: <CheckCircle2 className="w-3 h-3" />, className: "text-green-600 bg-green-50" },
    executed: { label: "Executed", icon: <CheckCircle2 className="w-3 h-3" />, className: "text-blue-600 bg-blue-50" },
    rejected: { label: "Rejected", icon: <XCircle className="w-3 h-3" />,      className: "text-red-500 bg-red-50" },
    expired:  { label: "Expired",  icon: <AlertTriangle className="w-3 h-3" />,className: "text-gray-400 bg-gray-100" },
  };
  const { label, icon, className } = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium", className)}>
      {icon} {label}
    </span>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface MultisigOwnerPanelProps {
  groupId: string;
  /** Whether the current user is the primary owner */
  isPrimaryOwner: boolean;
  /** Sign a message string and return a hex-encoded Ed25519 signature */
  signMessage: (message: string) => Promise<string>;
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MultisigOwnerPanel({
  groupId,
  isPrimaryOwner,
  signMessage,
  className,
}: MultisigOwnerPanelProps) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [owners, setOwners] = useState<MultisigOwner[]>([]);
  const [config, setConfig] = useState<MultisigConfig | null>(null);
  const [multisigEnabled, setMultisigEnabled] = useState(false);
  const [proposals, setProposals] = useState<MultisigProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [proposalsExpanded, setProposalsExpanded] = useState(false);

  // Form state
  const [enableThreshold, setEnableThreshold] = useState(2);
  const [newOwnerWallet, setNewOwnerWallet] = useState("");
  const [removeTarget, setRemoveTarget] = useState("");
  const [proposalAction, setProposalAction] = useState<MultisigActionType>("delete_group");
  const [proposalPayload, setProposalPayload] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [ownersRes, proposalsRes] = await Promise.all([
        fetch(`/api/groups/${groupId}/multisig/owners`),
        fetch(`/api/groups/${groupId}/multisig/proposals?limit=10`),
      ]);
      if (ownersRes.ok) {
        const data = await ownersRes.json();
        setOwners(data.owners ?? []);
        setConfig(data.config ?? null);
        setMultisigEnabled(data.multisigEnabled ?? false);
      }
      if (proposalsRes.ok) {
        const data = await proposalsRes.json();
        setProposals(data.proposals ?? []);
      }
    } catch {
      toast.error("Failed to load multisig data");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    getPublicKey().then(setWalletAddress).catch(() => {});
    fetchData();
  }, [fetchData]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleEnable(e: React.FormEvent) {
    e.preventDefault();
    if (!walletAddress) return toast.error("Connect your wallet first");
    setSubmitting(true);
    try {
      const auth = await fetchNonceAndSign(walletAddress, signMessage);
      if (!auth) return toast.error("Failed to obtain nonce");
      const res = await fetch(`/api/groups/${groupId}/multisig/owners`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enable",
          walletAddress,
          signature: auth.signature,
          requiredApprovals: enableThreshold,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to enable multisig");
      toast.success(`Multisig enabled (${data.requiredApprovals}-of-${data.ownerCount})`);
      await fetchData();
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddOwner(e: React.FormEvent) {
    e.preventDefault();
    if (!walletAddress) return toast.error("Connect your wallet first");
    if (!newOwnerWallet.trim()) return toast.error("Enter a wallet address");
    setSubmitting(true);
    try {
      const auth = await fetchNonceAndSign(walletAddress, signMessage);
      if (!auth) return toast.error("Failed to obtain nonce");
      const res = await fetch(`/api/groups/${groupId}/multisig/owners`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          walletAddress,
          signature: auth.signature,
          newOwnerWallet: newOwnerWallet.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add co-owner");
      toast.success("Co-owner added");
      setNewOwnerWallet("");
      await fetchData();
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveOwner(targetWallet: string) {
    if (!walletAddress) return toast.error("Connect your wallet first");
    setSubmitting(true);
    try {
      const auth = await fetchNonceAndSign(walletAddress, signMessage);
      if (!auth) return toast.error("Failed to obtain nonce");
      const res = await fetch(`/api/groups/${groupId}/multisig/owners`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove",
          walletAddress,
          signature: auth.signature,
          targetWallet,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove co-owner");
      toast.success("Co-owner removed");
      await fetchData();
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePropose(e: React.FormEvent) {
    e.preventDefault();
    if (!walletAddress) return toast.error("Connect your wallet first");
    let payload: Record<string, unknown> = {};
    if (proposalPayload.trim()) {
      try {
        payload = JSON.parse(proposalPayload);
      } catch {
        return toast.error("actionPayload must be valid JSON");
      }
    }
    setSubmitting(true);
    try {
      const auth = await fetchNonceAndSign(walletAddress, signMessage);
      if (!auth) return toast.error("Failed to obtain nonce");
      const res = await fetch(`/api/groups/${groupId}/multisig/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          signature: auth.signature,
          actionType: proposalAction,
          actionPayload: payload,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create proposal");
      toast.success(data.message ?? "Proposal created");
      setProposalPayload("");
      setProposalsExpanded(true);
      await fetchData();
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove(proposalId: string, actionType: MultisigActionType, actionPayload: Record<string, unknown>) {
    if (!walletAddress) return toast.error("Connect your wallet first");
    // The approver signs the proposal hash — computed on-chain consistently.
    // For UX, we use nonce to gate the HTTP request and sign the proposal hash
    // as the message for the Ed25519 operation.
    setSubmitting(true);
    try {
      const auth = await fetchNonceAndSign(walletAddress, signMessage);
      if (!auth) return toast.error("Failed to obtain nonce");

      // Compute proposal hash client-side so the user signs the correct message
      const hashInput = JSON.stringify(
        { proposalId, groupId, actionType, actionPayload },
        ["actionPayload", "actionType", "groupId", "proposalId"],
      );
      const proposalHashBuffer = await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(new TextEncoder().encode(hashInput)) as Uint8Array<ArrayBuffer>,
      );
      const proposalHash = Array.from(new Uint8Array(proposalHashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Sign the proposal hash
      const approvalSignature = await signMessage(proposalHash);

      const res = await fetch(`/api/groups/${groupId}/multisig/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId,
          walletAddress,
          signature: approvalSignature,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to approve proposal");
      toast.success(data.message ?? "Approval recorded");
      await fetchData();
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center py-8", className)}>
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-semibold">Multi-Signature Ownership</h3>
        {multisigEnabled && (
          <span className="ml-auto text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded">
            Enabled · {config?.requiredApprovals}-of-{owners.length}
          </span>
        )}
      </div>

      {/* Enable multisig (primary owner only, when not yet enabled) */}
      {!multisigEnabled && isPrimaryOwner && (
        <form
          onSubmit={handleEnable}
          className="border border-dashed rounded-lg p-4 space-y-3"
        >
          <p className="text-xs text-muted-foreground">
            Enable multi-signature ownership to require multiple co-owners to approve
            sensitive actions like group deletion or ownership transfer.
          </p>
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium shrink-0">Required approvals</label>
            <input
              type="number"
              min={1}
              max={10}
              value={enableThreshold}
              onChange={(e) => setEnableThreshold(Number(e.target.value))}
              className="w-20 border rounded px-2 py-1 text-sm"
              disabled={submitting}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-1 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
            Enable Multi-Sig
          </button>
        </form>
      )}

      {/* Co-owner list */}
      {multisigEnabled && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Users className="w-3 h-3" /> Co-owners ({owners.length})
          </h4>
          <ul className="space-y-1">
            {owners.map((owner) => (
              <li
                key={owner.id}
                className="flex items-center justify-between bg-muted/40 rounded px-3 py-2 text-xs"
              >
                <span className="font-mono">{shortenWallet(owner.walletAddress)}</span>
                {isPrimaryOwner && owner.walletAddress !== walletAddress && (
                  <button
                    onClick={() => handleRemoveOwner(owner.walletAddress)}
                    disabled={submitting}
                    className="text-red-400 hover:text-red-600 disabled:opacity-40"
                    title="Remove co-owner"
                    aria-label={`Remove co-owner ${owner.walletAddress}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/* Add co-owner */}
          <form onSubmit={handleAddOwner} className="flex gap-2 pt-1">
            <input
              type="text"
              value={newOwnerWallet}
              onChange={(e) => setNewOwnerWallet(e.target.value)}
              placeholder="G… new co-owner wallet"
              className="flex-1 border rounded px-2 py-1 text-xs font-mono"
              disabled={submitting}
              aria-label="New co-owner wallet address"
            />
            <button
              type="submit"
              disabled={submitting || !newOwnerWallet.trim()}
              className="flex items-center gap-1 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Add
            </button>
          </form>
        </div>
      )}

      {/* Create proposal */}
      {multisigEnabled && (
        <div className="space-y-2 border-t pt-4">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Propose Action
          </h4>
          <form onSubmit={handlePropose} className="space-y-2">
            <select
              value={proposalAction}
              onChange={(e) => setProposalAction(e.target.value as MultisigActionType)}
              className="w-full border rounded px-2 py-1 text-xs"
              disabled={submitting}
              aria-label="Select action type"
            >
              <option value="delete_group">Delete group</option>
              <option value="transfer_ownership">Transfer ownership</option>
              <option value="remove_member">Remove member</option>
              <option value="regenerate_invite">Regenerate invite</option>
              <option value="update_multisig_owners">Update multisig owners</option>
            </select>
            <textarea
              value={proposalPayload}
              onChange={(e) => setProposalPayload(e.target.value)}
              placeholder='Optional JSON payload, e.g. {"newOwnerWallet":"G..."}'
              className="w-full border rounded px-2 py-1 text-xs font-mono resize-none"
              rows={2}
              disabled={submitting}
              aria-label="Action payload (JSON)"
            />
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create Proposal
            </button>
          </form>
        </div>
      )}

      {/* Proposals list */}
      {multisigEnabled && proposals.length > 0 && (
        <div className="border-t pt-4 space-y-2">
          <button
            onClick={() => setProposalsExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground w-full text-left"
          >
            {proposalsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Proposals ({proposals.length})
          </button>

          {proposalsExpanded && (
            <ul className="space-y-3">
              {proposals.map((p) => (
                <li key={p.id} className="border rounded-lg p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{p.actionType.replace(/_/g, " ")}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>
                      {p.approvalCount}/{p.requiredApprovals} approvals
                    </span>
                    <span>·</span>
                    <span>expires {new Date(p.expiresAt).toLocaleDateString()}</span>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full h-1 bg-muted rounded overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.min((p.approvalCount / p.requiredApprovals) * 100, 100)}%` }}
                    />
                  </div>
                  {/* Approvers */}
                  {p.approvals.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {p.approvals.map((a) => (
                        <span
                          key={a.id}
                          className="font-mono bg-green-50 text-green-700 px-1.5 py-0.5 rounded text-[10px]"
                          title={a.approverWallet}
                        >
                          ✓ {shortenWallet(a.approverWallet)}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Approve button */}
                  {p.status === "pending" &&
                    walletAddress &&
                    !p.approvals.some((a) => a.approverWallet === walletAddress) && (
                      <button
                        onClick={() => handleApprove(p.id, p.actionType, p.actionPayload)}
                        disabled={submitting}
                        className="flex items-center gap-1 text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50"
                      >
                        {submitting ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3" />
                        )}
                        Approve
                      </button>
                    )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default MultisigOwnerPanel;
