/**
 * Centralised configuration for the ephemeral message TTL system.
 *
 * All values are read from environment variables at startup and can be
 * overridden at runtime via the admin API (in-process only; restart to persist).
 *
 * Environment variables:
 *   EPHEMERAL_TTL_SECONDS           System-wide default TTL (default: 86400 = 24 h)
 *   EPHEMERAL_CLEANUP_INTERVAL_MS   Scheduler tick interval  (default: 300000 = 5 min)
 *   EPHEMERAL_CLEANUP_BATCH_SIZE    Rows per DELETE batch     (default: 200)
 */

function readInt(key: string, fallback: number, min = 0): number {
  const raw = process.env[key]
  if (!raw) return fallback
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

// Mutable at runtime via setRuntimeDefaultTtl()
let _defaultTtlSeconds = readInt("EPHEMERAL_TTL_SECONDS", 86_400, 0)

export const EPHEMERAL_CONFIG = {
  /** System-wide default TTL in seconds. 0 = ephemeral disabled by default. */
  get defaultTtlSeconds(): number {
    return _defaultTtlSeconds
  },

  /** Scheduler tick interval in milliseconds. */
  get cleanupIntervalMs(): number {
    return readInt("EPHEMERAL_CLEANUP_INTERVAL_MS", 5 * 60 * 1000, 10_000)
  },

  /** Maximum messages deleted per DB round-trip. */
  get batchSize(): number {
    return readInt("EPHEMERAL_CLEANUP_BATCH_SIZE", 200, 1)
  },
} as const

/**
 * Updates the in-process default TTL.
 * Persists only for the lifetime of the current process.
 * To make it permanent, set EPHEMERAL_TTL_SECONDS in your deployment config.
 */
export function setRuntimeDefaultTtl(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError("TTL must be a non-negative finite number")
  }
  _defaultTtlSeconds = Math.floor(seconds)
}
