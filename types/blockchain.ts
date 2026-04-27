// Type definitions for blockchain operations

// ── Memo-linked group ID types ────────────────────────────────────────────────

/**
 * Represents the mapping between a Stellar transaction and a group ID
 * stored via the transaction memo field.
 */
export interface GroupMemoRecord {
  /** The AnonChat group / room ID */
  groupId: string;
  /** Stellar transaction hash that carries the memo */
  transactionHash: string;
  /** The raw memo value embedded in the transaction */
  memoValue: string;
  /** Memo type used ("text" | "hash") */
  memoType: "text" | "hash";
  /** ISO-8601 timestamp when the record was created */
  createdAt: string;
}

/**
 * Result of a memo-linked transaction submission.
 */
export interface MemoTransactionResult {
  success: boolean;
  transactionHash?: string;
  memoValue?: string;
  memoType?: "text" | "hash";
  feeCharged?: string;
  explorerUrl?: string | null;
  error?: string;
}

/**
 * Result of memo validation against a stored record.
 */
export interface MemoValidationResult {
  valid: boolean;
  groupId?: string;
  transactionHash?: string;
  memoValue?: string;
  reason?: string;
}

export interface GroupMetadata {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  is_private: boolean;
}

export interface StellarTransactionResult {
  success: boolean;
  transactionHash?: string;
  feeCharged?: string;
  error?: string;
}

export interface StellarTransaction {
  hash: string;
  memo: string;
  ledger: number;
  created_at: string;
}

export interface VerificationResponse {
  groupId: string;
  currentMetadataHash: string;
  blockchainMetadataHash: string | null;
  transactionHash: string | null;
  verified: boolean;
  explorerUrl: string | null;
}

export interface GroupCreationResponse {
  room: {
    id: string;
    name: string;
    description: string | null;
    is_private: boolean;
    created_by: string;
    created_at: string;
    stellar_tx_hash: string | null;
    metadata_hash?: string | null;
    blockchain_submitted_at?: string | null;
  };
  success: boolean;
  blockchain: {
    submitted: boolean;
    transactionHash?: string;
    feeCharged?: string;
    explorerUrl?: string;
  };
}
