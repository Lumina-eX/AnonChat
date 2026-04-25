import { createClient } from "@supabase/supabase-js"
import { requireEnv } from "@/lib/supabase/env"
import { logCleanup, generateRunId, type CleanupRunResult } from "@/lib/ephemeral/logger"

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * How many expired messages to delete per DB round-trip.
 * Keeps transactions short and avoids lock contention on busy tables.
 */
const BATCH_SIZE = parseInt(process.env.EPHEMERAL_CLEANUP_BATCH_SIZE ?? "200", 10)

// ─── Service-role Supabase client ─────────────────────────────────────────────
// The cleanup worker must bypass RLS to delete messages owned by any user.
// We lazily create a single module-level client so the worker process reuses it.

let _serviceClient: ReturnType<typeof createClient> | null = null

function getServiceClient() {
  if (!_serviceClient) {
    const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL")
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    _serviceClient = createClient(url, serviceKey, {
      auth: {
        // Disable auto-refresh; this is a server-side service account
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }
  return _serviceClient
}

// ─── Core cleanup logic ───────────────────────────────────────────────────────

/**
 * Fetches one batch of expired ephemeral message IDs.
 * Uses the partial index on (expires_at) WHERE is_ephemeral = true.
 */
async function fetchExpiredBatch(
  supabase: ReturnType<typeof createClient>,
  now: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .eq("is_ephemeral", true)
    .lte("expires_at", now)
    .limit(BATCH_SIZE)

  if (error) {
    throw new Error(`Failed to fetch expired messages: ${error.message}`)
  }

  return (data ?? []).map((row: { id: string }) => row.id)
}

/**
 * Deletes a batch of messages by their IDs.
 * Returns the IDs that were actually deleted (rows that existed at delete time).
 * Rows already deleted by a concurrent run are silently ignored — this is the
 * "graceful handling of already-deleted messages" requirement.
 */
async function deleteBatch(
  supabase: ReturnType<typeof createClient>,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from("messages")
    .delete()
    .in("id", ids)
    .select("id") // return only what was actually deleted

  if (error) {
    throw new Error(`Failed to delete message batch: ${error.message}`)
  }

  return (data ?? []).map((row: { id: string }) => row.id)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Runs a full cleanup cycle:
 *  1. Repeatedly fetches batches of expired ephemeral messages
 *  2. Deletes each batch
 *  3. Logs every deleted message ID for audit/debug
 *  4. Returns a structured result summary
 *
 * The function is intentionally idempotent — calling it multiple times is safe.
 * Already-deleted messages are silently skipped.
 */
export async function runEphemeralCleanup(): Promise<CleanupRunResult> {
  const runId = generateRunId()
  const startedAt = new Date().toISOString()
  const startMs = Date.now()

  logCleanup("info", "Cleanup run started", { batchSize: BATCH_SIZE }, runId)

  const supabase = getServiceClient()
  const allDeletedIds: string[] = []
  let batchCount = 0
  let lastError: string | undefined

  try {
    // Use a single consistent "now" for the entire run so that messages
    // that expire mid-run are handled in the next cycle, not partially.
    const now = new Date().toISOString()

    while (true) {
      // 1. Fetch a batch of expired IDs
      let expiredIds: string[]
      try {
        expiredIds = await fetchExpiredBatch(supabase, now)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logCleanup("error", "Failed to fetch expired batch", { error: msg }, runId)
        lastError = msg
        break
      }

      if (expiredIds.length === 0) {
        // No more expired messages — we're done
        break
      }

      batchCount++

      logCleanup(
        "info",
        "Deleting batch",
        { batchNumber: batchCount, batchSize: expiredIds.length, ids: expiredIds },
        runId,
      )

      // 2. Delete the batch
      let deletedIds: string[]
      try {
        deletedIds = await deleteBatch(supabase, expiredIds)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logCleanup(
          "error",
          "Failed to delete batch",
          { batchNumber: batchCount, error: msg, attemptedIds: expiredIds },
          runId,
        )
        lastError = msg
        // Don't abort the whole run — try the next batch on the next cycle
        break
      }

      allDeletedIds.push(...deletedIds)

      // Log each deleted ID individually for audit trail
      logCleanup(
        "info",
        "Batch deleted",
        {
          batchNumber: batchCount,
          requested: expiredIds.length,
          deleted: deletedIds.length,
          // IDs that were in expiredIds but not in deletedIds were already gone
          alreadyGone: expiredIds.length - deletedIds.length,
          deletedIds,
        },
        runId,
      )

      // If we got fewer rows than BATCH_SIZE, there are no more to process
      if (expiredIds.length < BATCH_SIZE) break
    }
  } catch (err) {
    // Catch-all for unexpected errors — the scheduler must not crash
    const msg = err instanceof Error ? err.message : String(err)
    logCleanup("error", "Unexpected error during cleanup run", { error: msg }, runId)
    lastError = msg
  }

  const finishedAt = new Date().toISOString()
  const durationMs = Date.now() - startMs

  const result: CleanupRunResult = {
    runId,
    startedAt,
    finishedAt,
    durationMs,
    deletedCount: allDeletedIds.length,
    batchCount,
    deletedIds: allDeletedIds,
    ...(lastError ? { error: lastError } : {}),
  }

  logCleanup(
    lastError ? "warn" : "info",
    "Cleanup run finished",
    {
      deletedCount: result.deletedCount,
      batchCount: result.batchCount,
      durationMs: result.durationMs,
      ...(lastError ? { error: lastError } : {}),
    },
    runId,
  )

  return result
}
