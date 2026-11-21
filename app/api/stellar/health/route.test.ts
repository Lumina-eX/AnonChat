/**
 * API route tests for /api/stellar/health
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "./route";

describe("GET /api/stellar/health", () => {
  beforeEach(() => {
    // Reset environment
    delete process.env.STELLAR_HORIZON_URL;
    delete process.env.STELLAR_NETWORK;
    delete process.env.STELLAR_SOURCE_SECRET;
  });

  it("should return JSON health status", async () => {
    const request = new Request("http://localhost/api/stellar/health");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty("status");
    expect(data).toHaveProperty("latencyMs");
    expect(data).toHaveProperty("checkedAt");
    expect(data).toHaveProperty("outage");
    expect(data).toHaveProperty("history");
  });

  it("should return SSE stream when Accept header is text/event-stream", async () => {
    const request = new Request("http://localhost/api/stellar/health", {
      headers: { Accept: "text/event-stream" },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });
});