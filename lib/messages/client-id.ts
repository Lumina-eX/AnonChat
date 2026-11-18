/**
 * Client-side message ID generation
 *
 * Generates a stable UUID v4 idempotency key for each outgoing message.
 * The key must be created before the first send attempt and reused on
 * every retry so the server can recognise the duplicate.
 *
 * Works in both browser and Node.js environments:
 *   - Browser: uses the native crypto.randomUUID() / getRandomValues() API.
 *   - Node.js (tests, SSR): falls back to the built-in `crypto` module.
 */

// ---------------------------------------------------------------------------
// UUID generation
// ---------------------------------------------------------------------------

/**
 * Returns a new UUID v4 string.
 *
 * Uses the Web Crypto API in the browser and Node's built-in `crypto`
 * module elsewhere. No external dependencies required.
 */
export function generateMessageId(): string {
  // Modern browsers and Node 19+
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  // Node.js < 19 / older runtimes — dynamic require avoids bundler warnings
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require("crypto") as typeof import("crypto")
  return nodeCrypto.randomUUID()
}

// ---------------------------------------------------------------------------
// Idempotency key lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Creates a new idempotency context for a single send attempt.
 *
 * Call this **once** per message, before the first send. Store the
 * returned object alongside your pending message state and pass
 * `key` in every retry until you receive a successful response.
 *
 * @example
 * ```ts
 * const { key, createdAt } = createIdempotencyContext()
 *
 * // first attempt
 * await sendMessage({ content, room_id, idempotency_key: key })
 *
 * // on retry (network failure, WebSocket reconnect, …)
 * await sendMessage({ content, room_id, idempotency_key: key })  // same key
 * ```
 */
export interface IdempotencyContext {
  /** UUID v4 to send as `idempotency_key` in message payloads. */
  key: string
  /** Unix timestamp (ms) when this context was created. */
  createdAt: number
}

export function createIdempotencyContext(): IdempotencyContext {
  return {
    key: generateMessageId(),
    createdAt: Date.now(),
  }
}

/**
 * Simple validator — returns `true` when the string matches UUID v4 format.
 * Useful for client-side pre-flight checks before sending.
 */
export function isValidIdempotencyKey(key: unknown): key is string {
  if (typeof key !== "string") return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
}

// ---------------------------------------------------------------------------
// React hook (optional, only used in browser component trees)
// ---------------------------------------------------------------------------

/**
 * React hook that returns a stable idempotency key for the current
 * message composition session.  The key resets automatically when
 * `resetToken` changes (e.g. after a successful send).
 *
 * @example
 * ```tsx
 * const [sentCount, setSentCount] = useState(0)
 * const idempotencyKey = useMessageIdempotencyKey(sentCount)
 *
 * const handleSend = async () => {
 *   await sendMessage({ content, idempotency_key: idempotencyKey })
 *   setSentCount(c => c + 1)  // triggers a new key for the next message
 * }
 * ```
 */
export function useMessageIdempotencyKey(resetToken: unknown): string {
  // Lazy import React so this file remains usable in non-React environments.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useRef, useEffect } = require("react") as typeof import("react")

  const keyRef = useRef<string>(generateMessageId())
  const prevTokenRef = useRef<unknown>(resetToken)

  useEffect(() => {
    if (prevTokenRef.current !== resetToken) {
      keyRef.current = generateMessageId()
      prevTokenRef.current = resetToken
    }
  }, [resetToken])

  return keyRef.current
}
