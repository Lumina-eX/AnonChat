// Type definitions for blockchain operations

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
  /** The group memo embedded in the Stellar transaction (≤28 bytes). */
  memoGroupId?: string;
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
  /** The memo embedded in the transaction (should equal the derived group memo). */
  memoGroupId?: string | null;
  /** Whether the on-chain memo matches the expected group memo. */
  memoVerified?: boolean;
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
    /** Compact group identifier embedded in the Stellar memo (≤28 bytes). */
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
