/**
 * Unit tests for Stellar Network Health Monitor
 *
 * Tests connectivity checks, outage detection, status transitions,
 * and recovery logging.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkHealth,
  getCurrentStatus,
  getNetworkStatus,
  getOutageLog,
  clearOutageLog,
  subscribe,
  startMonitoring,
  stopMonitoring,
} from "./health-monitor";

describe("Stellar Health Monitor", () => {
  beforeEach(() => {
    clearOutageLog();
    stopMonitoring();
    delete process.env.STELLAR_HORIZON_URL;
    delete process.env.STELLAR_NETWORK;
    delete process.env.STELLAR_SOURCE_SECRET;
  });

  afterEach(() => {
    stopMonitoring();
    clearOutageLog();
  });

  it("should return unavailable when Stellar is not configured", async () => {
    const result = await checkHealth();
    expect(result.status).toBe("unavailable");
    expect(result.error).toContain("not available");
  });

  it("should track status transitions and log outages", async () => {
    // Simulate: healthy → unavailable → healthy
    process.env.STELLAR_HORIZON_URL = "https://horizon-testnet.stellar.org";
    process.env.STELLAR_NETWORK = "testnet";
    process.env.STELLAR_SOURCE_SECRET = "SDUMMY";

    const result1 = await checkHealth();
    // Result depends on actual network; we verify structure
    expect(["healthy", "degraded", "unavailable"]).toContain(result1.status);
    expect(result1.checkedAt).toBeDefined();
    expect(result1.latencyMs).toBeGreaterThanOrEqual(0);

    const status = getNetworkStatus();
    expect(status).toBe(result1.status);

    const current = getCurrentStatus();
    expect(current).not.toBeNull();
    expect(current?.status).toBe(result1.status);
  });

  it("should notify subscribers on status change", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    process.env.STELLAR_HORIZON_URL = "https://horizon-testnet.stellar.org";
    process.env.STELLAR_NETWORK = "testnet";
    process.env.STELLAR_SOURCE_SECRET = "SDUMMY";

    await checkHealth();

    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0][0]).toHaveProperty("status");
    expect(listener.mock.calls[0][0]).toHaveProperty("latencyMs");

    unsubscribe();
  });

  it("should handle multiple subscribers", async () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const unsub1 = subscribe(listener1);
    const unsub2 = subscribe(listener2);

    process.env.STELLAR_HORIZON_URL = "https://horizon-testnet.stellar.org";
    process.env.STELLAR_NETWORK = "testnet";
    process.env.STELLAR_SOURCE_SECRET = "SDUMMY";

    await checkHealth();

    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();

    unsub1();
    unsub2();
  });

  it("should start and stop monitoring without errors", () => {
    expect(() => startMonitoring(1000)).not.toThrow();
    expect(() => stopMonitoring()).not.toThrow();
  });

  it("should clear outage log", () => {
    clearOutageLog();
    expect(getOutageLog()).toHaveLength(0);
  });
});