"use client";

import React, { useEffect, useMemo, useState } from "react";
import { EscrowFundingReview } from "@/components/escrow/EscrowFundingReview";
import type {
  EscrowFundingBreakdown,
  EscrowFundingTransaction,
} from "@/types/escrow";
import { getExplorerUrl } from "@/lib/blockchain/stellar-config";
import { parseAmountToUnits, unitsToAmountString } from "@/lib/escrow/funding";

const DEMO_BREAKDOWN: EscrowFundingBreakdown = {
  contractId: "demo-contract-001",
  contractTitle: "AnonChat Escrow Contract (Demo)",
  totalContractValue: "1500.0000000",
  fundedAmount: "250.0000000",
  token: {
    code: "USDC",
    decimals: 7,
  },
  network: "testnet",
  estimatedTransactionFee: "0.0000100",
  milestones: [
    { id: "ms-1", label: "Discovery & Requirements", amount: "300.0000000", description: "Scope and acceptance criteria finalized" },
    { id: "ms-2", label: "Implementation", amount: "700.0000000", description: "Core escrow funding flow delivered" },
    { id: "ms-3", label: "Verification & Handoff", amount: "500.0000000", description: "Testing, docs, and release handoff" },
  ],
};

type DemoMode = "success" | "failure" | "cancelled";

function randomHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function EscrowFundingPage() {
  const [mode, setMode] = useState<DemoMode>("success");
  const [transaction, setTransaction] = useState<EscrowFundingTransaction>({ status: "idle" });
  const [breakdown, setBreakdown] = useState<EscrowFundingBreakdown>(DEMO_BREAKDOWN);

  // Simulate blockchain confirmation events arriving asynchronously after submission.
  useEffect(() => {
    if (transaction.status !== "pending") return;

    const timer = setTimeout(() => {
      setTransaction((prev) => {
        if (prev.status !== "pending") return prev;

        if (mode === "success") {
          return {
            status: "confirmed",
            transactionHash: randomHex(32),
            ledger: Math.floor(50_000_000 + Math.random() * 100_000),
            errorMessage: null,
            retryable: false,
            updatedAt: new Date().toISOString(),
          };
        }

        if (mode === "cancelled") {
          return {
            status: "cancelled",
            transactionHash: null,
            ledger: null,
            errorMessage: "Transaction was cancelled before confirmation.",
            retryable: false,
            updatedAt: new Date().toISOString(),
          };
        }

        return {
          status: "failed",
          transactionHash: null,
          ledger: null,
          errorMessage: "Network rejected the transaction. Verify wallet balance and try again.",
          retryable: true,
          updatedAt: new Date().toISOString(),
        };
      });
    }, 2200);

    return () => clearTimeout(timer);
  }, [transaction.status, mode]);

  // Keep funding amounts synchronized with on-chain confirmation events.
  useEffect(() => {
    if (transaction.status !== "confirmed") return;
    setBreakdown((prev) => {
      if (parseAmountToUnits(prev.fundedAmount, prev.token.decimals ?? 7) === parseAmountToUnits(prev.totalContractValue, prev.token.decimals ?? 7)) {
        return prev;
      }
      const decimals = prev.token.decimals ?? 7;
      // demo assumes this funding action funds the remaining amount
      return {
        ...prev,
        fundedAmount: unitsToAmountString(
          parseAmountToUnits(prev.totalContractValue, decimals) ?? BigInt(0),
          decimals,
        ),
      };
    });
  }, [transaction.status]);

  const explorerBuilder = useMemo(
    () => (txHash: string, network: EscrowFundingBreakdown["network"]) => getExplorerUrl(txHash, network),
    [],
  );

  async function handleConfirm() {
    // In a real integration this would submit/sign with the wallet and return once submitted.
    // Confirmation must be reflected only after blockchain confirmation events update status.
    setTransaction({
      status: "pending",
      transactionHash: null,
      ledger: null,
      errorMessage: null,
      retryable: false,
      updatedAt: new Date().toISOString(),
    });
  }

  function handleCancel() {
    if (transaction.status === "pending") return;
    setTransaction({ status: "cancelled", errorMessage: null, updatedAt: new Date().toISOString() });
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Escrow Funding Breakdown & Confirmation</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Review milestone allocations, funded and remaining amounts, token/network details, and estimated fees
            before submitting escrow funding. Status updates reflect blockchain confirmation events.
          </p>
        </header>

        <section className="rounded-xl border border-border/60 bg-card/40 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Demo confirmation outcome</p>
              <p className="text-xs text-muted-foreground">
                Simulates pending, confirmed, failed, or cancelled blockchain confirmation events.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["success", "failure", "cancelled"] as DemoMode[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setMode(option);
                    setTransaction({ status: "idle" });
                    setBreakdown(DEMO_BREAKDOWN);
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    mode === option
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border/60 bg-[#181824] text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option === "success" ? "Confirm on-chain" : option === "failure" ? "Fail on-chain" : "Cancel"}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setTransaction({ status: "idle" });
                  setBreakdown(DEMO_BREAKDOWN);
                }}
                className="rounded-lg border border-border/60 bg-[#181824] px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Reset
              </button>
            </div>
          </div>
        </section>

        <EscrowFundingReview
          breakdown={breakdown}
          transaction={transaction}
          onConfirmFunding={handleConfirm}
          onCancel={handleCancel}
          getExplorerUrl={explorerBuilder}
        />
      </div>
    </main>
  );
}
