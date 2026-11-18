// Type definitions for blockchain operations

export interface GroupMetadata {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  is_private: boolean;
  owner_wallet?: string | null;
}

export interface StellarTransactionResult {
  success: boolean;
  transactionHash?: string;
  feeCharged?: string;
  /** The group memo embedded in the Stellar transaction. */
  memoGroupId?: string;
  /** The audit memo embedded in the Stellar transaction. */
  auditMemo?: string;
  error?: string;
}

export type AuditEventType =
  | "group_created"
  | "member_joined"
  | "member_left"
  | "member_removed"
  | "role_assigned"
  | "role_revoked";

export interface StellarTransaction {
  hash: string;
  memo: string;
  memoType?: string;
  ledger: number;
  created_at: string;
  /** ISO-8601 timestamp when the ledger containing this transaction was closed. */
  ledger_close_time?: string;
  successful: boolean;
  source_account?: string;
  operation_count?: number;
}

export type StellarTransactionVerificationStatus =
  | "successful"
  | "failed"
  | "pending"
  | "invalid"
  | "unverifiable";

export interface StellarTransactionVerificationResult {
  transactionHash: string;
  status: StellarTransactionVerificationStatus;
  verified: boolean;
  groupActionEventId: string | null;
  groupId: string | null;
  ledger: number | null;
  memo: string | null;
  error: string | null;
  verifiedAt: string;
  explorerUrl: string | null;
}

// ── Audit verification types ──────────────────────────────────────────────────

/**
 * AnonChat application actions that can be verified against a Stellar transaction.
 * Each value corresponds to a specific blockchain operation type.
 */
export type AnonChatAction =
  | "group_creation"
  | "group_join"
  | "group_leave"
  | "member_removal"
  | "wallet_auth"
  | "ownership_transfer"
  | "audit_event";

/**
 * Input to the audit verification service.
 */
export interface AuditVerificationInput {
  /** 64-character hex Stellar transaction hash. */
  transactionHash: string;
  /** Expected AnonChat action this transaction should correspond to. */
  expectedAction: AnonChatAction;
  /** Optional group/room ID for contextual validation. */
  groupId?: string | null;
  /** Optional correlation ID for distributed tracing. */
  correlationId?: string;
  /** Optional expected memo value embedded in the transaction. */
  expectedMemo?: string | null;
  /** Optional expected source account (Stellar public key). */
  expectedSourceAccount?: string | null;
}

/**
 * Persistent audit record stored in the database after verification.
 */
export interface TransactionAuditRecord {
  id?: string;
  transaction_hash: string;
  network_identifier: string;
  ledger: number | null;
  ledger_close_time: string | null;
  source_account: string | null;
  operation_count: number | null;
  operation_type: string | null;
  expected_action: AnonChatAction;
  group_id: string | null;
  status: StellarTransactionVerificationStatus;
  verified: boolean;
  retry_count: number;
  error_message: string | null;
  diagnostic_details: Record<string, unknown> | null;
  verified_at: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Outcome returned by the audit verification service.
 */
export interface AuditVerificationResult {
  transactionHash: string;
  status: StellarTransactionVerificationStatus;
  verified: boolean;
  networkIdentifier: string;
  ledger: number | null;
  ledgerCloseTime: string | null;
  sourceAccount: string | null;
  operationCount: number | null;
  operationType: string | null;
  expectedAction: AnonChatAction;
  groupId: string | null;
  error: string | null;
  diagnosticDetails: Record<string, unknown> | null;
  verifiedAt: string;
  explorerUrl: string | null;
  /** True when the record already existed and was not duplicated. */
  idempotent: boolean;
  retryCount: number;
  correlationId: string;
}

export interface VerificationResponse {
  groupId: string;
  currentMetadataHash: string;
  blockchainMetadataHash: string | null;
  transactionHash: string | null;
  verified: boolean;
  explorerUrl: string | null;
  /** The memo embedded in the transaction (should equal the derived group memo). */
  memoGroupId?: string | null;
  /** Whether the on-chain memo matches the expected group memo. */
  memoVerified?: boolean;
  /** Whether the creator wallet is bound to the anchored metadata hash. */
  walletOwnershipVerified?: boolean;
  /** Owner wallet address at verification time. */
  ownerWallet?: string | null;
  /** Human-readable error when verification failed. */
  error?: string | null;
}

export interface GroupVerificationRecord {
  id?: string;
  group_id: string;
  wallet_address: string;
  tx_hash: string | null;
  verified: boolean;
  memo_verified: boolean;
  wallet_ownership_verified: boolean;
  metadata_hash: string | null;
  verification_error: string | null;
  verified_at: string | null;
  last_checked_at: string;
  created_at?: string;
}

// ── Multi-signature ownership types ──────────────────────────────────────────

export type MultisigActionType =
  | "delete_group"
  | "transfer_ownership"
  | "remove_member"
  | "regenerate_invite"
  | "update_multisig_owners";

export type MultisigProposalStatus =
  | "pending"
  | "approved"
  | "executed"
  | "rejected"
  | "expired";

export interface MultisigOwner {
  id: string;
  groupId: string;
  walletAddress: string;
  userId: string | null;
  addedBy: string | null;
  addedAt: string;
  removedAt: string | null;
}

export interface MultisigConfig {
  groupId: string;
  requiredApprovals: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MultisigProposal {
  id: string;
  groupId: string;
  actionType: MultisigActionType;
  /** Arbitrary payload describing the action (e.g. { newOwnerWallet: "G..." }) */
  actionPayload: Record<string, unknown>;
  proposedBy: string;
  proposerWallet: string;
  status: MultisigProposalStatus;
  requiredApprovals: number;
  approvalCount: number;
  approvals: MultisigApproval[];
  expiresAt: string;
  executedAt: string | null;
  createdAt: string;
}

export interface MultisigApproval {
  id: string;
  proposalId: string;
  approverUserId: string;
  approverWallet: string;
  approvedAt: string;
}

export interface ProposeMultisigActionRequest {
  walletAddress: string;
  signature: string;
  actionType: MultisigActionType;
  actionPayload?: Record<string, unknown>;
}

export interface ApproveMultisigProposalRequest {
  walletAddress: string;
  signature: string;
}

export interface EnableMultisigRequest {
  walletAddress: string;
  signature: string;
  requiredApprovals: number;
}

export interface AddMultisigOwnerRequest {
  walletAddress: string;
  signature: string;
  newOwnerWallet: string;
}

export interface RemoveMultisigOwnerRequest {
  walletAddress: string;
  signature: string;
  targetWallet: string;
}

export interface MultisigOwnersResponse {
  groupId: string;
  multisigEnabled: boolean;
  requiredApprovals: number;
  ownerCount: number;
  owners: MultisigOwner[];
  config: MultisigConfig | null;
}

export interface MultisigProposalsResponse {
  groupId: string;
  proposals: MultisigProposal[];
  total: number;
  page: number;
  limit: number;
}

export interface GroupCreationResponse {
  room: {
    id: string;
    name: string;
    description: string | null;
    is_private: boolean;
    created_by: string;
    created_at: string;
    owner_wallet?: string | null;
    stellar_tx_hash: string | null;
    metadata_hash?: string | null;
    blockchain_submitted_at?: string | null;
    /** Compact group identifier embedded in the Stellar memo. */
    memo_group_id?: string | null;
  };
  success: boolean;
  blockchain: {
    submitted: boolean;
    transactionHash?: string;
    feeCharged?: string;
    explorerUrl?: string;
    /** The memo value that was embedded in the on-chain transaction. */
    memoGroupId?: string;
  };
}
