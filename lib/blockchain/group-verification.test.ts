import { describe, it, expect } from "vitest";
import { deriveMemoGroupId } from "@/lib/blockchain/memo";
import { computeHash } from "@/lib/blockchain/metadata-hash";
import {
  buildGroupMetadata,
  evaluateGroupVerification,
  getVerificationBadgeState,
  verifyCreatorWalletOwnership,
  toVerificationResponse,
} from "@/lib/blockchain/group-verification";
import type { StellarTransaction } from "@/types/blockchain";

const baseRoom = {
  id: "room_1714000000000_abc123xyz",
  name: "Test Group",
  description: "A test group",
  created_by: "user-123",
  created_at: "2026-01-01T00:00:00.000Z",
  is_private: false,
  owner_wallet: "G".repeat(55) + "A",
  stellar_tx_hash: "stellar-tx-hash-123",
  metadata_hash: null as string | null,
};

function makeTransaction(
  overrides: Partial<StellarTransaction> = {},
): StellarTransaction {
  return {
    hash: baseRoom.stellar_tx_hash!,
    memo: deriveMemoGroupId(baseRoom.id),
    ledger: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    successful: true,
    ...overrides,
  };
}

describe("group verification logic", () => {
  it("builds metadata including owner wallet", () => {
    const metadata = buildGroupMetadata(baseRoom);
    expect(metadata.owner_wallet).toBe(baseRoom.owner_wallet);
    expect(metadata.id).toBe(baseRoom.id);
  });

  it("rejects verification when no blockchain anchor exists", () => {
    const result = evaluateGroupVerification(
      { ...baseRoom, stellar_tx_hash: null },
      null,
    );

    expect(result.verified).toBe(false);
    expect(result.error).toContain("not been anchored");
  });

  it("rejects verification when transaction cannot be retrieved", () => {
    const result = evaluateGroupVerification(baseRoom, null);

    expect(result.verified).toBe(false);
    expect(result.error).toContain("Could not retrieve");
  });

  it("rejects verification when memo does not match group", () => {
    const transaction = makeTransaction({
      memo: "grp_wrongmemo000",
    });

    const result = evaluateGroupVerification(baseRoom, transaction);

    expect(result.verified).toBe(false);
    expect(result.memoVerified).toBe(false);
    expect(result.error).toContain("memo does not match");
  });

  it("rejects verification when owner wallet is missing from metadata", () => {
    const metadata = buildGroupMetadata({
      ...baseRoom,
      owner_wallet: null,
    });
    const metadataHash = computeHash(metadata);
    const transaction = makeTransaction();

    const result = evaluateGroupVerification(
      {
        ...baseRoom,
        owner_wallet: null,
        metadata_hash: metadataHash,
      },
      transaction,
    );

    expect(result.verified).toBe(false);
    expect(result.walletOwnershipVerified).toBe(false);
    expect(result.error).toContain("no owner wallet");
  });

  it("rejects verification when metadata hash does not match anchored record", () => {
    const metadata = buildGroupMetadata(baseRoom);
    const transaction = makeTransaction();

    const result = evaluateGroupVerification(
      {
        ...baseRoom,
        metadata_hash: computeHash(metadata),
        name: "Changed Name",
      },
      transaction,
    );

    expect(result.verified).toBe(false);
    expect(result.error).toContain("no longer matches");
  });

  it("verifies a fully anchored group with matching memo and wallet", () => {
    const metadata = buildGroupMetadata(baseRoom);
    const metadataHash = computeHash(metadata);
    const transaction = makeTransaction();

    const result = evaluateGroupVerification(
      {
        ...baseRoom,
        metadata_hash: metadataHash,
      },
      transaction,
    );

    expect(result.verified).toBe(true);
    expect(result.memoVerified).toBe(true);
    expect(result.walletOwnershipVerified).toBe(true);
    expect(result.error).toBeNull();
  });

  it("accepts Stellar memo type values returned as MEMO_TEXT", () => {
    const metadata = buildGroupMetadata(baseRoom);
    const transaction = makeTransaction({
      memoType: "MEMO_TEXT",
    });

    const result = evaluateGroupVerification(
      {
        ...baseRoom,
        metadata_hash: computeHash(metadata),
      },
      transaction,
    );

    expect(result.verified).toBe(true);
    expect(result.memoVerified).toBe(true);
  });

  it("rejects matching group memos when Stellar memo type is not text", () => {
    const metadata = buildGroupMetadata(baseRoom);
    const transaction = makeTransaction({
      memoType: "MEMO_HASH",
    });

    const result = evaluateGroupVerification(
      {
        ...baseRoom,
        metadata_hash: computeHash(metadata),
      },
      transaction,
    );

    expect(result.verified).toBe(false);
    expect(result.memoVerified).toBe(false);
    expect(result.error).toContain("text memo");
  });

  it("cannot spoof verification by omitting anchored metadata hash", () => {
    const transaction = makeTransaction();

    const walletCheck = verifyCreatorWalletOwnership(
      buildGroupMetadata(baseRoom),
      null,
    );

    expect(walletCheck.verified).toBe(false);
    expect(evaluateGroupVerification(baseRoom, transaction).verified).toBe(
      false,
    );
  });
});

describe("verification badge UI state", () => {
  it("shows loading state while verification is in progress", () => {
    expect(getVerificationBadgeState(null, true, null)).toEqual({
      status: "loading",
    });
  });

  it("shows verified state with explorer link", () => {
    const response = toVerificationResponse(
      baseRoom.id,
      {
        verified: true,
        memoVerified: true,
        walletOwnershipVerified: true,
        currentMetadataHash: "abc",
        blockchainMetadataHash: "abc",
        transactionHash: "tx",
        walletAddress: baseRoom.owner_wallet,
        error: null,
      },
      "https://stellar.expert/explorer/testnet/tx/tx",
      deriveMemoGroupId(baseRoom.id),
    );

    expect(getVerificationBadgeState(response, false, null)).toEqual({
      status: "verified",
      explorerUrl: "https://stellar.expert/explorer/testnet/tx/tx",
    });
  });

  it("hides badge for unverified groups", () => {
    const response = toVerificationResponse(
      baseRoom.id,
      {
        verified: false,
        memoVerified: false,
        walletOwnershipVerified: false,
        currentMetadataHash: "abc",
        blockchainMetadataHash: null,
        transactionHash: null,
        walletAddress: baseRoom.owner_wallet,
        error: "Group has not been anchored on the Stellar blockchain",
      },
      null,
      null,
    );

    expect(getVerificationBadgeState(response, false, null)).toEqual({
      status: "unverified",
      reason: "Group has not been anchored on the Stellar blockchain",
    });
  });

  it("returns error state when verification fetch fails", () => {
    expect(
      getVerificationBadgeState(null, false, "Network error"),
    ).toEqual({
      status: "error",
      message: "Network error",
    });
  });
});
