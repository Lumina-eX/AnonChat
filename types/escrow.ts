/**
 * Escrow type definitions
 *
 * These types mirror the DB schema in scripts/012_escrow_tables.sql
 * and define the public API surface of the escrow service layer.
 */

// ── Status ────────────────────────────────────────────────────────────────────

export type EscrowStatus =
  | "pending"    // created, not yet funded
  | "funded"     // funds locked on-chain
  | "released"   // funds sent to beneficiary
  | "refunded"   // funds returned to initiator
  | "disputed"   // dispute raised, awaiting resolution
  | "resolved";  // dispute resolved

export type EscrowEventType =
  | "created"
  | "funded"
  | "released"
  | "refunded"
  | "disputed"
  | "resolved"
  | "error";

// ── DB row shapes ─────────────────────────────────────────────────────────────

export interface EscrowRecord {
  id: string;
  group_id: string;
  initiator_wallet: string;
  beneficiary_wallet: string;
  amount_xlm: number;
  asset_code: string;
  asset_issuer: string | null;
  status: EscrowStatus;
  memo_group_id: string | null;
  fund_tx_hash: string | null;
  release_tx_hash: string | null;
  refund_tx_hash: string | null;
  dispute_reason: string | null;
  resolved_by: string | null;
  created_at: string;
  funded_at: string | null;
  released_at: string | null;
  refunded_at: string | null;
  disputed_at: string | null;
  resolved_at: string | null;
  expires_at: string | null;
}

export interface EscrowEventRecord {
  id: string;
  escrow_id: string;
  event_type: EscrowEventType;
  tx_hash: string | null;
  actor_wallet: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ── Service input/output types ────────────────────────────────────────────────

export interface CreateEscrowInput {
  groupId: string;
  initiatorWallet: string;
  beneficiaryWallet: string;
  amountXlm: number;
  assetCode?: string;       // defaults to "XLM"
  assetIssuer?: string;     // null for native XLM
  expiresAt?: string;       // ISO-8601 datetime
}

export interface FundEscrowInput {
  escrowId: string;
  fundTxHash: string;       // Stellar tx hash that transferred funds
  actorWallet: string;
}

export interface ReleaseEscrowInput {
  escrowId: string;
  actorWallet: string;      // must be initiator or authorised party
  maxFee?: string | number;
}

export interface RefundEscrowInput {
  escrowId: string;
  actorWallet: string;
  maxFee?: string | number;
}

export interface DisputeEscrowInput {
  escrowId: string;
  actorWallet: string;
  reason: string;
}

export interface ResolveDisputeInput {
  escrowId: string;
  resolverUserId: string;   // Supabase user ID of the resolver
  releaseToInitiator: boolean; // true → refund, false → release to beneficiary
  maxFee?: string | number;
}

// ── Service result types ──────────────────────────────────────────────────────

export interface EscrowResult {
  success: boolean;
  escrow?: EscrowRecord;
  txHash?: string;
  explorerUrl?: string;
  feeCharged?: string;
  error?: string;
}
