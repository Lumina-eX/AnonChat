// Type definitions for escrow lifecycle operations

export type EscrowStatus =
  | "pending"
  | "funded"
  | "released"
  | "refunded"
  | "disputed"
  | "resolved";

export type DisputeResolution = "release" | "refund" | "split";

export interface EscrowParties {
  /** Stellar public key of the party depositing funds */
  depositor: string;
  /** Stellar public key of the party receiving funds on release */
  beneficiary: string;
  /** Optional arbitrator public key for dispute resolution */
  arbitrator?: string;
}

export interface EscrowConditions {
  /** Amount in XLM (stroops as string for precision) */
  amount: string;
  /** Asset code – defaults to "XLM" (native) */
  asset?: string;
  /** ISO-8601 expiry timestamp; after this the depositor may refund */
  expiresAt?: string;
  /** Memo text to embed in the funding transaction (≤28 bytes) */
  memo?: string;
}

export interface CreateEscrowParams {
  groupId: string;
  parties: EscrowParties;
  conditions: EscrowConditions;
  /** Optional max fee override (stroops) */
  maxFee?: string | number;
}

export interface FundEscrowParams {
  escrowId: string;
  /** Signed XDR envelope from the depositor */
  signedXdr: string;
}

export interface ReleaseEscrowParams {
  escrowId: string;
  /** Caller must be beneficiary or arbitrator */
  callerPublicKey: string;
}

export interface RefundEscrowParams {
  escrowId: string;
  /** Caller must be depositor (or arbitrator after expiry) */
  callerPublicKey: string;
}

export interface DisputeEscrowParams {
  escrowId: string;
  /** Party raising the dispute */
  callerPublicKey: string;
  reason: string;
}

export interface ResolveDisputeParams {
  escrowId: string;
  /** Must be the arbitrator */
  arbitratorPublicKey: string;
  resolution: DisputeResolution;
  /** Required when resolution === "split" (0–100) */
  beneficiarySharePercent?: number;
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface EscrowRecord {
  id: string;
  groupId: string;
  status: EscrowStatus;
  parties: EscrowParties;
  conditions: EscrowConditions;
  /** Stellar transaction hash of the funding transaction */
  fundingTxHash?: string | null;
  /** Stellar transaction hash of the release/refund transaction */
  settlementTxHash?: string | null;
  /** Memo embedded in the on-chain transaction */
  memoValue?: string | null;
  disputeReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EscrowOperationResult {
  success: boolean;
  escrow?: EscrowRecord;
  transactionHash?: string;
  explorerUrl?: string | null;
  error?: string;
}

export interface EscrowServiceError {
  code:
    | "NOT_FOUND"
    | "INVALID_STATUS"
    | "UNAUTHORIZED"
    | "BLOCKCHAIN_ERROR"
    | "VALIDATION_ERROR"
    | "EXPIRED"
    | "CONFIG_MISSING";
  message: string;
}
