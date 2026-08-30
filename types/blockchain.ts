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
  | "role_revoked"
  | "wallet_verified"
  | "wallet_verification_failed";

export interface StellarTransaction {
  hash: string;
  memo: string;
  memoType?: string;
  ledger: number;
  created_at: string;
  successful: boolean;
  source_account?: string;
  operation_count?: number;
}

export type StellarTransactionVerificationStatus =
  | "successful"
  | "failed"
  | "pending"
  | "invalid";

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

// ── Transaction history types ───────────────────────────────────────────────

export type WalletTransactionStatus = "successful" | "failed" | "pending";

export type AnonChatActionType =
  | "group_creation"
  | "audit_log"
  | "metadata_anchor"
  | "payment"
  | "contract_call"
  | "general";

export interface StellarWalletTransaction {
  id: string;
  hash: string;
  ledger: number;
  createdAt: string;
  status: WalletTransactionStatus;
  successful: boolean;
  memo: string | null;
  memoType: string | null;
  isAnonChat: boolean;
  actionType: AnonChatActionType;
  actionLabel: string;
  feeChargedXlm: string;
  feeChargedStroops: string;
  sourceAccount: string;
  operationCount: number;
  explorerUrl: string;
  errorMessage?: string | null;
  pagingToken: string;
}

export interface StellarTransactionHistoryResponse {
  walletAddress: string;
  transactions: StellarWalletTransaction[];
  cursor: {
    next: string | null;
    prev: string | null;
  };
  network: "testnet" | "mainnet";
  totalReturned: number;
  isInactiveAccount?: boolean;
}

export interface TransactionHistoryOptions {
  cursor?: string;
  limit?: number;
  order?: "asc" | "desc";
  filter?: "anonchat" | "all";
}

