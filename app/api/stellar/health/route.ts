/**
 * GET /api/stellar/health
 *
 * Returns the current Stellar network health status.
 * Supports Server-Sent Events (SSE) for real-time updates when
 * the client requests streaming via Accept: text/event-stream.
 */

import { NextResponse } from "next/server";
import {
  checkHealth,
  subscribe,
  getCurrentStatus,
  getNetworkStatus,
  getOutageLog,
  startMonitoring,
  getActiveOutage,
} from "@/lib/stellar/health-monitor";

// Ensure monitoring is running on the server
startMonitoring(30000);

export async function GET(request: Request) {
  const accept = request.headers.get("accept") || "";

  // SSE streaming for real-time updates
  if (accept.includes("text/event-stream")) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (data: any) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
            );
          } catch {
            // Stream closed
          }
        };

        // Send initial state
        const current = getCurrentStatus();
        if (current) {
          send({
            type: "health_update",
            status: current.status,
            latencyMs: current.latencyMs,
            ledger: current.ledger,
            protocolVersion: current.protocolVersion,
            network: current.network,
            checkedAt: current.checkedAt,
            outage: getActiveOutage(),
          });
        }

        // Subscribe to updates
        const unsubscribe = subscribe((result) => {
          send({
            type: "health_update",
            status: result.status,
            latencyMs: result.latencyMs,
            ledger: result.ledger,
            protocolVersion: result.protocolVersion,
            network: result.network,
            checkedAt: result.checkedAt,
            outage: getActiveOutage(),
          });
        });

        // Keep alive
        const keepAlive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(":keepalive\n\n"));
          } catch {
            clearInterval(keepAlive);
          }
        }, 15000);

        // Cleanup on close
        request.signal.addEventListener("abort", () => {
          unsubscribe();
          clearInterval(keepAlive);
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Standard JSON response
  const result = getCurrentStatus() || (await checkHealth());
  const activeOutage = getActiveOutage();

  return NextResponse.json({
    status: result.status,
    latencyMs: result.latencyMs,
    ledger: result.ledger,
    protocolVersion: result.protocolVersion,
    horizonUrl: result.horizonUrl,
    network: result.network,
    checkedAt: result.checkedAt,
    error: result.error,
    outage: activeOutage
      ? {
          id: activeOutage.id,
          startedAt: activeOutage.startedAt,
          status: activeOutage.status,
          error: activeOutage.error,
        }
      : null,
    history: {
      totalOutages: getOutageLog().length,
      lastOutage: getOutageLog().slice(-1)[0] || null,
    },
  });
}