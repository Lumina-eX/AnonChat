import { runEphemeralCleanup } from "@/lib/ephemeral/cleanup"
import { logCleanup } from "@/lib/ephemeral/logger"

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * How often the cleanup job runs, in milliseconds.
 * Default: every 5 minutes.
 * Override with EPHEMERAL_CLEANUP_INTERVAL_MS env var.
 */
function getIntervalMs(): number {
  const raw = process.env.EPHEMERAL_CLEANUP_INTERVAL_MS
  const parsed = raw ? parseInt(raw, 10) : NaN
  // Minimum 10 seconds to prevent accidental hammering
  return Number.isFinite(parsed) && parsed >= 10_000 ? parsed : 5 * 60 * 1000
}

// ─── Scheduler state ──────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null
let _running = false // guard against overlapping runs

// ─── Internal tick ────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (_running) {
    logCleanup("warn", "Skipping tick — previous run still in progress", {})
    return
  }

  _running = true
  try {
    await runEphemeralCleanup()
  } finally {
    _running = false
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Starts the background cleanup scheduler.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * @param runImmediately  When true (default) the first cleanup runs right away
 *                        instead of waiting for the first interval tick.
 */
export function startCleanupScheduler(runImmediately = true): void {
  if (_timer !== null) {
    logCleanup("warn", "Scheduler already running — ignoring duplicate start call", {})
    return
  }

  const intervalMs = getIntervalMs()

  logCleanup("info", "Cleanup scheduler starting", {
    intervalMs,
    intervalHuman: `${intervalMs / 1000}s`,
    runImmediately,
  })

  if (runImmediately) {
    // Fire-and-forget; errors are caught inside tick()
    void tick()
  }

  _timer = setInterval(() => {
    void tick()
  }, intervalMs)

  // Allow the Node.js process to exit even if the timer is still active.
  // The cleanup worker script handles SIGINT/SIGTERM for graceful shutdown.
  if (_timer.unref) {
    _timer.unref()
  }
}

/**
 * Stops the scheduler and waits for any in-progress run to finish.
 * Useful for graceful shutdown and tests.
 */
export async function stopCleanupScheduler(): Promise<void> {
  if (_timer !== null) {
    clearInterval(_timer)
    _timer = null
    logCleanup("info", "Cleanup scheduler stopped", {})
  }

  // Spin-wait for any active run to complete (max 30 s)
  const deadline = Date.now() + 30_000
  while (_running && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  if (_running) {
    logCleanup("warn", "Timed out waiting for in-progress cleanup run to finish", {})
  }
}

/**
 * Returns whether the scheduler is currently active.
 */
export function isSchedulerRunning(): boolean {
  return _timer !== null
}
