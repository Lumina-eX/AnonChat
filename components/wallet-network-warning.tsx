"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  detectWalletNetwork,
  getExpectedNetwork,
  getPublicKey,
} from "@/app/stellar-wallet-kit";
import type { DetectedNetwork } from "@/app/stellar-wallet-kit";

interface WalletNetworkWarningProps {
  variant?: "banner" | "badge" | "inline";
  className?: string;
}

export function WalletNetworkWarning({
  variant = "inline",
  className,
}: WalletNetworkWarningProps) {
  const [walletNetwork, setWalletNetwork] = useState<DetectedNetwork | null>(null);
  const [expected, setExpected] = useState<DetectedNetwork>("mainnet");
  const [checking, setChecking] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isMismatch = walletNetwork !== null && walletNetwork !== "unknown" && walletNetwork !== expected;

  const checkNetwork = useCallback(async () => {
    const pk = await getPublicKey();
    setIsConnected(!!pk);

    if (!pk) {
      setWalletNetwork(null);
      setChecking(false);
      return;
    }

    const detected = await detectWalletNetwork();
    setWalletNetwork(detected);
    setExpected(getExpectedNetwork());
    setChecking(false);

    if (detected !== "unknown" && detected === getExpectedNetwork()) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    checkNetwork();
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [checkNetwork]);

  useEffect(() => {
    if (isMismatch && !pollingRef.current) {
      pollingRef.current = setInterval(async () => {
        const detected = await detectWalletNetwork();
        setWalletNetwork(detected);
        if (detected !== "unknown" && detected === getExpectedNetwork()) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          window.location.reload();
        }
      }, 2000);
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isMismatch]);

  if (checking || !isConnected || walletNetwork === null || walletNetwork === "unknown") {
    return null;
  }

  if (!isMismatch) return null;

  const expectedLabel = expected === "testnet" ? "Testnet" : "Mainnet";
  const walletLabel = walletNetwork === "testnet" ? "Testnet" : "Mainnet";

  if (variant === "badge") {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
          className
        )}
        title={`Switch wallet to ${expectedLabel}`}
      >
        <AlertTriangle className="w-3 h-3" />
        <span>Wrong network</span>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
          className
        )}
      >
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="text-xs">
          Wallet on <strong>{walletLabel}</strong> &middot; switch to <strong>{expectedLabel}</strong>
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-full px-4 py-3 border-b bg-amber-500/10 border-amber-500/20",
        className
      )}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
              Wrong Stellar Network Detected
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Your wallet is connected to <strong>{walletLabel}</strong> but this app requires{" "}
              <strong>{expectedLabel}</strong>. Please switch networks in your wallet extension.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Auto-detecting...
          </span>
        </div>
      </div>
    </div>
  );
}
