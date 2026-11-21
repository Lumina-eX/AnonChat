/**
 * GET /api/stellar/health/history
 *
 * Returns the outage history log for audit/debugging purposes.
 */

import { NextResponse } from "next/server";
import { getOutageLog } from "@/lib/stellar/health-monitor";

export async function GET() {
  const log = getOutageLog();

  return NextResponse.json({
    outages: log.map((event) => ({
      id: event.id,
      startedAt: event.startedAt,
      endedAt: event.endedAt,
      durationMs: event.durationMs,
      status: event.status,
      error: event.error,
      recovered: event.recovered,
    })),
    summary: {
      total: log.length,
      recovered: log.filter((o) => o.recovered).length,
      active: log.filter((o) => !o.recovered).length,
    },
  });
}