/**
 * Message Idempotency
 *
 * Shared logic for detecting and handling duplicate message submissions.
 * Used by both the HTTP POST handler and the WebSocket send_message path.
 *
 * Flow:
 *   1. Client generates a UUID before sending (see lib/messages/client-id.ts).
 *   2. Server calls checkMessageIdempotency() with the key before inserting.
 *   3. If a matching row is found, the existing message is returned immediately.
 *   4. If no match, the caller inserts and the DB unique constraint acts as
 *      a last-resort guard against concurrent duplicates.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdempotencyCheckResult {
  /** True when a prior message with this key already exists. */
  isDuplicate: boolean
  /** The existing message row when isDuplicate is true. */
  existingMessage?: Record<string, unknown>
}

export interface MessageInsertPayload {
  user_id: string
  room_id: string
  content: string
  is_encrypted?: boolean
  status?: string
  is_ephemeral?: boolean
  expires_at?: string
  reply_to_id?: string | null
  /** Client-generated UUID identifying this send attempt. */
  idempotency_key?: string
}

// ---------------------------------------------------------------------------
// In-process duplicate counter (resets on server restart)
// Export kept intentionally so callers / tests can read metrics.
// ---------------------------------------------------------------------------

interface IdempotencyMetrics {
  totalChecks: number
  duplicatesDetected: number
  /** Keyed by source, e.g. "http" | "websocket" */
  duplicatesBySource: Record<string, number>
}

const _metrics: IdempotencyMetrics = {
  totalChecks: 0,
  duplicatesDetected: 0,
  duplicatesBySource: {},
}

export function getIdempotencyMetrics(): Readonly<IdempotencyMetrics> {
  return { ..._metrics, duplicatesBySource: { ..._metrics.duplicatesBySource } }
}

/** Resets counters — intended for test isolation only. */
export function resetIdempotencyMetrics(): void {
  _metrics.totalChecks = 0
  _metrics.duplicatesDetected = 0
  _metrics.duplicatesBySource = {}
}

function recordDuplicate(source: string): void {
  _metrics.duplicatesDetected++
  _metrics.duplicatesBySource[source] = (_metrics.duplicatesBySource[source] ?? 0) + 1
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Validates that the provided string looks like a UUID v4.
 * Rejects obviously malformed keys early to avoid a wasted DB round-trip.
 */
export function isValidUUID(key: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
}

/**
 * Checks whether a message with the given idempotency_key already exists.
 *
 * @param supabase  Authenticated Supabase client (server-side).
 * @param key       The UUID supplied by the client.
 * @param source    Caller label used in log/metrics ("http" | "websocket").
 * @returns         { isDuplicate: true, existingMessage } or { isDuplicate: false }.
 */
export async function checkMessageIdempotency(
  supabase: SupabaseClient,
  key: string,
  source: "http" | "websocket" = "http",
): Promise<IdempotencyCheckResult> {
  _metrics.totalChecks++

  // Basic format guard — skip the DB call for garbage input
  if (!isValidUUID(key)) {
    console.warn(
      `[idempotency] Invalid UUID format supplied (source=${source}): ${JSON.stringify(key)}`,
    )
    return { isDuplicate: false }
  }

  const { data, error } = await supabase
    .from("messages")
    .select("*, profiles(display_name, avatar_url)")
    .eq("idempotency_key", key)
    .maybeSingle()

  if (error) {
    // Treat a lookup error as non-duplicate so the caller can attempt the
    // insert; the DB unique constraint will still prevent actual duplication.
    console.error(
      `[idempotency] Error checking key (source=${source}): ${error.message}`,
      { key, code: error.code },
    )
    return { isDuplicate: false }
  }

  if (data) {
    recordDuplicate(source)
    console.info(
      `[idempotency] Duplicate detected (source=${source}) — returning existing message`,
      {
        idempotency_key: key,
        existing_message_id: (data as any).id,
        room_id: (data as any).room_id,
        created_at: (data as any).created_at,
        total_duplicates: _metrics.duplicatesDetected,
      },
    )
    return { isDuplicate: true, existingMessage: data as Record<string, unknown> }
  }

  return { isDuplicate: false }
}

/**
 * Convenience wrapper: performs the idempotency check and, when no
 * duplicate exists, inserts the message in a single call.
 *
 * Returns:
 *   - `{ message, isDuplicate: true  }` — existing row returned, no insert.
 *   - `{ message, isDuplicate: false }` — newly inserted row.
 *   - `{ message: null, error }` — insert failed (non-duplicate error).
 */
export async function insertMessageIdempotent(
  supabase: SupabaseClient,
  payload: MessageInsertPayload,
  source: "http" | "websocket" = "http",
): Promise<{
  message: Record<string, unknown> | null
  isDuplicate: boolean
  error?: string
}> {
  const key = payload.idempotency_key

  // Only run the pre-check when the client supplied a valid key.
  if (key) {
    const check = await checkMessageIdempotency(supabase, key, source)
    if (check.isDuplicate && check.existingMessage) {
      return { message: check.existingMessage, isDuplicate: true }
    }
  }

  // Proceed with insert
  const { data, error } = await supabase
    .from("messages")
    .insert(payload)
    .select("*, profiles(display_name, avatar_url)")

  if (error) {
    // PostgreSQL unique-constraint violation code = 23505
    // This means a concurrent request beat us to the insert.
    if (error.code === "23505" && key) {
      console.info(
        `[idempotency] Race condition resolved via constraint (source=${source})`,
        { idempotency_key: key },
      )
      // Re-fetch the winner row
      const { data: existing } = await supabase
        .from("messages")
        .select("*, profiles(display_name, avatar_url)")
        .eq("idempotency_key", key)
        .maybeSingle()

      if (existing) {
        recordDuplicate(source)
        return { message: existing as Record<string, unknown>, isDuplicate: true }
      }
    }

    console.error(`[idempotency] Insert failed (source=${source}): ${error.message}`, {
      code: error.code,
      idempotency_key: key,
    })
    return { message: null, isDuplicate: false, error: error.message }
  }

  return { message: data?.[0] ?? null, isDuplicate: false }
}
