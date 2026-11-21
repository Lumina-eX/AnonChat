"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";

interface BlockchainAttempt {
  id: string;
  submissionType: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  lastErrorType: string | null;
  nextRetryAt: string | null;
  createdAt: string;
}

interface BlockchainStatusBadgeProps {
  groupId: string;
  stellarTxHash: string | null;
  blockchainSubmittedAt: string | null;
  memoGroupId: string | null;
  onRetrySuccess?: () => void;
}

export function BlockchainStatusBadge({
  groupId,
  stellarTxHash,
  blockchainSubmittedAt,
  onRetrySuccess,
}: BlockchainStatusBadgeProps) {
  const [attempts, setAttempts] = useState<BlockchainAttempt[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchRetryableAttempts = useCallback(async () => {
    if (stellarTxHash && blockchainSubmittedAt) return; // Already submitted

    setLoading(true);
    try {
      const res = await fetch(`/api/stellar/transactions/retry/${groupId}`);
      if (res.ok) {
        const data = await res.json();
        setAttempts(data.retryableAttempts || []);
      }
    } catch (error) {
      console.error("Failed to fetch retryable attempts:", error);
    } finally {
      setLoading(false);
    }
  }, [groupId, stellarTxHash, blockchainSubmittedAt]);

  useEffect(() => {
    fetchRetryableAttempts();
  }, [fetchRetryableAttempts]);

  const handleRetry = async (attemptId: string) => {
    setRetrying(attemptId);
    try {
      const res = await fetch(`/api/stellar/transactions/retry/${groupId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success("Transaction submitted successfully!");
        setAttempts([]);
        onRetrySuccess?.();
      } else {
        toast.error(`Retry failed: ${data.error}`);
        // Refresh attempts
        fetchRetryableAttempts();
      }
    } catch (error: any) {
      toast.error(`Retry failed: ${error.message}`);
      fetchRetryableAttempts();
    } finally {
      setRetrying(null);
    }
  };

  // Successfully submitted
  if (stellarTxHash && blockchainSubmittedAt) {
    return (
      <div className="flex items-center gap-1.5 text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">Anchored</span>
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${stellarTxHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-400/70 hover:text-emerald-400"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  // Has retryable attempts
  const failedAttempts = attempts.filter((a) => a.status === "failed" && a.attemptCount < a.maxAttempts);
  const pendingAttempts = attempts.filter((a) => a.status === "pending");

  if (failedAttempts.length > 0 || pendingAttempts.length > 0) {
    return (
      <div className="relative">
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition",
            "bg-destructive/10 text-destructive hover:bg-destructive/20"
          )}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          <span>
            {pendingAttempts.length > 0
              ? "Submitting..."
              : `Failed (${failedAttempts[0]?.attemptCount}/${failedAttempts[0]?.maxAttempts} attempts)`}
          </span>
        </button>

        {expanded && (
          <div className="absolute top-full left-0 mt-1 z-50 w-72 rounded-xl border border-border/60 bg-card shadow-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Blockchain Submission</span>
              <button
                onClick={fetchRetryableAttempts}
                disabled={loading}
                className="p-1 rounded hover:bg-muted transition"
              >
                <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-2">
                {attempts.map((attempt) => (
                  <div
                    key={attempt.id}
                    className={cn(
                      "rounded-lg border p-2 text-xs",
                      attempt.status === "failed"
                        ? "border-destructive/30 bg-destructive/5"
                        : "border-amber-500/30 bg-amber-500/5"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium capitalize">
                        {attempt.submissionType.replace("_", " ")}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                          attempt.status === "failed"
                            ? "bg-destructive/20 text-destructive"
                            : "bg-amber-500/20 text-amber-300"
                        )}
                      >
                        {attempt.status}
                      </span>
                    </div>

                    {attempt.lastError && (
                      <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                        {attempt.lastError}
                      </p>
                    )}

                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        Attempt {attempt.attemptCount}/{attempt.maxAttempts}
                      </span>

                      {attempt.status === "failed" && attempt.attemptCount < attempt.maxAttempts && (
                        <button
                          onClick={() => handleRetry(attempt.id)}
                          disabled={retrying === attempt.id}
                          className="inline-flex items-center gap-1 rounded bg-primary/20 hover:bg-primary/30 px-2 py-0.5 text-[10px] font-medium text-primary transition disabled:opacity-50"
                        >
                          {retrying === attempt.id ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-2.5 w-2.5" />
                          )}
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {attempts.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    No pending or failed submissions
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="text-xs">Checking...</span>
      </div>
    );
  }

  // Not submitted
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <Clock className="h-3.5 w-3.5" />
      <span className="text-xs">Pending</span>
    </div>
  );
}
