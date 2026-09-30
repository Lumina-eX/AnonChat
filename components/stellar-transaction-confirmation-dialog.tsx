"use client";

/**
 * StellarTransactionConfirmationDialog
 *
 * Displays the real-time transaction confirmation flow for Stellar blockchain
 * operations. Shows each state with clear visual indicators, the transaction
 * hash with a copy button, a link to the explorer, and a retry option on failure.
 *
 * Designed to be consistent on both desktop and mobile.
 */

import React, { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  X,
  Wallet,
  Send,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TransactionConfirmationContext, TransactionConfirmationState } from "@/types/blockchain";
import { TRANSACTION_STATE_LABELS } from "@/types/blockchain";
import { getStateProgress, isActiveState } from "@/lib/blockchain/transaction-state-machine";

// ── Icons per state ──────────────────────────────────────────────────────────

function StateIcon({
  state,
  className,
}: {
  state: TransactionConfirmationState;
  className?: string;
}) {
  const base = cn("h-6 w-6 shrink-0", className);

  switch (state) {
    case "preparing":
      return <Loader2 className={cn(base, "animate-spin text-primary")} />;
    case "awaiting_wallet":
      return <Wallet className={cn(base, "text-amber-400 animate-pulse")} />;
    case "submitted":
      return <Send className={cn(base, "text-blue-400")} />;
    case "confirming":
      return <Loader2 className={cn(base, "animate-spin text-sky-400")} />;
    case "confirmed":
      return <CheckCircle2 className={cn(base, "text-emerald-400")} />;
    case "failed":
      return <XCircle className={cn(base, "text-destructive")} />;
    default:
      return <Clock className={cn(base, "text-muted-foreground")} />;
  }
}

// ── Step indicators ──────────────────────────────────────────────────────────

const STEPS: { state: TransactionConfirmationState; label: string }[] = [
  { state: "preparing", label: "Prepare" },
  { state: "awaiting_wallet", label: "Approve" },
  { state: "submitted", label: "Submit" },
  { state: "confirming", label: "Confirm" },
  { state: "confirmed", label: "Done" },
];

const STATE_ORDER: TransactionConfirmationState[] = [
  "preparing",
  "awaiting_wallet",
  "submitted",
  "confirming",
  "confirmed",
];

function getStepStatus(
  step: TransactionConfirmationState,
  current: TransactionConfirmationState,
): "completed" | "active" | "pending" | "failed" {
  if (current === "failed") {
    const stepIdx = STATE_ORDER.indexOf(step);
    const currentIdx = STATE_ORDER.indexOf("confirmed");
    // Only mark as completed what was passed before failure
    return stepIdx < currentIdx ? "pending" : "failed";
  }
  const stepIdx = STATE_ORDER.indexOf(step);
  const currentIdx = STATE_ORDER.indexOf(current);
  if (stepIdx < currentIdx) return "completed";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

function StepIndicators({ state }: { state: TransactionConfirmationState }) {
  return (
    <div className="flex items-center justify-between px-1" role="list" aria-label="Transaction progress steps">
      {STEPS.map((step, idx) => {
        const status = getStepStatus(step.state, state);
        const isLast = idx === STEPS.length - 1;

        return (
          <React.Fragment key={step.state}>
            <div
              role="listitem"
              aria-label={`${step.label}: ${status}`}
              className="flex flex-col items-center gap-1.5"
            >
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-300",
                  status === "completed" &&
                    "border-emerald-500 bg-emerald-500/20 text-emerald-400",
                  status === "active" &&
                    state !== "failed" &&
                    "border-primary bg-primary/20 text-primary",
                  status === "pending" && "border-border/50 bg-muted/20 text-muted-foreground",
                  status === "failed" && "border-destructive/50 bg-destructive/10 text-destructive",
                )}
              >
                {status === "completed" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : status === "active" && state !== "failed" ? (
                  isActiveState(state) ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span className="text-[10px] font-bold">{idx + 1}</span>
                  )
                ) : (
                  <span className="text-[10px] font-medium">{idx + 1}</span>
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium",
                  status === "completed" && "text-emerald-400",
                  status === "active" && state !== "failed" && "text-primary",
                  status === "pending" && "text-muted-foreground/60",
                  status === "failed" && "text-muted-foreground/60",
                )}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div
                aria-hidden
                className={cn(
                  "flex-1 h-px mx-1 mt-[-12px] transition-all duration-500",
                  STATUS_LINE_COLOR(step.state, state),
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function STATUS_LINE_COLOR(
  step: TransactionConfirmationState,
  current: TransactionConfirmationState,
): string {
  const stepIdx = STATE_ORDER.indexOf(step);
  const currentIdx = STATE_ORDER.indexOf(current === "failed" ? "preparing" : current);
  if (stepIdx < currentIdx) return "bg-emerald-500/50";
  return "bg-border/40";
}

// ── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ progress, state }: { progress: number; state: TransactionConfirmationState }) {
  return (
    <div
      className="h-1.5 w-full rounded-full bg-muted/30 overflow-hidden"
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Transaction progress: ${progress}%`}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all duration-700 ease-out",
          state === "confirmed" && "bg-emerald-500",
          state === "failed" && "bg-destructive/60",
          state !== "confirmed" && state !== "failed" && "bg-primary",
        )}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

// ── Transaction hash display ─────────────────────────────────────────────────

function TransactionHashDisplay({
  hash,
  explorerUrl,
}: {
  hash: string;
  explorerUrl?: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [hash]);

  return (
    <div className="rounded-xl border border-border/50 bg-[#0f0f18] p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Transaction Hash
      </p>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-foreground/80 break-all flex-1 leading-relaxed">
          {hash}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-md p-1.5 hover:bg-muted/30 text-muted-foreground hover:text-foreground transition"
          aria-label="Copy transaction hash"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
        >
          <ExternalLink className="h-3 w-3" />
          View on StellarExpert
        </a>
      )}
    </div>
  );
}

// ── Error details ─────────────────────────────────────────────────────────────

function ErrorDetails({
  errorMessage,
  retryable,
  retryCount,
  maxRetries,
  onRetry,
  retrying,
}: {
  errorMessage: string;
  retryable: boolean;
  retryCount: number;
  maxRetries: number;
  onRetry: () => void;
  retrying: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const remainingRetries = maxRetries - retryCount;

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-destructive">Transaction Failed</p>
          <p className="text-xs text-muted-foreground mt-0.5 break-words">
            {errorMessage}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition"
          aria-label={expanded ? "Collapse details" : "Expand details"}
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="text-xs text-muted-foreground space-y-1 bg-[#0f0f18] rounded-lg px-3 py-2 border border-border/40">
          <p>Retry count: {retryCount} / {maxRetries}</p>
          {retryable && <p>Retries remaining: {remainingRetries}</p>}
          {!retryable && <p className="text-destructive/80">This error is not retryable.</p>}
        </div>
      )}

      {retryable && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2",
            "bg-destructive/20 hover:bg-destructive/30 border border-destructive/30",
            "text-sm font-medium text-destructive transition disabled:opacity-50 disabled:cursor-not-allowed",
          )}
          aria-live="polite"
        >
          {retrying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Retrying…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              Retry Transaction
              {remainingRetries > 0 && (
                <span className="text-xs opacity-70">({remainingRetries} left)</span>
              )}
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ── Confirmed details ─────────────────────────────────────────────────────────

function ConfirmedDetails({
  context,
}: {
  context: TransactionConfirmationContext;
}) {
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-emerald-300">
            Transaction Confirmed
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Successfully included in the Stellar ledger.
          </p>
        </div>
      </div>

      {context.ledger != null && context.ledger > 0 && (
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-emerald-400/70" />
            <span>Ledger #{context.ledger.toLocaleString()}</span>
          </div>
          {context.feeCharged && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/70">Fee:</span>
              <span>{(parseInt(context.feeCharged, 10) / 10_000_000).toFixed(7)} XLM</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Dialog Component ─────────────────────────────────────────────────────

export interface StellarTransactionConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: TransactionConfirmationContext;
  onRetry?: () => Promise<void>;
  /** Whether a retry is currently in progress */
  retrying?: boolean;
  /** Allow closing while the transaction is in progress */
  dismissible?: boolean;
}

export function StellarTransactionConfirmationDialog({
  open,
  onOpenChange,
  context,
  onRetry,
  retrying = false,
  dismissible = false,
}: StellarTransactionConfirmationDialogProps) {
  const { state, transactionHash, explorerUrl, errorMessage, retryable, retryCount, maxRetries } =
    context;

  const { label, description } = TRANSACTION_STATE_LABELS[state];
  const progress = getStateProgress(state);
  const isActive = isActiveState(state);
  const canClose = dismissible || !isActive;

  // Prevent backdrop-click/escape from closing while active
  const handleInteractOutside = useCallback(
    (e: Event) => {
      if (!canClose) e.preventDefault();
    },
    [canClose],
  );

  const handleEscapeKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!canClose) e.preventDefault();
    },
    [canClose],
  );

  return (
    <Dialog.Root open={open} onOpenChange={canClose ? onOpenChange : undefined}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <Dialog.Content
          onInteractOutside={handleInteractOutside}
          onEscapeKeyDown={handleEscapeKeyDown}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md",
            "-translate-x-1/2 -translate-y-1/2",
            "rounded-2xl border border-border/70 bg-[#0f0f16] shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
          aria-describedby="tx-confirmation-description"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-[#14141e] rounded-t-2xl">
            <div className="flex items-center gap-3">
              <StateIcon state={state} className="h-5 w-5" />
              <div>
                <Dialog.Title className="text-sm font-semibold text-foreground">
                  {context.operationLabel ?? "Stellar Transaction"}
                </Dialog.Title>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {context.transactionType === "metadata_hash"
                    ? "Group metadata anchoring"
                    : context.transactionType === "audit_event"
                      ? "Audit event recording"
                      : "Blockchain operation"}
                </p>
              </div>
            </div>

            {canClose && (
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg p-1.5 border border-border/60 hover:bg-[#1f1f2e] text-muted-foreground hover:text-foreground transition"
                  aria-label="Close dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            )}
          </div>

          {/* Body */}
          <div className="p-5 space-y-5">
            {/* Step indicators */}
            <StepIndicators state={state} />

            {/* Progress bar */}
            <ProgressBar progress={progress} state={state} />

            {/* Current state description */}
            <div
              id="tx-confirmation-description"
              className={cn(
                "rounded-xl px-4 py-3.5 text-center transition-all",
                state === "confirmed"
                  ? "bg-emerald-500/10 border border-emerald-500/20"
                  : state === "failed"
                    ? "bg-destructive/10 border border-destructive/20"
                    : state === "awaiting_wallet"
                      ? "bg-amber-500/10 border border-amber-500/20"
                      : "bg-primary/5 border border-primary/20",
              )}
              aria-live="polite"
              aria-atomic="true"
            >
              <p
                className={cn(
                  "text-sm font-semibold",
                  state === "confirmed" && "text-emerald-300",
                  state === "failed" && "text-destructive",
                  state === "awaiting_wallet" && "text-amber-300",
                  state !== "confirmed" &&
                    state !== "failed" &&
                    state !== "awaiting_wallet" &&
                    "text-foreground",
                )}
              >
                {label}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            </div>

            {/* Awaiting wallet callout */}
            {state === "awaiting_wallet" && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
                <Wallet className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-300">Action Required</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Open your wallet extension and approve the transaction to continue.
                  </p>
                </div>
              </div>
            )}

            {/* Transaction hash (visible after submission) */}
            {transactionHash && (
              <TransactionHashDisplay
                hash={transactionHash}
                explorerUrl={explorerUrl}
              />
            )}

            {/* Confirmed details */}
            {state === "confirmed" && <ConfirmedDetails context={context} />}

            {/* Error details with retry */}
            {state === "failed" && errorMessage && (
              <ErrorDetails
                errorMessage={errorMessage}
                retryable={retryable}
                retryCount={retryCount}
                maxRetries={maxRetries}
                onRetry={onRetry ?? (() => {})}
                retrying={retrying}
              />
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border/60 px-5 py-3 bg-[#14141e] rounded-b-2xl flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {retryCount > 0 && (
                <span>
                  Attempt {retryCount + 1} / {maxRetries + 1}
                </span>
              )}
            </div>

            {canClose && (
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg border border-border/60 bg-[#181824] px-4 py-1.5 text-xs font-medium hover:bg-[#222232] transition"
                >
                  {state === "confirmed" ? "Done" : state === "failed" ? "Dismiss" : "Close"}
                </button>
              </Dialog.Close>
            )}

            {!canClose && isActive && (
              <span className="text-xs text-muted-foreground italic">
                Please wait…
              </span>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
