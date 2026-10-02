"use client";

/**
 * StellarTransactionStatusBadge
 *
 * A compact inline badge that displays the current transaction confirmation
 * state with appropriate colour coding. Suitable for embedding in tables,
 * lists, and card headers.
 */

import React from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Wallet,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TransactionConfirmationState } from "@/types/blockchain";
import { TRANSACTION_STATE_LABELS } from "@/types/blockchain";

interface StellarTransactionStatusBadgeProps {
  state: TransactionConfirmationState;
  /** Show a text label alongside the icon */
  showLabel?: boolean;
  className?: string;
  size?: "sm" | "md";
}

export function StellarTransactionStatusBadge({
  state,
  showLabel = true,
  className,
  size = "md",
}: StellarTransactionStatusBadgeProps) {
  const { label } = TRANSACTION_STATE_LABELS[state];
  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";
  const textSize = size === "sm" ? "text-[10px]" : "text-xs";

  const config: Record<
    TransactionConfirmationState,
    {
      icon: React.ReactNode;
      containerClass: string;
      textClass: string;
    }
  > = {
    preparing: {
      icon: <Loader2 className={cn(iconSize, "animate-spin")} />,
      containerClass: "bg-primary/15 border-primary/30 text-primary",
      textClass: "text-primary",
    },
    awaiting_wallet: {
      icon: <Wallet className={iconSize} />,
      containerClass: "bg-amber-500/15 border-amber-500/30 text-amber-400",
      textClass: "text-amber-400",
    },
    submitted: {
      icon: <Send className={iconSize} />,
      containerClass: "bg-blue-500/15 border-blue-500/30 text-blue-400",
      textClass: "text-blue-400",
    },
    confirming: {
      icon: <Loader2 className={cn(iconSize, "animate-spin")} />,
      containerClass: "bg-sky-500/15 border-sky-500/30 text-sky-400",
      textClass: "text-sky-400",
    },
    confirmed: {
      icon: <CheckCircle2 className={iconSize} />,
      containerClass: "bg-emerald-500/15 border-emerald-500/30 text-emerald-400",
      textClass: "text-emerald-400",
    },
    failed: {
      icon: <XCircle className={iconSize} />,
      containerClass: "bg-destructive/15 border-destructive/30 text-destructive",
      textClass: "text-destructive",
    },
  };

  const { icon, containerClass, textClass } = config[state] ?? {
    icon: <Clock className={iconSize} />,
    containerClass: "bg-muted/20 border-border/40 text-muted-foreground",
    textClass: "text-muted-foreground",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium",
        containerClass,
        textClass,
        textSize,
        className,
      )}
      aria-label={`Transaction state: ${label}`}
    >
      {icon}
      {showLabel && <span>{label}</span>}
    </span>
  );
}
