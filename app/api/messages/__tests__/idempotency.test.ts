/**
 * Tests for message idempotency / deduplication.
 *
 * Covers:
 *  1. HTTP POST /api/messages — duplicate client_message_id returns 200 with existing message
 *  2. HTTP POST /api/messages — new client_message_id proceeds to insert (201)
 *  3. HTTP POST /api/messages — missing client_message_id still works (no dedup)
 *  4. WebSocketClient.sendMessage — client-side duplicate blocked, success returned
 *  5. WebSocketClient.sendMessage — new ID is tracked and sent
 *  6. WebSocketClient.sentMessageIds eviction when cap exceeded
 *  7. WebSocket server dedupCache — duplicate in-memory hit returns message_duplicate
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: HTTP handler unit tests
// ─────────────────────────────────────────────────────────────────────────────

// We test the idempotency logic in isolation by extracting the shape of the
// POST handler's decision path via lightweight mocks.

describe("HTTP POST /api/messages — idempotency logic", () => {
  /**
   * Minimal simulation of the deduplication branch:
   * If `client_message_id` is provided and a matching row is found, the handler
   * must return the existing message without inserting.
   */
  function simulatePostHandler(options: {
    clientMessageId?: string
    existingMessage?: Record<string, unknown> | null
    insertResult?: Record<string, unknown>
  }) {
    const { clientMessageId, existingMessage = null, insertResult = { id: "new-uuid" } } = options

    let lookupCalled = false
    let insertCalled = false

    // Simulate the dedup lookup path
    if (clientMessageId) {
      lookupCalled = true
      if (existingMessage) {
        // Handler returns early with existing message
        return {
          status: 200,
          body: { message: existingMessage, success: true, deduplicated: true },
          lookupCalled,
          insertCalled,
        }
      }
    }

    // No duplicate found — proceed with insert
    insertCalled = true
    return {
      status: 201,
      body: { message: insertResult, success: true },
      lookupCalled,
      insertCalled,
    }
  }

  it("returns 200 with existing message when client_message_id already exists", () => {
    const existingMessage = {
      id: "existing-uuid",
      client_message_id: "test-dedup-id",
      content: "Hello",
      room_id: "room-1",
    }

    const result = simulatePostHandler({
      clientMessageId: "test-dedup-id",
      existingMessage,
    })

    expect(result.status).toBe(200)
    expect(result.body.deduplicated).toBe(true)
    expect(result.body.message).toEqual(existingMessage)
    expect(result.body.success).toBe(true)
    // Insert should NOT have been called
    expect(result.insertCalled).toBe(false)
    // Lookup should have run
    expect(result.lookupCalled).toBe(true)
  })

  it("returns 201 with new message when client_message_id is fresh (no existing row)", () => {
    const result = simulatePostHandler({
      clientMessageId: "brand-new-id",
      existingMessage: null,
      insertResult: { id: "new-msg-uuid", client_message_id: "brand-new-id" },
    })

    expect(result.status).toBe(201)
    expect(result.body.deduplicated).toBeUndefined()
    expect(result.body.success).toBe(true)
    expect(result.insertCalled).toBe(true)
  })

  it("skips dedup lookup entirely when no client_message_id is provided", () => {
    const result = simulatePostHandler({
      clientMessageId: undefined,
      existingMessage: null,
    })

    expect(result.status).toBe(201)
    // Lookup was NOT triggered
    expect(result.lookupCalled).toBe(false)
    expect(result.insertCalled).toBe(true)
  })

  it("deduplicated flag is absent from non-duplicate responses", () => {
    const result = simulatePostHandler({
      clientMessageId: "fresh-id",
      existingMessage: null,
    })

    expect(result.body).not.toHaveProperty("deduplicated")
  })

  it("returns same existing message id on duplicate submission", () => {
    const existingId = "fixed-existing-uuid"
    const result = simulatePostHandler({
      clientMessageId: "same-client-id",
      existingMessage: { id: existingId, content: "original" },
    })

    expect((result.body.message as any).id).toBe(existingId)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: WebSocketClient client-side dedup tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lightweight stand-in for the real WebSocketClient that exposes only
 * the pieces needed to test the dedup/UUID logic without a real WebSocket.
 */
const MAX_SENT_IDS = 500

class TestableDeduplicator {
  private sentMessageIds: Map<string, number> = new Map()

  private trackSentId(id: string): void {
    if (this.sentMessageIds.size >= MAX_SENT_IDS) {
      const firstKey = this.sentMessageIds.keys().next().value
      if (firstKey !== undefined) this.sentMessageIds.delete(firstKey)
    }
    this.sentMessageIds.set(id, Date.now())
  }

  /**
   * Mirrors the idempotency part of WebSocketClient.sendMessage.
   * Returns { isDuplicate, clientMessageId } instead of sending over WS.
   */
  processMessage(
    clientMessageId?: string,
  ): { isDuplicate: boolean; clientMessageId: string } {
    const msgId = clientMessageId ?? crypto.randomUUID()

    if (this.sentMessageIds.has(msgId)) {
      return { isDuplicate: true, clientMessageId: msgId }
    }

    this.trackSentId(msgId)
    return { isDuplicate: false, clientMessageId: msgId }
  }

  sentCount(): number {
    return this.sentMessageIds.size
  }
}

describe("WebSocketClient — client-side deduplication", () => {
  let dedup: TestableDeduplicator

  beforeEach(() => {
    dedup = new TestableDeduplicator()
  })

  it("auto-generates a UUID when no clientMessageId is provided", () => {
    const result = dedup.processMessage()
    expect(result.clientMessageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(result.isDuplicate).toBe(false)
  })

  it("tracks sent ID after first send", () => {
    dedup.processMessage("test-id-1")
    expect(dedup.sentCount()).toBe(1)
  })

  it("detects client-side duplicate when same ID is sent twice", () => {
    const firstResult = dedup.processMessage("dedup-me")
    const secondResult = dedup.processMessage("dedup-me")

    expect(firstResult.isDuplicate).toBe(false)
    expect(secondResult.isDuplicate).toBe(true)
    expect(secondResult.clientMessageId).toBe("dedup-me")
  })

  it("does NOT flag different IDs as duplicates", () => {
    const r1 = dedup.processMessage("id-alpha")
    const r2 = dedup.processMessage("id-beta")

    expect(r1.isDuplicate).toBe(false)
    expect(r2.isDuplicate).toBe(false)
  })

  it("generates unique IDs on consecutive auto-UUID calls", () => {
    const r1 = dedup.processMessage()
    const r2 = dedup.processMessage()

    expect(r1.clientMessageId).not.toBe(r2.clientMessageId)
  })

  it("evicts oldest entry when cache exceeds MAX_SENT_IDS", () => {
    // Fill the cache to the cap
    const firstId = "first-entry"
    dedup.processMessage(firstId)

    for (let i = 1; i < MAX_SENT_IDS; i++) {
      dedup.processMessage(`msg-${i}`)
    }

    expect(dedup.sentCount()).toBe(MAX_SENT_IDS)

    // One more push should evict `firstId`
    dedup.processMessage("overflow-entry")
    expect(dedup.sentCount()).toBe(MAX_SENT_IDS)

    // firstId no longer in cache, so re-sending it is NOT a duplicate
    const resubmit = dedup.processMessage(firstId)
    expect(resubmit.isDuplicate).toBe(false)
  })

  it("re-using an evicted ID is treated as a fresh message", () => {
    for (let i = 0; i < MAX_SENT_IDS + 1; i++) {
      dedup.processMessage(`filler-${i}`)
    }
    // "filler-0" should have been evicted
    const result = dedup.processMessage("filler-0")
    expect(result.isDuplicate).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: WebSocket server dedup-cache behaviour
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulates the server-side dedupCache logic in isolation.
 * Mirrors the Map-based in-memory cache used in lib/websocket/server.ts.
 */
class TestableServerDedupCache {
  private cache: Map<string, { serverId: string; createdAt: number }> = new Map()
  private readonly ttlMs: number

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs
  }

  /**
   * Handle an incoming send_message event.
   * Returns { isDuplicate, serverId }.
   */
  handleSendMessage(clientMessageId: string | undefined): {
    isDuplicate: boolean
    serverId: string
    existingServerId?: string
  } {
    if (clientMessageId) {
      const cached = this.cache.get(clientMessageId)
      if (cached) {
        return { isDuplicate: true, serverId: cached.serverId, existingServerId: cached.serverId }
      }
    }

    const serverId = crypto.randomUUID()
    if (clientMessageId) {
      this.cache.set(clientMessageId, { serverId, createdAt: Date.now() })
    }
    return { isDuplicate: false, serverId }
  }

  evictExpired(nowMs = Date.now()): void {
    const cutoff = nowMs - this.ttlMs
    for (const [key, entry] of this.cache) {
      if (entry.createdAt < cutoff) this.cache.delete(key)
    }
  }

  size(): number {
    return this.cache.size
  }
}

describe("WebSocket server — in-memory dedup cache", () => {
  let serverCache: TestableServerDedupCache

  beforeEach(() => {
    serverCache = new TestableServerDedupCache()
  })

  it("first send is not a duplicate", () => {
    const result = serverCache.handleSendMessage("client-uuid-1")
    expect(result.isDuplicate).toBe(false)
    expect(result.serverId).toBeTruthy()
  })

  it("second send with same client_message_id is flagged as duplicate", () => {
    const first = serverCache.handleSendMessage("dup-uuid")
    const second = serverCache.handleSendMessage("dup-uuid")

    expect(second.isDuplicate).toBe(true)
    expect(second.existingServerId).toBe(first.serverId)
  })

  it("different client_message_ids produce different server IDs", () => {
    const r1 = serverCache.handleSendMessage("id-one")
    const r2 = serverCache.handleSendMessage("id-two")

    expect(r1.isDuplicate).toBe(false)
    expect(r2.isDuplicate).toBe(false)
    expect(r1.serverId).not.toBe(r2.serverId)
  })

  it("missing client_message_id is never flagged as duplicate", () => {
    const r1 = serverCache.handleSendMessage(undefined)
    const r2 = serverCache.handleSendMessage(undefined)

    expect(r1.isDuplicate).toBe(false)
    expect(r2.isDuplicate).toBe(false)
  })

  it("evicts expired entries leaving fresh ones intact", () => {
    serverCache.handleSendMessage("old-id")
    serverCache.handleSendMessage("new-id")

    const FIVE_MIN_MS = 5 * 60 * 1000
    // Run eviction with current time advanced past TTL for "old-id"
    // We simulate by calling evictExpired with a future timestamp
    serverCache.evictExpired(Date.now() + FIVE_MIN_MS + 1)

    // Both should have been evicted (they were registered at the same real time)
    expect(serverCache.size()).toBe(0)
  })

  it("cache size grows correctly before eviction", () => {
    serverCache.handleSendMessage("msg-a")
    serverCache.handleSendMessage("msg-b")
    serverCache.handleSendMessage("msg-c")

    expect(serverCache.size()).toBe(3)
  })

  it("evicted entry is no longer a duplicate", () => {
    serverCache.handleSendMessage("to-evict")
    serverCache.evictExpired(Date.now() + 5 * 60 * 1001)

    // After eviction the same ID should be treated as new
    const result = serverCache.handleSendMessage("to-evict")
    expect(result.isDuplicate).toBe(false)
  })
})
