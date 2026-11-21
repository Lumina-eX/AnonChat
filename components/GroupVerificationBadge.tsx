"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getVerificationBadgeState } from "@/lib/blockchain/group-verification";
import type { VerificationResponse } from "@/types/blockchain";

interface GroupVerificationBadgeProps {
  groupId: string;
  className?: string;
  showLabel?: boolean;
}

export function GroupVerificationBadge({
  groupId,
  className,
  showLabel = true,
}: GroupVerificationBadgeProps) {
  const [response, setResponse] = useState<VerificationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadVerification() {
      setLoading(true);
      setFetchError(null);

      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(groupId)}/verify`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || data.error || "Verification check failed");
        }

        if (!cancelled) {
          setResponse(data);
        }
      } catch (error) {
        if (!cancelled) {
          setFetchError(
            error instanceof Error ? error.message : "Verification check failed",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (groupId) {
      loadVerification();
    }

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const state = getVerificationBadgeState(response, loading, fetchError);

  if (state.status === "loading") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[10px] text-muted-foreground",
          className,
        )}
        aria-label="Checking verification status"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        {showLabel ? <span>Checking…</span> : null}
      </span>
    );
  }

  if (state.status === "error") {
    return null;
  }

  if (state.status !== "verified") {
    return null;
  }

  const badge = (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-500 text-[10px] font-medium border border-sky-500/20",
        className,
      )}
      aria-label="On-chain verified group"
      title={
        state.explorerUrl
          ? "Verified on Stellar blockchain — view transaction"
          : "Verified on Stellar blockchain"
      }
    >
      <BadgeCheck className="h-2.5 w-2.5" />
      {showLabel ? <span>Verified</span> : null}
    </span>
  );

  if (state.explorerUrl) {
    return (
      <a
        href={state.explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex"
      >
        {badge}
      </a>
    );
  }

  return badge;
}
