// Type definitions for blockchain operations

export interface GroupMetadata {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  is_private: boolean;
  // the Stellar wallet address that owns this group
  // newer groups will always have a value here; existing records may be null
  owner_wallet?: string | null;
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
  owner_wallet?: string | null;
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
  };
  success: boolean;
  blockchain: {
    submitted: boolean;
    transactionHash?: string;
    feeCharged?: string;
    explorerUrl?: string;
  };
}
