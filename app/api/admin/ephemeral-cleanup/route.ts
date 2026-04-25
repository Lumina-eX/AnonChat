/**
 * Admin endpoint: Ephemeral message cleanup
 *
 * POST /api/admin/ephemeral-cleanup
 *   Triggers an immediate cleanup run and returns the result.
 *   Protected by ADMIN_SECRET env var (Bearer token).
 *
 * GET /api/admin/ephemeral-cleanup
 *   Returns the current system-wide TTL configuration.
 *
 * PATCH /api/admin/ephemeral-cleanup
 *   Updates the system-wide default TTL (stored in env at runtime; for
 *   persistent changes update EPHEMERAL_TTL_SECONDS in your deployment).
 *   Body: { "default_ttl_seconds": number }
 */

import { type NextRequest, NextResponse } from "next/server"
import { runEphemeralCleanup } from "@/lib/ephemeral/cleanup"
import { logCleanup } from "@/lib/ephemeral/logger"
import { EPHEMERAL_CONFIG, setRuntimeDefaultTtl } from "@/lib/ephemeral/config"

// ─── Auth helper ─────────────────────────────────────────────────────────────

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET?.trim()
  if (!secret) {
    // No secret configured — deny all requests to prevent accidental exposure
    return false
  }
  const auth = request.headers.get("authorization") ?? ""
  return auth === `Bearer ${secret}`
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

// ─── GET — return current config ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorized()

  return NextResponse.json({
    config: {
      default_ttl_seconds: EPHEMERAL_CONFIG.defaultTtlSeconds,
      cleanup_interval_ms: EPHEMERAL_CONFIG.cleanupIntervalMs,
      batch_size: EPHEMERAL_CONFIG.batchSize,
      ttl_human: formatTtl(EPHEMERAL_CONFIG.defaultTtlSeconds),
    },
  })
}

// ─── POST — trigger immediate cleanup ────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorized()

  logCleanup("info", "Manual cleanup triggered via admin API", {
    ip: request.headers.get("x-forwarded-for") ?? "unknown",
  })

  try {
    const result = await runEphemeralCleanup()
    return NextResponse.json({ success: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logCleanup("error", "Manual cleanup failed", { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// ─── PATCH — update system-wide default TTL ──────────────────────────────────

export async function PATCH(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorized()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("default_ttl_seconds" in body)
  ) {
    return NextResponse.json(
      { error: "Body must contain default_ttl_seconds (integer ≥ 0)" },
      { status: 400 },
    )
  }

  const raw = (body as Record<string, unknown>).default_ttl_seconds
  const ttl = typeof raw === "number" ? Math.floor(raw) : parseInt(String(raw), 10)

  if (!Number.isFinite(ttl) || ttl < 0) {
    return NextResponse.json(
      { error: "default_ttl_seconds must be a non-negative integer" },
      { status: 400 },
    )
  }

  setRuntimeDefaultTtl(ttl)

  logCleanup("info", "System-wide default TTL updated via admin API", {
    new_ttl_seconds: ttl,
    ttl_human: formatTtl(ttl),
  })

  return NextResponse.json({
    success: true,
    config: {
      default_ttl_seconds: EPHEMERAL_CONFIG.defaultTtlSeconds,
      ttl_human: formatTtl(EPHEMERAL_CONFIG.defaultTtlSeconds),
    },
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTtl(seconds: number): string {
  if (seconds === 0) return "disabled"
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}
