/**
 * Stellar Network Health Monitor
 * 
 * Monitors Horizon API connectivity and tracks network status
 * with automatic polling, outage detection, and recovery logging.
 */

import { Horizon } from "@stellar/stellar-sdk";
import { loadStellarConfig, isConfigured } from "@/lib/blockchain/stellar-config";
import { logBlockchainOperation } from "@/lib/blockchain/logger";

export type NetworkStatus = "healthy" | "degraded" | "unavailable";
function generateEventId(): string {
  return `outage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface HealthCheckResult {
  status: NetworkStatus;
  latencyMs: number;
  ledger: number;
  protocolVersion: number;
  horizonUrl: string;
  network: string;
  checkedAt: string;
  error?: string;
}

export interface OutageEvent {
  id: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: NetworkStatus;
  error?: string;
  recovered: boolean;
}

const DEFAULT_POLL_INTERVAL_MS = 30000; // 30 seconds
const HEALTHY_THRESHOLD_MS = 2000;
const DEGRADED_THRESHOLD_MS = 5000;

let currentStatus: NetworkStatus = "unavailable";
let lastCheck: HealthCheckResult | null = null;
let outageLog: OutageEvent[] = [];
let activeOutage: OutageEvent | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let listeners: Set<(result: HealthCheckResult) => void> = new Set();

function logOutage(event: OutageEvent, action: "started" | "ended" | "updated"): void {
  logBlockchainOperation(
    action === "started" ? "error" : action === "ended" ? "info" : "warn",
    `Network outage ${action}`,
    {
      outageId: event.id,
      status: event.status,
      durationMs: event.durationMs,
      error: event.error
        ? { type: "StellarNetworkError", message: event.error }
        : undefined,
    }
  );
}

/**
 * Performs a single health check against the Stellar Horizon API
 */
export async function checkHealth(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  const config = loadStellarConfig();

  if (!isConfigured() || !config) {
    const result: HealthCheckResult = {
      status: "unavailable",
      latencyMs: 0,
      ledger: 0,
      protocolVersion: 0,
      horizonUrl: process.env.STELLAR_HORIZON_URL || "unknown",
      network: (process.env.STELLAR_NETWORK as string) || "unknown",
      checkedAt: new Date().toISOString(),
      error: "Stellar configuration not available",
    };
    updateStatus(result);
    return result;
  }

  try {
    const server = new Horizon.Server(config.horizonUrl);
    const ledgerResponse = await server.ledgers().order("desc").limit(1).call();
    const latestLedger = ledgerResponse.records[0];

    const latencyMs = Date.now() - startTime;
    let status: NetworkStatus = "healthy";
    if (latencyMs > DEGRADED_THRESHOLD_MS) {
      status = "unavailable";
    } else if (latencyMs > HEALTHY_THRESHOLD_MS) {
      status = "degraded";
    }

    const result: HealthCheckResult = {
      status,
      latencyMs,
      ledger: latestLedger.sequence,
      protocolVersion: latestLedger.protocol_version,
      horizonUrl: config.horizonUrl,
      network: config.network,
      checkedAt: new Date().toISOString(),
    };

    updateStatus(result);
    return result;
  } catch (error: any) {
    const result: HealthCheckResult = {
      status: "unavailable",
      latencyMs: Date.now() - startTime,
      ledger: 0,
      protocolVersion: 0,
      horizonUrl: config.horizonUrl,
      network: config.network,
      checkedAt: new Date().toISOString(),
      error: error.message || "Unknown error",
    };

    updateStatus(result);
    return result;
  }
}

/**
 * Updates internal status and manages outage logging
 */
function updateStatus(result: HealthCheckResult): void {
  const previousStatus = currentStatus;
  currentStatus = result.status;
  lastCheck = result;

  // Notify listeners
  listeners.forEach((cb) => {
    try {
      cb(result);
    } catch (e) {
      // Silently ignore listener errors
    }
  });

  // Outage detection
  if (result.status === "unavailable" && previousStatus !== "unavailable") {
    // Outage started
    activeOutage = {
      id: generateEventId(),
      startedAt: result.checkedAt,
      status: result.status,
      error: result.error,
      recovered: false,
    };
    outageLog.push(activeOutage);
    logOutage(activeOutage, "started");
  } else if (result.status !== "unavailable" && previousStatus === "unavailable" && activeOutage) {
    // Outage ended
    const endedAt = new Date().toISOString();
    const durationMs = new Date(endedAt).getTime() - new Date(activeOutage.startedAt).getTime();
    activeOutage.endedAt = endedAt;
    activeOutage.durationMs = durationMs;
    activeOutage.recovered = true;
    logOutage(activeOutage, "ended");
    activeOutage = null;
  }
}

/**
 * Starts automatic health monitoring with polling
 */
export function startMonitoring(intervalMs = DEFAULT_POLL_INTERVAL_MS): void {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  // Immediate first check
  checkHealth();

  pollTimer = setInterval(() => {
    checkHealth().catch((err) => {
      console.error("[HealthMonitor] Polling error:", err);
    });
  }, intervalMs);

  logBlockchainOperation("info", "Stellar health monitoring started", {
    intervalMs,
    horizonUrl: process.env.STELLAR_HORIZON_URL,
  });
}

/**
 * Stops automatic health monitoring
 */
export function stopMonitoring(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  logBlockchainOperation("info", "Stellar health monitoring stopped", {});
}

/**
 * Subscribes to health check updates
 * @returns Unsubscribe function
 */
export function subscribe(callback: (result: HealthCheckResult) => void): () => void {
  listeners.add(callback);
  // Immediately send current state if available
  if (lastCheck) {
    callback(lastCheck);
  }
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Gets the current health status
 */
export function getCurrentStatus(): HealthCheckResult | null {
  return lastCheck;
}

/**
 * Gets the current network status
 */
export function getNetworkStatus(): NetworkStatus {
  return currentStatus;
}

/**
 * Gets outage history
 */
export function getOutageLog(): OutageEvent[] {
  return [...outageLog];
}

/**
 * Gets the currently active outage (if any)
 */
export function getActiveOutage(): OutageEvent | null {
  return activeOutage;
}

/**
 * Clears outage history (useful for testing)
 */
export function clearOutageLog(): void {
  outageLog = [];
  activeOutage = null;
}
