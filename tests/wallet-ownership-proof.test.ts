import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock stellar-verify primitives (consumeNonce + verifyWalletSignature)
vi.mock("@/lib/auth/stellar-verify", () => ({
  consumeNonce: vi.fn(),
  verifyWalletSignature: vi.fn(),
  generateNonce: vi.fn(),
}));

// Mock the blockchain audit submission (heavy Stellar + Supabase dependency)
vi.mock("@/lib/blockchain/audit", () => ({
  recordGroupAuditEvent: vi.fn(),
}));

import { consumeNonce, verifyWalletSignature } from "@/lib/auth/stellar-verify";
import { recordGroupAuditEvent } from "@/lib/blockchain/audit";
import { verifyWalletAuthorization } from "@/lib/auth/wallet-authorization";

const consumeNonceMock = consumeNonce as unknown as ReturnType<typeof vi.fn>;
const verifySigMock = verifyWalletSignature as unknown as ReturnType<typeof vi.fn>;
const recordAuditMock = recordGroupAuditEvent as unknown as ReturnType<typeof vi.fn>;

const VALID_WALLET = "G".repeat(55) + "A";

describe("verifyWalletAuthorization audit trail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a wallet_verified audit event on success", async () => {
    consumeNonceMock.mockResolvedValue("anonchat:123:test-nonce");
    verifySigMock.mockReturnValue(true);
    recordAuditMock.mockResolvedValue({ eventId: "evt-1" });

    const supabase = { from: () => ({}) };
    const result = await verifyWalletAuthorization(
      { walletAddress: VALID_WALLET, signature: "a".repeat(128) },
      "delete_group",
      { supabase, groupId: "room-1" },
    );

    expect(result.ok).toBe(true);
    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase,
        groupId: "room-1",
        eventType: "wallet_verified",
        metadata: expect.objectContaining({
          action: "delete_group",
          walletAddress: VALID_WALLET,
        }),
      }),
    );
  });

  it("does not record audit events when no groupId is provided", async () => {
    consumeNonceMock.mockResolvedValue("anonchat:123:test-nonce");
    verifySigMock.mockReturnValue(true);

    const result = await verifyWalletAuthorization(
      { walletAddress: VALID_WALLET, signature: "a".repeat(128) },
      "delete_group",
    );

    expect(result.ok).toBe(true);
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("records a wallet_verification_failed event on signature mismatch", async () => {
    consumeNonceMock.mockResolvedValue("anonchat:123:test-nonce");
    verifySigMock.mockReturnValue(false);
    recordAuditMock.mockResolvedValue(null);

    const supabase = {};
    const result = await verifyWalletAuthorization(
      { walletAddress: VALID_WALLET, signature: "b".repeat(128) },
      "transfer_ownership",
      { supabase, groupId: "room-2" },
    );

    expect(result.ok).toBe(false);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "wallet_verification_failed",
        metadata: expect.objectContaining({
          action: "transfer_ownership",
          reason: expect.stringContaining("Signature verification failed"),
        }),
      }),
    );
  });

  it("records a wallet_verification_failed event when nonce is missing/expired", async () => {
    consumeNonceMock.mockResolvedValue(null);

    const supabase = {};
    const result = await verifyWalletAuthorization(
      { walletAddress: VALID_WALLET, signature: "a".repeat(128) },
      "delete_group",
      { supabase, groupId: "room-3" },
    );

    expect(result.ok).toBe(false);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "wallet_verification_failed",
        metadata: expect.objectContaining({
          reason: expect.stringContaining("Nonce not found or expired"),
        }),
      }),
    );
  });

  it("records a wallet_verification_failed event when wallet address is invalid", async () => {
    const supabase = {};
    const result = await verifyWalletAuthorization(
      { walletAddress: "not-a-wallet", signature: "a".repeat(128) },
      "delete_group",
      { supabase, groupId: "room-4" },
    );

    expect(result.ok).toBe(false);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "wallet_verification_failed",
      }),
    );
  });
});
