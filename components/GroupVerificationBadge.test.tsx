import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { GroupVerificationBadge } from "./GroupVerificationBadge";

describe("GroupVerificationBadge", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders verified badge when API reports verified status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          groupId: "room_1714000000000_abc123xyz",
          verified: true,
          explorerUrl: "https://stellar.expert/explorer/testnet/tx/abc",
          currentMetadataHash: "hash",
          blockchainMetadataHash: "hash",
          transactionHash: "abc",
          memoVerified: true,
          walletOwnershipVerified: true,
        }),
      }),
    );

    render(<GroupVerificationBadge groupId="room_1714000000000_abc123xyz" />);

    await waitFor(() => {
      expect(screen.getByLabelText("On-chain verified group")).toBeTruthy();
    });

    expect(screen.getByText("Verified")).toBeTruthy();
  });

  it("does not render badge for unverified groups", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          groupId: "room_1714000000000_abc123xyz",
          verified: false,
          error: "Group has not been anchored on the Stellar blockchain",
          currentMetadataHash: "hash",
          blockchainMetadataHash: null,
          transactionHash: null,
          explorerUrl: null,
        }),
      }),
    );

    const { container } = render(
      <GroupVerificationBadge groupId="room_1714000000000_abc123xyz" />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking…")).toBeNull();
    });

    expect(container.textContent).toBe("");
  });
});
