"use client";

import React, { useState, useEffect, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Filter,
  AlertCircle,
  Loader2,
  X,
  ShieldCheck,
  Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  StellarWalletTransaction,
  StellarTransactionHistoryResponse,
} from "@/types/blockchain";

interface StellarTransactionHistoryDialogProps {
  walletAddress: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StellarTransactionHistoryDialog({
  walletAddress,
  open,
  onOpenChange,
}: StellarTransactionHistoryDialogProps) {
  const [transactions, setTransactions] = useState<StellarWalletTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<"anonchat" | "all">("anonchat");
  const [network, setNetwork] = useState<"testnet" | "mainnet">("testnet");
  const [isInactive, setIsInactive] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Pagination state: cursor stack for previous pages
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const fetchTransactions = useCallback(
    async (cursor?: string, mode: "anonchat" | "all" = filterMode) => {
      if (!walletAddress) return;

      setLoading(true);
      setError(null);

      try {
        const queryParams = new URLSearchParams({
          walletAddress,
          limit: "15",
          filter: mode,
        });

        if (cursor) {
          queryParams.set("cursor", cursor);
        }

        const res = await fetch(
          `/api/stellar/transactions/history?${queryParams.toString()}`,
        );

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(
            errData.error || `HTTP error ${res.status}: Failed to fetch transaction history`,
          );
        }

        const data: StellarTransactionHistoryResponse = await res.json();
        setTransactions(data.transactions || []);
        setNetwork(data.network || "testnet");
        setNextCursor(data.cursor?.next || null);
        setIsInactive(Boolean(data.isInactiveAccount));
      } catch (err: any) {
        setError(err.message || "An unexpected error occurred while loading transactions.");
        setTransactions([]);
      } finally {
        setLoading(false);
      }
    },
    [walletAddress, filterMode],
  );

  // Fetch when opened or when filter mode changes
  useEffect(() => {
    if (open && walletAddress) {
      setCurrentCursor(undefined);
      setCursorHistory([]);
      void fetchTransactions(undefined, filterMode);
    }
  }, [open, walletAddress, filterMode, fetchTransactions]);

  const handleFilterChange = (mode: "anonchat" | "all") => {
    setFilterMode(mode);
    setCurrentCursor(undefined);
    setCursorHistory([]);
    void fetchTransactions(undefined, mode);
  };

  const handleNextPage = () => {
    if (!nextCursor) return;
    setCursorHistory((prev) => [...prev, currentCursor || ""]);
    setCurrentCursor(nextCursor);
    void fetchTransactions(nextCursor, filterMode);
  };

  const handlePrevPage = () => {
    if (cursorHistory.length === 0) return;
    const newHistory = [...cursorHistory];
    const prevCursor = newHistory.pop();
    setCursorHistory(newHistory);
    setCurrentCursor(prevCursor || undefined);
    void fetchTransactions(prevCursor || undefined, filterMode);
  };

  const handleCopyHash = async (hash: string) => {
    await navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const handleRetry = () => {
    void fetchTransactions(currentCursor, filterMode);
  };

  const getActionTypeLabel = (actionType: StellarWalletTransaction["actionType"]) => {
    switch (actionType) {
      case "group_creation":
        return "Group Action";
      case "audit_log":
        return "Audit Log";
      case "metadata_anchor":
        return "Metadata Anchor";
      case "payment":
        return "Payment";
      case "contract_call":
        return "Contract Call";
      default:
        return "General";
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-1.5rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2",
            "max-h-[90vh] flex flex-col rounded-2xl border border-border/70 bg-[#0f0f16] shadow-2xl overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-[#14141e]">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Dialog.Title className="text-base font-semibold text-foreground">
                    Stellar Transaction History
                  </Dialog.Title>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                      network === "testnet"
                        ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                        : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
                    )}
                  >
                    {network}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  On-chain transparency & traceability for your wallet
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRetry}
                disabled={loading}
                className="p-2 rounded-lg border border-border/60 hover:bg-[#1f1f2e] text-muted-foreground hover:text-foreground transition disabled:opacity-50"
                title="Refresh transaction history"
              >
                <RefreshCw
                  className={cn("h-4 w-4", loading && "animate-spin text-primary")}
                />
              </button>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="p-2 rounded-lg border border-border/60 hover:bg-[#1f1f2e] text-muted-foreground hover:text-foreground transition"
                  aria-label="Close dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-[#11111a] px-5 py-2.5">
            <div className="flex items-center gap-1.5 p-0.5 rounded-lg bg-[#181824] border border-border/50">
              <button
                type="button"
                onClick={() => handleFilterChange("anonchat")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition",
                  filterMode === "anonchat"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                AnonChat Only
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange("all")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition",
                  filterMode === "all"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Filter className="h-3.5 w-3.5" />
                All Transactions
              </button>
            </div>

            <div className="text-xs text-muted-foreground">
              {transactions.length > 0 && (
                <span>
                  Showing {transactions.length} transaction
                  {transactions.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-3 min-h-[280px]">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm">Querying Stellar Horizon nodes…</p>
              </div>
            ) : error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive flex items-start gap-3">
                <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold">Network / Horizon Error</p>
                  <p className="mt-1 text-xs opacity-90">{error}</p>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-destructive/20 hover:bg-destructive/30 px-3 py-1 text-xs font-medium transition"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Retry Request
                  </button>
                </div>
              </div>
            ) : isInactive ? (
              <div className="text-center py-14 px-4 space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
                  <AlertCircle className="h-6 w-6" />
                </div>
                <h4 className="text-sm font-semibold text-foreground">
                  Unfunded Stellar Account
                </h4>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  This wallet is not yet activated on the Stellar {network}. Fund it
                  with minimum XLM to record transactions.
                </p>
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-14 px-4 space-y-2">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted/40 text-muted-foreground">
                  <Hash className="h-6 w-6" />
                </div>
                <h4 className="text-sm font-semibold text-foreground">
                  No Relevant Transactions Found
                </h4>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  {filterMode === "anonchat"
                    ? "No AnonChat-specific group actions, audits, metadata anchors, payments, or contract interactions were found for this wallet yet."
                    : "No transactions found for this account."}
                </p>
                {filterMode === "anonchat" && (
                  <button
                    type="button"
                    onClick={() => handleFilterChange("all")}
                    className="mt-2 text-xs text-primary hover:underline"
                  >
                    View all wallet transactions instead
                  </button>
                )}
              </div>
            ) : (
              <ul className="space-y-3">
                {transactions.map((tx) => (
                  <li
                    key={tx.id}
                    className={cn(
                      "rounded-xl border p-4 transition",
                      tx.successful
                        ? "border-border/60 bg-[#161622] hover:bg-[#1b1b2a]"
                        : "border-destructive/30 bg-destructive/5 hover:bg-destructive/10",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {tx.successful ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive shrink-0" />
                        )}
                        <span className="text-sm font-medium text-foreground">
                          {tx.actionLabel}
                        </span>
                        <span className="rounded-full border border-border/50 bg-[#10111a] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {getActionTypeLabel(tx.actionType)}
                        </span>
                        {tx.isAnonChat && (
                          <span className="rounded-full bg-primary/15 text-primary border border-primary/30 px-2 py-0.5 text-[10px] font-semibold">
                            AnonChat
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                            tx.status === "successful" &&
                              "bg-emerald-500/15 text-emerald-300",
                            tx.status === "failed" &&
                              "bg-destructive/20 text-destructive",
                            tx.status === "pending" &&
                              "bg-amber-500/15 text-amber-300",
                          )}
                        >
                          {tx.status}
                        </span>
                      </div>
                    </div>

                    {/* Metadata details */}
                    <div className="mt-3 grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground/70" />
                        <span title={new Date(tx.createdAt).toISOString()}>
                          {new Date(tx.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 sm:justify-end">
                        <span>Ledger #{tx.ledger}</span>
                        <span className="opacity-40">•</span>
                        <span>Fee: {tx.feeChargedXlm} XLM</span>
                      </div>
                    </div>

                    {/* Memo details if present */}
                    {tx.memo && (
                      <div className="mt-2 text-xs bg-[#0f0f18] px-2.5 py-1.5 rounded-lg border border-border/40 font-mono text-muted-foreground break-all">
                        <span className="text-foreground/70 font-sans font-medium mr-1.5">
                          Memo:
                        </span>
                        {tx.memo}
                      </div>
                    )}

                    {/* Error message for failed transactions */}
                    {tx.errorMessage && (
                      <div className="mt-2 text-xs text-destructive bg-destructive/10 px-2.5 py-1.5 rounded-lg border border-destructive/20 flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>{tx.errorMessage}</span>
                      </div>
                    )}

                    {/* Transaction Hash & Links */}
                    <div className="mt-3 pt-2.5 border-t border-border/40 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 font-mono text-muted-foreground">
                        <span className="truncate max-w-[200px] sm:max-w-[320px]">
                          {tx.hash}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyHash(tx.hash)}
                          className="hover:text-foreground transition p-1"
                          title="Copy transaction hash"
                        >
                          {copiedHash === tx.hash ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>

                      <a
                        href={tx.explorerUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                      >
                        <span>View on StellarExpert</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer & Pagination */}
          <div className="flex items-center justify-between border-t border-border/60 px-5 py-3 bg-[#14141e]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrevPage}
                disabled={cursorHistory.length === 0 || loading}
                className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-[#181824] px-3 py-1.5 text-xs font-medium text-foreground hover:bg-[#222232] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </button>
              <button
                type="button"
                onClick={handleNextPage}
                disabled={!nextCursor || loading || transactions.length === 0}
                className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-[#181824] px-3 py-1.5 text-xs font-medium text-foreground hover:bg-[#222232] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-border/60 bg-[#181824] px-4 py-1.5 text-xs font-medium hover:bg-[#222232] transition"
              >
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
