/**
 * Vercel Cron endpoint: Ephemeral message cleanup
 *
 * This route is invoked automatically by Vercel Cron on a schedule defined
 * in vercel.json.  It is also callable manually for testing.
 *
 * Authentication:
 *   Vercel sets the `Authorization: Bearer <CRON_SECRET>` header on every
 *   cron invocation.  We validate it against the CRON_SECRET env var so the
 *   endpoint cannot be triggered by arbitrary callers.
 *
 * Deployment note:
 *   Add the following to vercel.json to enable the cron schedule:
 *
 *   {
 *     "crons": [
 *       {
 *         "path": "/api/cron/ephemeral-cleanup",
 *         "schedule": "* /5 * * * *"   // every 5 minutes
 *       }
 *     ]
 *   }
 *
 *   (Remove the space inside "* /5" — it is there only to avoid JSDoc issues.)
 *
 * For self-hosted / Docker deployments the standalone cleanup worker
 * (scripts/start-cleanup-worker.js) is preferred over this cron route.
 */

import { type NextRequest, NextResponse } from "next/server"
import { runEphemeralCleanup } from "@/lib/ephemeral/cleanup"
import { logCleanup } from "@/lib/ephemeral/logger"

// ─── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    // No secret configured — deny all to prevent accidental exposure
    return false
  }
  const auth = request.headers.get("authorization") ?? ""
  return auth === `Bearer ${secret}`
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  logCleanup("info", "Cron-triggered ephemeral cleanup started", {
    source: "vercel-cron",
    invokedAt: new Date().toISOString(),
  })

  try {
    const result = await runEphemeralCleanup()

    return NextResponse.json({
      success: true,
      deletedCount: result.deletedCount,
      batchCount: result.batchCount,
      durationMs: result.durationMs,
      runId: result.runId,
      ...(result.error ? { warning: result.error } : {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logCleanup("error", "Cron cleanup failed with unexpected error", { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
