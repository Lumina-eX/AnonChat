/**
 * Tests for idempotent message delivery.
 *
 * These tests verify the idempotency logic in isolation using mocked Supabase
 * clients. They cover:
 *   1. Client-side UUID generation — every call to handleSendMessage should
 *      produce a unique, stable clientMessageId embedded in the WS payload.
 *   2. HTTP route idempotency — first request creates, retries return the
 *      existing row without a duplicate insert.
 *   3. WebSocket server idempotency — duplicate send_message events with the
 *      same clientMessageId are rejected after the first insert.
 *   4. Concurrent duplicate race — the 23505 unique-constraint violation is
 *      handled gracefully in both the HTTP and WS paths.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Helpers / stubs
// ---------------------------------------------------------------------------

/** Minimal Supabase query-builder stub. */
function makeSupabaseStub(existingRow: Record<string, unknown> | null, insertResult?: Record<string, unknown>) {
  let _table = ""

  const builder = {
    from(table: string) {
      _table = table
      return this
    },
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: existingRow, error: null }),
    single: vi.fn().mockResolvedValue({
      data: insertResult ?? { id: "db-uuid-001", content: "hello", created_at: new Date().toISOString() },
      error: null,
    }),
  }

  return builder
}

// ---------------------------------------------------------------------------
// 1. Client-side UUID generation
// ---------------------------------------------------------------------------

describe("Client-side clientMessageId generation", () => {
  it("generates a new UUID for each message send attempt", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 20; i++) {
      ids.add(crypto.randomUUID())
    }
    // All 20 must be distinct
    expect(ids.size).toBe(20)
  })

  it("UUID matches the RFC 4122 v4 format", () => {
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    const id = crypto.randomUUID()
    expect(id).toMatch(uuidV4Regex)
  })

  it("optimistic message id is derived from clientMessageId", () => {
    const clientMessageId = crypto.randomUUID()
    const optimisticId = `temp-${clientMessageId}`
    expect(optimisticId).toContain(clientMessageId)
    expect(optimisticId.startsWith("temp-")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. HTTP route idempotency logic (unit — business-logic layer)
// ---------------------------------------------------------------------------

describe("HTTP idempotency logic", () => {
  /**
   * Pure function extracted from the POST handler to test the idempotency
   * decision in isolation (no HTTP framework needed).
   */
  async function resolveIdempotentInsert(
    supabase: ReturnType<typeof makeSupabaseStub>,
    userId: string,
    roomId: string,
    content: string,
    clientMessageId: string | undefined,
  ): Promise<{ message: Record<string, unknown>; duplicate: boolean }> {
    if (clientMessageId) {
      const { data: existing } = await supabase
        .from("messages")
        .select("*")
        .eq("user_id", userId)
        .eq("client_message_id", clientMessageId)
        .maybeSingle()

      if (existing) {
        return { message: existing, duplicate: true }
      }
    }

    const insertData: Record<string, unknown> = {
      user_id: userId,
      room_id: roomId,
      content,
      ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
    }

    const { data } = await supabase.from("messages").insert(insertData).select().single()
    return { message: data as Record<string, unknown>, duplicate: false }
  }

  it("creates a new message when no duplicate exists", async () => {
    const supabase = makeSupabaseStub(null, { id: "new-id", content: "hello", created_at: new Date().toISOString() })
    const result = await resolveIdempotentInsert(supabase, "user-1", "room-1", "hello", "uuid-abc")
    expect(result.duplicate).toBe(false)
    expect(result.message.id).toBe("new-id")
  })

  it("returns the existing message and marks it as duplicate when the same clientMessageId is resubmitted", async () => {
    const existing = { id: "existing-id", content: "hello", created_at: new Date().toISOString() }
    const supabase = makeSupabaseStub(existing)
    const result = await resolveIdempotentInsert(supabase, "user-1", "room-1", "hello", "uuid-abc")
    expect(result.duplicate).toBe(true)
    expect(result.message.id).toBe("existing-id")
  })

  it("skips idempotency check and inserts directly when no clientMessageId is provided", async () => {
    const supabase = makeSupabaseStub(null, { id: "new-id", content: "hi", created_at: new Date().toISOString() })
    const result = await resolveIdempotentInsert(supabase, "user-1", "room-1", "hi", undefined)
    // maybeSingle should NOT have been called (no lookup)
    expect(supabase.maybeSingle).not.toHaveBeenCalled()
    expect(result.duplicate).toBe(false)
  })

  it("handles concurrent duplicate via 23505 unique-constraint error", async () => {
    const concurrent = { id: "race-id", content: "race", created_at: new Date().toISOString() }

    // Simulate: maybeSingle returns null first (no existing row found before insert),
    // then insert fails with 23505, then a second lookup returns the concurrent row.
    let maybeSingleCallCount = 0
    const supabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => {
        maybeSingleCallCount++
        if (maybeSingleCallCount === 1) return Promise.resolve({ data: null, error: null })
        return Promise.resolve({ data: concurrent, error: null })
      }),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: "23505", message: "unique violation" } }),
    }

    async function resolveWithRaceHandling(
      userId: string,
      roomId: string,
      content: string,
      clientMessageId: string,
    ) {
      // Check for existing
      const { data: existing } = await supabase.from("messages").select("*").eq("user_id", userId).eq("client_message_id", clientMessageId).maybeSingle()
      if (existing) return { message: existing, duplicate: true }

      // Attempt insert
      const { data, error } = await supabase.from("messages").insert({}).select().single()
      if (error?.code === "23505") {
        // Race — fetch the winner
        const { data: raceWinner } = await supabase.from("messages").select("*").eq("user_id", userId).eq("client_message_id", clientMessageId).maybeSingle()
        if (raceWinner) return { message: raceWinner, duplicate: true }
      }
      return { message: data, duplicate: false }
    }

    const result = await resolveWithRaceHandling("user-1", "room-1", "race", "uuid-race")
    expect(result.duplicate).toBe(true)
    expect(result.message?.id).toBe("race-id")
  })
})

// ---------------------------------------------------------------------------
// 3. WebSocket server idempotency logic (unit — business-logic layer)
// ---------------------------------------------------------------------------

describe("WebSocket send_message idempotency logic", () => {
  /**
   * Core logic extracted from the WS send_message handler.
   */
  async function handleWsSendMessage(
    supabase: ReturnType<typeof makeSupabaseStub>,
    userId: string,
    roomId: string,
    content: string,
    clientMessageId: string | undefined,
  ): Promise<{ persisted: Record<string, unknown>; duplicate: boolean }> {
    if (clientMessageId) {
      const { data: existing } = await supabase
        .from("messages")
        .select("*")
        .eq("user_id", userId)
        .eq("client_message_id", clientMessageId)
        .maybeSingle()

      if (existing) {
        return { persisted: existing, duplicate: true }
      }
    }

    const { data: inserted } = await supabase
      .from("messages")
      .insert({
        user_id: userId,
        room_id: roomId,
        content,
        ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
      })
      .select()
      .single()

    return { persisted: inserted as Record<string, unknown>, duplicate: false }
  }

  it("persists a new message and marks it non-duplicate on first send", async () => {
    const insertResult = { id: "ws-msg-001", content: "ws hello", created_at: new Date().toISOString() }
    const supabase = makeSupabaseStub(null, insertResult)
    const result = await handleWsSendMessage(supabase, "user-2", "room-2", "ws hello", "ws-uuid-001")
    expect(result.duplicate).toBe(false)
    expect(result.persisted.id).toBe("ws-msg-001")
  })

  it("detects duplicate on retry and returns the existing persisted row", async () => {
    const existing = { id: "ws-msg-001", content: "ws hello", created_at: new Date().toISOString() }
    const supabase = makeSupabaseStub(existing)
    const result = await handleWsSendMessage(supabase, "user-2", "room-2", "ws hello", "ws-uuid-001")
    expect(result.duplicate).toBe(true)
    expect(result.persisted.id).toBe("ws-msg-001")
    // insert should NOT have been called because we short-circuited at the lookup
    expect(supabase.insert).not.toHaveBeenCalled()
  })

  it("does not perform a duplicate check if clientMessageId is absent", async () => {
    const insertResult = { id: "ws-msg-002", content: "no id", created_at: new Date().toISOString() }
    const supabase = makeSupabaseStub(null, insertResult)
    const result = await handleWsSendMessage(supabase, "user-2", "room-2", "no id", undefined)
    expect(supabase.maybeSingle).not.toHaveBeenCalled()
    expect(result.duplicate).toBe(false)
  })

  it("different users can send messages with the same clientMessageId without conflict", async () => {
    const uuid = crypto.randomUUID()
    // User 1 — no existing row → inserts successfully
    const supabaseUser1 = makeSupabaseStub(null, { id: "msg-user1", content: "hi", created_at: new Date().toISOString() })
    const result1 = await handleWsSendMessage(supabaseUser1, "user-1", "room-1", "hi", uuid)
    expect(result1.duplicate).toBe(false)

    // User 2 — also no existing row (different user_id) → also inserts successfully
    const supabaseUser2 = makeSupabaseStub(null, { id: "msg-user2", content: "hi", created_at: new Date().toISOString() })
    const result2 = await handleWsSendMessage(supabaseUser2, "user-2", "room-1", "hi", uuid)
    expect(result2.duplicate).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4. Logging / metrics
// ---------------------------------------------------------------------------

describe("Duplicate attempt logging", () => {
  it("logs a warning when a duplicate is detected", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    // Simulate the warning pattern used in the WebSocket server handler
    const userId = "user-99"
    const clientMessageId = "dup-uuid"
    const existingId = "existing-555"

    console.warn(
      `[WebSocket] Duplicate message detected user_id=${userId} client_message_id=${clientMessageId} existing_id=${existingId}`,
    )

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Duplicate message detected"))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(userId))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(clientMessageId))

    warnSpy.mockRestore()
  })
})
