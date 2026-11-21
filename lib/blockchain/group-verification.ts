import { validateStellarAddress } from "@/lib/auth/validation";
import { computeHash } from "@/lib/blockchain/metadata-hash";
import { memoMatchesGroup } from "@/lib/blockchain/memo";
import {
  GroupMetadata,
  GroupVerificationRecord,
  StellarTransaction,
  VerificationResponse,
} from "@/types/blockchain";

export interface RoomVerificationSource {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  is_private: boolean;
  owner_wallet?: string | null;
  stellar_tx_hash?: string | null;
  metadata_hash?: string | null;
}

export interface GroupVerificationEvaluation {
  verified: boolean;
  memoVerified: boolean;
  walletOwnershipVerified: boolean;
  currentMetadataHash: string;
  blockchainMetadataHash: string | null;
  transactionHash: string | null;
  walletAddress: string | null;
  error: string | null;
}

export function buildGroupMetadata(room: RoomVerificationSource): GroupMetadata {
  return {
    id: room.id,
    name: room.name,
    description: room.description,
    created_by: room.created_by,
    created_at: room.created_at,
    is_private: room.is_private,
    owner_wallet: room.owner_wallet ?? null,
  };
}

/**
 * Confirms the creator wallet is present, valid, and bound into the metadata hash.
 * Ownership cannot be spoofed without breaking the anchored hash.
 */
export function verifyCreatorWalletOwnership(
  metadata: GroupMetadata,
  storedMetadataHash: string | null,
): { verified: boolean; error: string | null } {
  const ownerWallet = metadata.owner_wallet;

  if (!ownerWallet) {
    return {
      verified: false,
      error: "Group has no owner wallet on record",
    };
  }

  if (!validateStellarAddress(ownerWallet)) {
    return {
      verified: false,
      error: "Owner wallet address is invalid",
    };
  }

  if (!storedMetadataHash) {
    return {
      verified: false,
      error: "No anchored metadata hash found for this group",
    };
  }

  const metadataHash = computeHash(metadata);
  if (metadataHash !== storedMetadataHash) {
    return {
      verified: false,
      error: "Group metadata no longer matches the anchored on-chain record",
    };
  }

  return { verified: true, error: null };
}

/**
 * Evaluates on-chain group verification from room data and an optional Stellar transaction.
 * Verification status is derived server-side and cannot be set by clients.
 */
export function evaluateGroupVerification(
  room: RoomVerificationSource,
  transaction: StellarTransaction | null,
): GroupVerificationEvaluation {
  const metadata = buildGroupMetadata(room);
  const currentMetadataHash = computeHash(metadata);
  const transactionHash = room.stellar_tx_hash ?? null;
  const blockchainMetadataHash = room.metadata_hash ?? null;
  const walletAddress = room.owner_wallet ?? null;

  if (!transactionHash) {
    return {
      verified: false,
      memoVerified: false,
      walletOwnershipVerified: false,
      currentMetadataHash,
      blockchainMetadataHash,
      transactionHash: null,
      walletAddress,
      error: "Group has not been anchored on the Stellar blockchain",
    };
  }

  if (!transaction) {
    return {
      verified: false,
      memoVerified: false,
      walletOwnershipVerified: false,
      currentMetadataHash,
      blockchainMetadataHash,
      transactionHash,
      walletAddress,
      error: "Could not retrieve the Stellar transaction from the blockchain",
    };
  }

  const memoType = transaction.memoType?.toLowerCase();
  if (memoType && memoType !== "text" && memoType !== "memo_text") {
    return {
      verified: false,
      memoVerified: false,
      walletOwnershipVerified: false,
      currentMetadataHash,
      blockchainMetadataHash,
      transactionHash,
      walletAddress,
      error: "On-chain transaction memo must be a text memo",
    };
  }

  const memoVerified = memoMatchesGroup(room.id, transaction.memo);
  if (!memoVerified) {
    return {
      verified: false,
      memoVerified: false,
      walletOwnershipVerified: false,
      currentMetadataHash,
      blockchainMetadataHash,
      transactionHash,
      walletAddress,
      error: "On-chain transaction memo does not match this group",
    };
  }

  const walletCheck = verifyCreatorWalletOwnership(metadata, blockchainMetadataHash);
  const metadataIntegrity =
    blockchainMetadataHash !== null &&
    currentMetadataHash === blockchainMetadataHash;

  if (!walletCheck.verified) {
    return {
      verified: false,
      memoVerified: true,
      walletOwnershipVerified: false,
      currentMetadataHash,
      blockchainMetadataHash,
      transactionHash,
      walletAddress,
      error: walletCheck.error,
    };
  }

  if (!metadataIntegrity) {
    return {
      verified: false,
      memoVerified: true,
      walletOwnershipVerified: true,
      currentMetadataHash,
      blockchainMetadataHash,
      transactionHash,
      walletAddress,
      error: "Group metadata has changed since blockchain anchoring",
    };
  }

  return {
    verified: true,
    memoVerified: true,
    walletOwnershipVerified: true,
    currentMetadataHash,
    blockchainMetadataHash,
    transactionHash,
    walletAddress,
    error: null,
  };
}

export function toVerificationResponse(
  roomId: string,
  evaluation: GroupVerificationEvaluation,
  explorerUrl: string | null,
  memoGroupId: string | null,
): VerificationResponse {
  return {
    groupId: roomId,
    currentMetadataHash: evaluation.currentMetadataHash,
    blockchainMetadataHash: evaluation.blockchainMetadataHash,
    transactionHash: evaluation.transactionHash,
    verified: evaluation.verified,
    explorerUrl,
    memoGroupId,
    memoVerified: evaluation.memoVerified,
    walletOwnershipVerified: evaluation.walletOwnershipVerified,
    ownerWallet: evaluation.walletAddress,
    error: evaluation.error,
  };
}

export function toVerificationRecord(
  roomId: string,
  evaluation: GroupVerificationEvaluation,
): Omit<GroupVerificationRecord, "id" | "created_at"> {
  return {
    group_id: roomId,
    wallet_address: evaluation.walletAddress ?? "",
    tx_hash: evaluation.transactionHash,
    verified: evaluation.verified,
    memo_verified: evaluation.memoVerified,
    wallet_ownership_verified: evaluation.walletOwnershipVerified,
    metadata_hash: evaluation.blockchainMetadataHash,
    verification_error: evaluation.error,
    verified_at: evaluation.verified ? new Date().toISOString() : null,
    last_checked_at: new Date().toISOString(),
  };
}

export type VerificationBadgeState =
  | { status: "loading" }
  | { status: "verified"; explorerUrl: string | null }
  | { status: "unverified"; reason: string | null }
  | { status: "error"; message: string };

export function getVerificationBadgeState(
  response: VerificationResponse | null,
  loading: boolean,
  fetchError: string | null,
): VerificationBadgeState {
  if (loading) {
    return { status: "loading" };
  }

  if (fetchError) {
    return { status: "error", message: fetchError };
  }

  if (response?.verified) {
    return { status: "verified", explorerUrl: response.explorerUrl ?? null };
  }

  return {
    status: "unverified",
    reason: response?.error ?? null,
  };
}
