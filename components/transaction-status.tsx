"use client";

import { ExternalLink, Loader2, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TransactionState,
  TRANSACTION_STATE_LABELS,
  TRANSACTION_STATE_TONES,
} from "@/lib/blockchain/transaction-state-machine";

interface TransactionStatusProps {
  state: TransactionState;
  transactionHash?: string;
  explorerUrl?: string;
  error?: string;
  retryCount?: number;
  onRetry?: () => void;
  className?: string;
}

const TONE_CLASSES: Record<string, string> = {
  neutral: "bg-muted/40 text-muted-foreground border-border/60",
  warning: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  info: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  danger: "bg-destructive/20 text-destructive border-destructive/30",
};

const SPINNER_STATES: ReadonlySet<TransactionState> = new Set([
  "preparing",
  "awaiting_wallet_approval",
  "submitted",
  "confirming",
]);

function displayHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

/**
 * Reusable, responsive transaction status indicator that reflects every
 * state of the Stellar transaction confirmation flow with clear visual
 * indicators. Consistent across desktop and mobile.
 */
export function TransactionStatus({
  state,
  transactionHash,
  explorerUrl,
  error,
  retryCount,
  onRetry,
  className,
}: TransactionStatusProps) {
  const tone = TRANSACTION_STATE_TONES[state];
  const label = TRANSACTION_STATE_LABELS[state];
  const isSpinning = SPINNER_STATES.has(state);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Transaction status: ${label}`}
      className={cn(
        "flex flex-col gap-2 rounded-xl border px-3 py-2.5 text-sm",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {isSpinning ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : state === "confirmed" ? (
          <CheckCircle2 className="h-4 w-4 shrink-0" />
        ) : state === "failed" ? (
          <XCircle className="h-4 w-4 shrink-0" />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full bg-current" />
        )}
        <span className="font-medium">{label}</span>
        {typeof retryCount === "number" && retryCount > 0 && (
          <span className="ml-auto text-xs opacity-70">
            Retry {retryCount}
          </span>
        )}
      </div>

      {transactionHash && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="opacity-70">Tx:</span>
          {explorerUrl ? (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono underline-offset-2 hover:underline"
            >
              {displayHash(transactionHash)}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="font-mono">{displayHash(transactionHash)}</span>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs opacity-90">{error}</p>
      )}

      {state === "failed" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg border border-current/30 bg-background/40 px-2.5 py-1 text-xs font-medium transition hover:bg-background/60"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  );
}
