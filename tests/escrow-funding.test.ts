import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import {
  calculateRemainingAmount,
  canSubmitFunding,
  formatFeeAmount,
  formatTokenAmount,
  getFundingProgressPercent,
  normalizeFundingStatus,
  parseAmountToUnits,
  unitsToAmountString,
  validateEscrowFundingBreakdown,
} from "@/lib/escrow/funding";
import { EscrowFundingReview } from "@/components/escrow/EscrowFundingReview";
import type { EscrowFundingBreakdown } from "@/types/escrow";

const baseBreakdown: EscrowFundingBreakdown = {
  contractId: "contract-1",
  contractTitle: "Test Contract",
  totalContractValue: "1000.0000000",
  fundedAmount: "250.0000000",
  token: { code: "USDC", decimals: 7 },
  network: "testnet",
  estimatedTransactionFee: "0.0000100",
  milestones: [
    { id: "m1", label: "Design", amount: "400.0000000" },
    { id: "m2", label: "Build", amount: "600.0000000" },
  ],
};

describe("escrow funding utilities", () => {
  it("formats token amounts and fees with consistent precision", () => {
    expect(formatTokenAmount("1000", { code: "USDC", decimals: 7 })).toBe("1,000.00 USDC");
    expect(formatTokenAmount("0.0000100", { code: "XLM", decimals: 7 })).toBe("0.00001 XLM");
    expect(formatFeeAmount("0.0000100")).toBe("0.00001 XLM");
  });

  it("parses and serializes decimal amounts without float drift", () => {
    expect(parseAmountToUnits("1.2345678", 7)).toBeNull();
    expect(parseAmountToUnits("1.234567", 7)).toBe(12345670n);
    expect(unitsToAmountString(12345670n, 7)).toBe("1.2345670");
  });

  it("calculates remaining amount accurately", () => {
    expect(calculateRemainingAmount("1000.0000000", "250.0000000", 7)).toBe("750.0000000");
    expect(calculateRemainingAmount("100.0000000", "150.0000000", 7)).toBe("0.0000000");
  });

  it("validates allocations must equal total contract value", () => {
    const invalid: EscrowFundingBreakdown = {
      ...baseBreakdown,
      milestones: [
        { id: "m1", label: "Design", amount: "400.0000000" },
        { id: "m2", label: "Build", amount: "500.0000000" },
      ],
    };
    const result = validateEscrowFundingBreakdown(invalid);
    expect(result.isValid).toBe(false);
    expect(result.allocationMatchesTotal).toBe(false);
    expect(result.errors.join(" ")).toContain("Milestone allocations must equal the total contract value");
  });

  it("prevents submission when funded exceeds total or amounts are invalid", () => {
    const overFunded = { ...baseBreakdown, fundedAmount: "1200.0000000" };
    expect(validateEscrowFundingBreakdown(overFunded).isValid).toBe(false);

    const valid = validateEscrowFundingBreakdown(baseBreakdown);
    expect(valid.isValid).toBe(true);
    expect(valid.remainingAmount).toBe("750.0000000");
  });

  it("gates submission by validation, review, and transaction status", () => {
    expect(canSubmitFunding(baseBreakdown, "idle", false).allowed).toBe(false);
    expect(canSubmitFunding(baseBreakdown, "idle", true).allowed).toBe(true);
    expect(canSubmitFunding(baseBreakdown, "pending", true).allowed).toBe(false);
    expect(canSubmitFunding(baseBreakdown, "confirmed", true).allowed).toBe(false);

    const invalid: EscrowFundingBreakdown = {
      ...baseBreakdown,
      milestones: [{ id: "m1", label: "Only", amount: "900.0000000" }],
    };
    expect(canSubmitFunding(invalid, "idle", true).allowed).toBe(false);
  });

  it("computes funding progress and normalizes statuses", () => {
    expect(getFundingProgressPercent("1000.0000000", "250.0000000", 7)).toBe(25);
    expect(getFundingProgressPercent("1000.0000000", "1000.0000000", 7)).toBe(100);
    expect(normalizeFundingStatus("pending")).toBe("pending");
    expect(normalizeFundingStatus("unknown")).toBe("idle");
  });
});

describe("EscrowFundingReview component", () => {
  it("renders funding breakdown, token/network, and distinguishes fees", () => {
    render(
      React.createElement(EscrowFundingReview, {
        breakdown: baseBreakdown,
        transaction: { status: "idle" },
        onConfirmFunding: vi.fn(),
      }),
    );

    expect(screen.getByText("Total Contract Value")).toBeTruthy();
    expect(screen.getAllByText(/1,000\.00 USDC/).length).toBeGreaterThan(0);
    expect(screen.getByText("Design")).toBeTruthy();
    expect(screen.getByText("Build")).toBeTruthy();
    expect(screen.getAllByText("USDC").length).toBeGreaterThan(0);
    expect(screen.getByText("Stellar Testnet")).toBeTruthy();
    expect(screen.getByText(/network fee/i)).toBeTruthy();
    expect(screen.getByText(/separate from escrow-funded amounts/i)).toBeTruthy();
  });

  it("requires final confirmation step before submitting", async () => {
    const onConfirmFunding = vi.fn().mockResolvedValue(undefined);
    render(
      React.createElement(EscrowFundingReview, {
        breakdown: baseBreakdown,
        transaction: { status: "idle" },
        onConfirmFunding,
      }),
    );

    const reviewCheckbox = screen.getByRole("checkbox");
    fireEvent.click(reviewCheckbox);
    fireEvent.click(screen.getByRole("button", { name: /Continue to Final Confirmation/i }));

    expect(await screen.findByText("Final Funding Confirmation")).toBeTruthy();
    expect(onConfirmFunding).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Confirm & Submit Funding/i }));
    await waitFor(() => expect(onConfirmFunding).toHaveBeenCalledTimes(1));
  });

  it("blocks submission when milestone allocations are inconsistent", () => {
    const invalid: EscrowFundingBreakdown = {
      ...baseBreakdown,
      milestones: [{ id: "m1", label: "Only", amount: "900.0000000" }],
    };
    render(
      React.createElement(EscrowFundingReview, {
        breakdown: invalid,
        transaction: { status: "idle" },
        onConfirmFunding: vi.fn(),
      }),
    );

    expect(screen.getByText(/Funding details need attention/i)).toBeTruthy();
    expect(screen.getByText(/Milestone allocations must equal the total contract value/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox"));
    const submitBtn = screen.getByRole("button", { name: /Continue to Final Confirmation/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("never shows confirmed while pending and shows confirmed only after confirmation status", () => {
    const { rerender } = render(
      React.createElement(EscrowFundingReview, {
        breakdown: baseBreakdown,
        transaction: { status: "pending" },
        onConfirmFunding: vi.fn(),
      }),
    );

    expect(screen.getByText(/Awaiting confirmation/i)).toBeTruthy();
    expect(screen.queryByText(/Funding confirmed/i)).toBeNull();
    expect(screen.queryByText(/Escrow funding confirmed on-chain/i)).toBeNull();

    rerender(
      React.createElement(EscrowFundingReview, {
        breakdown: baseBreakdown,
        transaction: { status: "confirmed", transactionHash: "abc123", ledger: 42 },
        onConfirmFunding: vi.fn(),
      }),
    );

    expect(screen.getByText(/Funding confirmed/i)).toBeTruthy();
    expect(screen.getByText(/Escrow funding confirmed on-chain/i)).toBeTruthy();
  });

  it("distinguishes failed and cancelled states with actionable feedback", () => {
    const { rerender } = render(
      React.createElement(EscrowFundingReview, {
        breakdown: baseBreakdown,
        transaction: { status: "failed", errorMessage: "Network rejected the transaction" },
        onConfirmFunding: vi.fn(),
      }),
    );
    expect(screen.getByText(/Funding failed/i)).toBeTruthy();
    expect(screen.getByText(/Network rejected the transaction/i)).toBeTruthy();
    expect(screen.getByText(/Escrow status has not been marked as funded/i)).toBeTruthy();

    rerender(
      React.createElement(EscrowFundingReview, {
        breakdown: baseBreakdown,
        transaction: { status: "cancelled" },
        onConfirmFunding: vi.fn(),
      }),
    );
    expect(screen.getByText(/Funding cancelled/i)).toBeTruthy();
    expect(screen.getByText(/No blockchain funding confirmation was recorded/i)).toBeTruthy();
  });

  it("renders loading and empty states", () => {
    const { rerender } = render(
      React.createElement(EscrowFundingReview, {
        breakdown: null,
        loading: true,
      }),
    );
    expect(screen.getByText(/Loading funding details/i)).toBeTruthy();

    rerender(
      React.createElement(EscrowFundingReview, {
        breakdown: null,
        loading: false,
      }),
    );
    expect(screen.getByText(/No funding details available/i)).toBeTruthy();
  });
});
