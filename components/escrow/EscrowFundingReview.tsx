"use client";

import React, { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  ShieldCheck,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  EscrowFundingBreakdown,
  EscrowFundingTransaction,
  EscrowFundingTransactionStatus,
} from "@/types/escrow";
import { ESCROW_FUNDING_STATUS_LABELS } from "@/types/escrow";
import {
  canSubmitFunding,
  formatFeeAmount,
  formatTokenAmount,
  getFundingProgressPercent,
  getNetworkDisplayName,
  validateEscrowFundingBreakdown,
} from "@/lib/escrow/funding";

type ConfirmResult =
  | void
  | {
      status?: Exclude<EscrowFundingTransactionStatus, "idle">;
      transactionHash?: string | null;
      ledger?: number | null;
      errorMessage?: string | null;
      retryable?: boolean;
    };

export interface EscrowFundingReviewProps {
  breakdown: EscrowFundingBreakdown | null;
  loading?: boolean;
  transaction?: EscrowFundingTransaction | null;
  /** Called when user confirms funding. Must not resolve to success before blockchain confirmation. */
  onConfirmFunding?: (breakdown: EscrowFundingBreakdown) => Promise<ConfirmResult> | ConfirmResult;
  onCancel?: () => void;
  className?: string;
  title?: string;
  /** Optional explorer URL builder for confirmed/pending tx hashes */
  getExplorerUrl?: (txHash: string, network: EscrowFundingBreakdown["network"]) => string | null;
}

function StatusIcon({ status }: { status: EscrowFundingTransactionStatus }) {
  switch (status) {
    case "pending":
      return <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />;
    case "confirmed":
      return <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden />;
    case "failed":
      return <XCircle className="h-5 w-5 text-destructive" aria-hidden />;
    case "cancelled":
      return <XCircle className="h-5 w-5 text-muted-foreground" aria-hidden />;
    case "idle":
    default:
      return <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />;
  }
}

function SummaryRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("text-right text-sm text-foreground", emphasis && "font-semibold")}>{value}</span>
    </div>
  );
}

export function EscrowFundingReview({
  breakdown,
  loading = false,
  transaction: controlledTransaction,
  onConfirmFunding,
  onCancel,
  className,
  title = "Escrow Funding Review",
  getExplorerUrl,
}: EscrowFundingReviewProps) {
  const [reviewed, setReviewed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showMilestones, setShowMilestones] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localTx, setLocalTx] = useState<EscrowFundingTransaction>({ status: "idle" });

  const tx = controlledTransaction ?? localTx;

  useEffect(() => {
    setReviewed(false);
    setConfirmOpen(false);
    setIsSubmitting(false);
    if (!controlledTransaction) {
      setLocalTx({ status: "idle" });
    }
  }, [
    breakdown?.contractId,
    breakdown?.totalContractValue,
    breakdown?.fundedAmount,
    controlledTransaction,
  ]);

  const validation = useMemo(
    () => (breakdown ? validateEscrowFundingBreakdown(breakdown) : null),
    [breakdown],
  );

  const decimals = breakdown?.token.decimals ?? 7;
  const isConfirmed = tx.status === "confirmed";

  const displayFundedAmount = useMemo(() => {
    if (!breakdown) return "0";
    return isConfirmed ? breakdown.totalContractValue : breakdown.fundedAmount;
  }, [breakdown, isConfirmed]);

  const displayRemainingAmount = useMemo(() => {
    if (!breakdown || !validation) return "0";
    return isConfirmed ? (decimals === 0 ? "0" : `0.${"0".repeat(decimals)}`) : validation.remainingAmount;
  }, [breakdown, validation, isConfirmed, decimals]);

  const progress = useMemo(() => {
    if (!breakdown) return 0;
    if (isConfirmed) return 100;
    return getFundingProgressPercent(breakdown.totalContractValue, breakdown.fundedAmount, decimals);
  }, [breakdown, decimals, isConfirmed]);

  const submission = useMemo(() => {
    if (!breakdown) return { allowed: false, reason: "Funding details are unavailable." };
    return canSubmitFunding(breakdown, tx.status, reviewed);
  }, [breakdown, tx.status, reviewed]);

  const statusMeta = ESCROW_FUNDING_STATUS_LABELS[tx.status];
  const explorerUrl =
    tx.transactionHash && breakdown && getExplorerUrl
      ? getExplorerUrl(tx.transactionHash, breakdown.network)
      : null;

  async function handleConfirm() {
    if (!breakdown || !onConfirmFunding) return;
    if (!canSubmitFunding(breakdown, tx.status, true).allowed) return;

    setIsSubmitting(true);
    if (!controlledTransaction) {
      setLocalTx({
        status: "pending",
        transactionHash: null,
        ledger: null,
        errorMessage: null,
        retryable: false,
        updatedAt: new Date().toISOString(),
      });
    }

    try {
      const result = await onConfirmFunding(breakdown);
      if (controlledTransaction) return;

      if (!result) {
        // Remain pending until a blockchain confirmation event updates status.
        setLocalTx((prev) => ({
          ...prev,
          status: "pending",
          updatedAt: new Date().toISOString(),
        }));
        return;
      }

      const nextStatus = result.status ?? "pending";
      // Never mark as confirmed locally without explicit confirmation data/event.
      setLocalTx({
        status: nextStatus === "confirmed" ? "pending" : nextStatus,
        transactionHash: result.transactionHash ?? null,
        ledger: result.ledger ?? null,
        errorMessage: result.errorMessage ?? null,
        retryable: result.retryable ?? (nextStatus === "failed"),
        updatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      if (!controlledTransaction) {
        setLocalTx({
          status: "failed",
          transactionHash: null,
          ledger: null,
          errorMessage: error?.message || "Transaction failed before confirmation.",
          retryable: true,
          updatedAt: new Date().toISOString(),
        });
      }
    } finally {
      setIsSubmitting(false);
      setConfirmOpen(false);
    }
  }

  function handleCancel() {
    if (tx.status === "pending") return;
    if (!controlledTransaction) {
      setLocalTx({ status: "cancelled", errorMessage: null, updatedAt: new Date().toISOString() });
    }
    onCancel?.();
  }

  if (loading) {
    return (
      <div
        className={cn("rounded-2xl border border-border/70 bg-[#0f0f16] p-6", className)}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading funding details…</span>
        </div>
      </div>
    );
  }

  if (!breakdown || !validation) {
    return (
      <div className={cn("rounded-2xl border border-border/70 bg-[#0f0f16] p-6", className)}>
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">No funding details available</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Provide a contract funding breakdown to review allocations and submit escrow funding.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isBusy = isSubmitting || tx.status === "pending";
  const showSuccess = tx.status === "confirmed";
  const showFailure = tx.status === "failed";
  const showCancelled = tx.status === "cancelled";

  return (
    <div className={cn("rounded-2xl border border-border/70 bg-[#0f0f16] shadow-xl", className)}>
      <div className="border-b border-border/60 px-5 py-4 bg-[#14141e] rounded-t-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Review escrow allocations and confirm before submitting the blockchain transaction.
            </p>
          </div>
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
              tx.status === "confirmed" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
              tx.status === "pending" && "border-primary/30 bg-primary/10 text-primary",
              tx.status === "failed" && "border-destructive/30 bg-destructive/10 text-destructive",
              tx.status === "cancelled" && "border-border/60 bg-muted/20 text-muted-foreground",
              tx.status === "idle" && "border-border/60 bg-muted/20 text-muted-foreground",
            )}
            aria-live="polite"
          >
            <StatusIcon status={tx.status} />
            <span>{statusMeta.label}</span>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="rounded-xl border border-border/50 bg-[#12121b] p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Contract Value</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {formatTokenAmount(breakdown.totalContractValue, breakdown.token)}
              </p>
              {breakdown.contractTitle && (
                <p className="mt-1 text-xs text-muted-foreground">{breakdown.contractTitle}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-left sm:text-right">
              <div>
                <p className="text-xs text-muted-foreground">Network</p>
                <p className="mt-1 text-sm font-medium text-foreground">{getNetworkDisplayName(breakdown.network)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Token</p>
                <p className="mt-1 text-sm font-medium text-foreground">{breakdown.token.code}</p>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span>Funding progress</span>
              <span>{progress.toFixed(1)}%</span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted/30"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label="Funding progress"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  showSuccess ? "bg-emerald-500" : "bg-primary",
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-[#12121b] p-4">
          <button
            type="button"
            onClick={() => setShowMilestones((v) => !v)}
            className="flex w-full items-center justify-between text-left"
            aria-expanded={showMilestones}
          >
            <div>
              <p className="text-sm font-semibold text-foreground">Milestone Allocations</p>
              <p className="text-xs text-muted-foreground">
                {breakdown.milestones.length} milestone{breakdown.milestones.length === 1 ? "" : "s"}
              </p>
            </div>
            {showMilestones ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {showMilestones && (
            <div className="mt-3 divide-y divide-border/40">
              {breakdown.milestones.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">No milestone allocations provided.</p>
              ) : (
                breakdown.milestones.map((milestone, index) => (
                  <div key={milestone.id || `${index}`} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {milestone.label || `Milestone ${index + 1}`}
                      </p>
                      {milestone.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{milestone.description}</p>
                      )}
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-foreground">
                      {formatTokenAmount(milestone.amount, breakdown.token)}
                    </p>
                  </div>
                ))
              )}
              <div className="flex items-center justify-between gap-4 pt-3">
                <span className="text-sm font-medium text-muted-foreground">Allocated total</span>
                <span
                  className={cn(
                    "text-sm font-semibold",
                    validation.allocationMatchesTotal ? "text-foreground" : "text-destructive",
                  )}
                >
                  {formatTokenAmount(validation.totalAllocated, breakdown.token)}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border/50 bg-[#12121b] p-4">
          <p className="mb-2 text-sm font-semibold text-foreground">Funding Summary</p>
          <div className="divide-y divide-border/40">
            <SummaryRow
              label="Total contract value"
              value={formatTokenAmount(breakdown.totalContractValue, breakdown.token)}
              emphasis
            />
            <SummaryRow
              label="Funded amount"
              value={formatTokenAmount(displayFundedAmount, breakdown.token)}
            />
            <SummaryRow
              label="Remaining amount"
              value={formatTokenAmount(displayRemainingAmount, breakdown.token)}
              emphasis
            />
            <SummaryRow label="Selected token" value={breakdown.token.code} />
            <SummaryRow label="Stellar network" value={getNetworkDisplayName(breakdown.network)} />
            <SummaryRow
              label="Estimated transaction fee"
              value={
                <span className="inline-flex items-center gap-1.5">
                  {formatFeeAmount(breakdown.estimatedTransactionFee)}
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">(network fee)</span>
                </span>
              }
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Estimated transaction fees are paid to the network and are separate from escrow-funded amounts.
          </p>
        </div>

        {!validation.isValid && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4" role="alert">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Funding details need attention</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-destructive/90">
                  {validation.errors.map((error, idx) => (
                    <li key={`${idx}-${error}`}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        <div
          className={cn(
            "rounded-xl border p-4",
            showSuccess && "border-emerald-500/30 bg-emerald-500/5",
            showFailure && "border-destructive/30 bg-destructive/5",
            showCancelled && "border-border/60 bg-muted/10",
            tx.status === "pending" && "border-primary/30 bg-primary/5",
            tx.status === "idle" && "border-border/50 bg-[#12121b]",
          )}
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="flex items-start gap-3">
            <StatusIcon status={tx.status} />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm font-semibold",
                  showSuccess && "text-emerald-300",
                  showFailure && "text-destructive",
                  (tx.status === "pending" || tx.status === "idle" || showCancelled) && "text-foreground",
                )}
              >
                {statusMeta.label}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{statusMeta.description}</p>

              {tx.status === "pending" && (
                <div className="mt-3 flex items-center gap-2 text-xs text-primary">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Awaiting blockchain confirmation. Funding is not complete until confirmed on-chain.</span>
                </div>
              )}

              {showSuccess && (
                <div className="mt-3 space-y-1 text-xs text-emerald-200/90">
                  <p>Escrow funding confirmed on-chain.</p>
                  {tx.transactionHash && (
                    <p className="break-all font-mono text-[11px] text-emerald-100/90">Tx: {tx.transactionHash}</p>
                  )}
                  {typeof tx.ledger === "number" && tx.ledger > 0 && <p>Ledger #{tx.ledger.toLocaleString()}</p>}
                  {explorerUrl && (
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 text-emerald-300 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> View on explorer
                    </a>
                  )}
                </div>
              )}

              {showFailure && (
                <div className="mt-3 space-y-1 text-xs">
                  <p className="text-destructive/90">
                    {tx.errorMessage || "The funding transaction could not be confirmed."}
                  </p>
                  <p className="text-muted-foreground">
                    Escrow status has not been marked as funded. Review the error and retry if needed.
                  </p>
                </div>
              )}

              {showCancelled && (
                <p className="mt-3 text-xs text-muted-foreground">
                  No blockchain funding confirmation was recorded.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-border bg-background text-primary focus:ring-primary"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
              disabled={isBusy || showSuccess}
            />
            <span className="text-sm text-foreground">
              I have reviewed the total contract value, milestone allocations, funded and remaining amounts,
              selected token, Stellar network, and estimated transaction fees. I understand fees are separate
              from escrow funds and funding is only complete after blockchain confirmation.
            </span>
          </label>
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isBusy}
            className="inline-flex items-center justify-center rounded-lg border border-border/60 bg-[#181824] px-4 py-2 text-sm font-medium text-foreground transition hover:bg-[#222232] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {showCancelled ? "Cancelled" : "Cancel"}
          </button>

          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            {!submission.allowed && !showSuccess && tx.status !== "pending" && submission.reason && (
              <p className="text-xs text-muted-foreground">{submission.reason}</p>
            )}
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={!submission.allowed || isBusy || !onConfirmFunding}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition",
                "bg-primary text-primary-foreground hover:opacity-90",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {isBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {tx.status === "pending" ? "Awaiting Confirmation…" : "Submitting…"}
                </>
              ) : showFailure ? (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Review & Retry Funding
                </>
              ) : (
                <>
                  <Wallet className="h-4 w-4" />
                  Continue to Final Confirmation
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <Dialog.Root open={confirmOpen} onOpenChange={(open) => !isBusy && setConfirmOpen(open)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
              "rounded-2xl border border-border/70 bg-[#0f0f16] shadow-2xl",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
              "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            )}
            onInteractOutside={(e) => isBusy && e.preventDefault()}
            onEscapeKeyDown={(e) => isBusy && e.preventDefault()}
          >
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-[#14141e] rounded-t-2xl">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <div>
                  <Dialog.Title className="text-sm font-semibold text-foreground">Final Funding Confirmation</Dialog.Title>
                  <p className="text-xs text-muted-foreground">
                    Confirm details before wallet signing and blockchain submission.
                  </p>
                </div>
              </div>
              {!isBusy && (
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg p-1.5 border border-border/60 hover:bg-[#1f1f2e] text-muted-foreground hover:text-foreground transition"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Dialog.Close>
              )}
            </div>

            <div className="space-y-4 p-5">
              <div className="rounded-xl border border-border/50 bg-[#12121b] p-4 text-sm">
                <SummaryRow label="Total contract value" value={formatTokenAmount(breakdown.totalContractValue, breakdown.token)} emphasis />
                <div className="border-t border-border/40" />
                <SummaryRow label="Funded amount" value={formatTokenAmount(displayFundedAmount, breakdown.token)} />
                <div className="border-t border-border/40" />
                <SummaryRow label="Remaining amount" value={formatTokenAmount(displayRemainingAmount, breakdown.token)} emphasis />
                <div className="border-t border-border/40" />
                <SummaryRow label="Selected token" value={breakdown.token.code} />
                <div className="border-t border-border/40" />
                <SummaryRow label="Stellar network" value={getNetworkDisplayName(breakdown.network)} />
                <div className="border-t border-border/40" />
                <SummaryRow label="Estimated transaction fee" value={formatFeeAmount(breakdown.estimatedTransactionFee)} />
              </div>

              <div className="rounded-xl border border-border/50 bg-[#12121b] p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Milestone allocations</p>
                <ul className="mt-2 space-y-2">
                  {breakdown.milestones.map((m, idx) => (
                    <li key={m.id || idx} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-foreground">{m.label || `Milestone ${idx + 1}`}</span>
                      <span className="font-medium text-foreground">{formatTokenAmount(m.amount, breakdown.token)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>
                  Funding will be marked successful only after blockchain confirmation. Estimated network fees are
                  separate from escrow-funded amounts.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-border/60 px-5 py-4 bg-[#14141e] rounded-b-2xl">
              {!isBusy && (
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg border border-border/60 bg-[#181824] px-4 py-2 text-sm font-medium hover:bg-[#222232] transition"
                  >
                    Back
                  </button>
                </Dialog.Close>
              )}
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isBusy}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
              >
                {isBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Confirm & Submit Funding
                  </>
                )}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

export default EscrowFundingReview;
