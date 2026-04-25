import { randomUUID } from "crypto"

export type EphemeralLogLevel = "info" | "warn" | "error"

export interface CleanupRunResult {
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  deletedCount: number
  batchCount: number
  deletedIds: string[]
  error?: string
}

interface EphemeralLog {
  timestamp: string
  level: EphemeralLogLevel
  operation: string
  runId: string
  context: Record<string, unknown>
}

/**
 * Generates a unique run ID for correlating log lines within a single cleanup run.
 */
export function generateRunId(): string {
  return randomUUID()
}

/**
 * Structured logger for the ephemeral-message cleanup worker.
 * Mirrors the pattern used in lib/blockchain/logger.ts so log aggregators
 * can parse both sources with the same schema.
 */
export function logCleanup(
  level: EphemeralLogLevel,
  operation: string,
  context: Record<string, unknown>,
  runId: string = generateRunId(),
): void {
  const entry: EphemeralLog = {
    timestamp: new Date().toISOString(),
    level,
    operation,
    runId,
    context,
  }

  const prefix = `[EphemeralCleanup ${level.toUpperCase()}] ${operation}`
  const payload = JSON.stringify(entry, null, 2)

  switch (level) {
    case "info":
      console.log(prefix, payload)
      break
    case "warn":
      console.warn(prefix, payload)
      break
    case "error":
      console.error(prefix, payload)
      break
  }
}
