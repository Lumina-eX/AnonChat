/**
 * StellarNetworkStatus
 *
 * A responsive UI component that displays the current Stellar network
 * health status. Auto-refreshes via SSE for real-time updates.
 *
 * Usage:
 *   <StellarNetworkStatus />           // Default inline badge
 *   <StellarNetworkStatus variant="banner" />  // Full banner for chat page
 *   <StellarNetworkStatus variant="compact" /> // Minimal dot indicator
 */

"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Activity,
  AlertTriangle,
  Wifi,
  WifiOff,
  RefreshCw,
  Clock,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NetworkStatus = "healthy" | "degraded" | "unavailable";

interface HealthData {
  status: NetworkStatus;
  latencyMs: number;
  ledger: number;
  protocolVersion: number;
  network: string;
  checkedAt: string;
  error?: string;
  outage?: {
    id: string;
    startedAt: string;
    status: NetworkStatus;
    error?: string;
  } | null;
}

interface StellarNetworkStatusProps {
  variant?: "badge" | "banner" | "compact";
  className?: string;
  showDetails?: boolean;
}

const STATUS_CONFIG: Record<
  NetworkStatus,
  {
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    icon: React.ReactNode;
    pulseColor: string;
  }
> = {
  healthy: {
    label: "Stellar Network Healthy",
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
    icon: <Wifi className="w-4 h-4" />,
    pulseColor: "bg-emerald-500",
  },
  degraded: {
    label: "Stellar Network Degraded",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
    icon: <AlertTriangle className="w-4 h-4" />,
    pulseColor: "bg-amber-500",
  },
  unavailable: {
    label: "Stellar Network Unavailable",
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
    icon: <WifiOff className="w-4 h-4" />,
    pulseColor: "bg-red-500",
  },
};

export function StellarNetworkStatus({
  variant = "badge",
  className,
  showDetails = false,
}: StellarNetworkStatusProps) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const fetchHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/stellar/health");
      if (!response.ok) throw new Error("Failed to fetch health status");
      const data = await response.json();
      setHealth(data);
      setLastUpdated(new Date());
      setRetryCount(0);
    } catch (err) {
      setHealth({
        status: "unavailable",
        latencyMs: 0,
        ledger: 0,
        protocolVersion: 0,
        network: "unknown",
        checkedAt: new Date().toISOString(),
        error: "Unable to reach health monitor",
      });
      setRetryCount((c) => c + 1);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // SSE for real-time updates
  useEffect(() => {
    fetchHealth();

    const eventSource = new EventSource("/api/stellar/health");
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "health_update") {
          setHealth(data);
          setLastUpdated(new Date());
          setRetryCount(0);
        }
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      // Fallback to polling if SSE fails
      eventSource.close();
      const interval = setInterval(fetchHealth, 30000);
      return () => clearInterval(interval);
    };

    return () => {
      eventSource.close();
    };
  }, [fetchHealth]);

  // Manual retry with exponential backoff
  const handleRetry = useCallback(() => {
    setIsLoading(true);
    fetchHealth();
  }, [fetchHealth]);

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-xs text-muted-foreground animate-pulse",
          className
        )}
      >
        <RefreshCw className="w-3 h-3 animate-spin" />
        Checking network...
      </div>
    );
  }

  if (!health) return null;

  const config = STATUS_CONFIG[health.status];

  // Compact variant — just a colored dot with tooltip
  if (variant === "compact") {
    return (
      <div
        className={cn("group relative inline-flex items-center", className)}
        title={config.label}
      >
        <span
          className={cn(
            "relative flex h-2.5 w-2.5",
            health.status === "healthy" && "cursor-default"
          )}
        >
          <span
            className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
              config.pulseColor
            )}
          />
          <span
            className={cn(
              "relative inline-flex rounded-full h-2.5 w-2.5",
              config.pulseColor
            )}
          />
        </span>
        {/* Tooltip */}
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border shadow-sm">
          {config.label}
          {health.latencyMs > 0 && ` • ${health.latencyMs}ms`}
        </div>
      </div>
    );
  }

  // Banner variant — full width alert for chat page
  if (variant === "banner") {
    if (health.status === "healthy" && !showDetails) return null;

    return (
      <div
        className={cn(
          "w-full px-4 py-3 border-b",
          config.bgColor,
          config.borderColor,
          className
        )}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={cn("flex-shrink-0", config.color)}>
              {config.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn("text-sm font-medium", config.color)}>
                {config.label}
              </p>
              {health.error && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {health.error}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 flex-shrink-0">
            {health.status !== "healthy" && (
              <button
                onClick={handleRetry}
                disabled={isLoading}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={cn("w-3 h-3", isLoading && "animate-spin")}
                />
                Retry
              </button>
            )}

            {showDetails && health.status === "healthy" && (
              <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {health.latencyMs}ms
                </span>
                <span className="flex items-center gap-1">
                  <Database className="w-3 h-3" />
                  Ledger #{health.ledger}
                </span>
              </div>
            )}

            {lastUpdated && (
              <span className="text-xs text-muted-foreground hidden md:inline">
                {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Default badge variant
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium",
        config.bgColor,
        config.borderColor,
        config.color,
        className
      )}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={cn(
            "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
            config.pulseColor
          )}
        />
        <span
          className={cn(
            "relative inline-flex rounded-full h-2 w-2",
            config.pulseColor
          )}
        />
      </span>
      <span className="hidden sm:inline">{config.label}</span>
      <span className="sm:hidden">
        {health.status === "healthy"
          ? "Online"
          : health.status === "degraded"
          ? "Slow"
          : "Offline"}
      </span>
      {showDetails && health.latencyMs > 0 && (
        <span className="text-muted-foreground font-normal">
          {health.latencyMs}ms
        </span>
      )}
    </div>
  );
}