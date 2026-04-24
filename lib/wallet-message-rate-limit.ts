import type { User } from "@supabase/supabase-js"
import { validateStellarAddress } from "@/lib/auth/validation"
import { createClient } from "redis"

type RedisClient = ReturnType<typeof createClient>

export type WalletMessageRatePolicy = {
  limit: number
  windowSec: number
}

const WALLET_EMAIL_SUFFIX = "@wallet.anonchat.local"

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call("ZREMRANGEBYSCORE", key, 0, now - windowMs)
local n = redis.call("ZCARD", key)
if n >= limit then
  return 0
end
redis.call("ZADD", key, now, member)
redis.call("EXPIRE", key, math.ceil(windowMs / 1000) + 2)
return 1
`

type OverrideEntry = number | { limit?: number; windowSec?: number }

function parseOverrideMap(raw: string | undefined): Record<string, OverrideEntry> | null {
  if (!raw?.trim()) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, OverrideEntry>) : null
  } catch {
    return null
  }
}

function entryToPolicy(entry: OverrideEntry | undefined, fallback: WalletMessageRatePolicy): WalletMessageRatePolicy {
  if (entry == null) return fallback
  if (typeof entry === "number") {
    if (!Number.isFinite(entry) || entry < 1) return fallback
    return { limit: Math.floor(entry), windowSec: fallback.windowSec }
  }
  const limit = entry.limit != null && Number.isFinite(entry.limit) && entry.limit >= 1 ? Math.floor(entry.limit) : fallback.limit
  const windowSec =
    entry.windowSec != null && Number.isFinite(entry.windowSec) && entry.windowSec >= 1
      ? Math.floor(entry.windowSec)
      : fallback.windowSec
  return { limit, windowSec }
}

export function getDefaultWalletMessageRatePolicy(): WalletMessageRatePolicy {
  const limit = Math.max(1, Number.parseInt(process.env.WALLET_MESSAGE_RATE_LIMIT ?? "20", 10) || 20)
  const windowSec = Math.max(1, Number.parseInt(process.env.WALLET_MESSAGE_RATE_WINDOW_SEC ?? "60", 10) || 60)
  return { limit, windowSec }
}

export function resolveWalletMessageRatePolicy(walletKey: string, roomId: string): WalletMessageRatePolicy {
  const defaults = getDefaultWalletMessageRatePolicy()
  const byWallet = parseOverrideMap(process.env.WALLET_MESSAGE_RATE_LIMIT_BY_WALLET)
  const byRoom = parseOverrideMap(process.env.WALLET_MESSAGE_RATE_LIMIT_BY_ROOM)

  if (byWallet?.[walletKey]) {
    return entryToPolicy(byWallet[walletKey], defaults)
  }
  if (byRoom?.[roomId]) {
    return entryToPolicy(byRoom[roomId], defaults)
  }
  return defaults
}

export function formatRateLimitWindow(windowSec: number): string {
  return `${windowSec}s`
}

/**
 * Stable identity for rate limiting: Stellar address when available, else Supabase user id.
 */
export function getWalletRateLimitKey(user: User): string {
  const meta = user.user_metadata as Record<string, unknown> | undefined
  const fromMeta = meta?.wallet_address
  if (typeof fromMeta === "string" && validateStellarAddress(fromMeta)) {
    return fromMeta
  }
  const email = user.email ?? ""
  if (email.endsWith(WALLET_EMAIL_SUFFIX)) {
    return email.slice(0, -WALLET_EMAIL_SUFFIX.length)
  }
  return `uid:${user.id}`
}

type MemoryRecord = { timestamps: number[] }
const memoryRecords = new Map<string, MemoryRecord>()
const memoryTails = new Map<string, Promise<unknown>>()

function enqueueByKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = memoryTails.get(key) ?? Promise.resolve()
  const run = async () => fn()
  const next = prev.then(run, run)
  memoryTails.set(key, next.catch(() => {}))
  return next
}

async function consumeSlidingWindowMemory(
  storageKey: string,
  policy: WalletMessageRatePolicy,
): Promise<boolean> {
  return enqueueByKey(storageKey, async () => {
    const now = Date.now()
    const windowMs = policy.windowSec * 1000
    const record = memoryRecords.get(storageKey) ?? { timestamps: [] }
    record.timestamps = record.timestamps.filter((t) => now - t < windowMs)
    if (record.timestamps.length >= policy.limit) {
      return false
    }
    record.timestamps.push(now)
    memoryRecords.set(storageKey, record)
    return true
  })
}

const redisGlobal = globalThis as typeof globalThis & { __walletMsgRateRedis?: RedisClient | null }

async function getRedisClient(): Promise<RedisClient | null> {
  const url = process.env.REDIS_URL?.trim()
  if (!url) return null

  if (redisGlobal.__walletMsgRateRedis === undefined) {
    try {
      const c = createClient({ url })
      c.on("error", (err) => {
        console.error("[wallet-msg-rate-limit] Redis client error:", err)
      })
      await c.connect()
      redisGlobal.__walletMsgRateRedis = c
    } catch (e) {
      console.error("[wallet-msg-rate-limit] Redis connect failed, using in-memory store:", e)
      redisGlobal.__walletMsgRateRedis = null
    }
  }
  return redisGlobal.__walletMsgRateRedis ?? null
}

function buildStorageKey(walletKey: string, roomId: string): string {
  return `wallet_msg:${walletKey}:${roomId}`
}

export type WalletMessageRateResult = {
  allowed: boolean
  policy: WalletMessageRatePolicy
}

/**
 * Atomically records one message send in a sliding window (per wallet per room).
 * Uses Redis when REDIS_URL is set; otherwise in-memory with per-key serialization for concurrent requests.
 */
export async function checkAndConsumeWalletMessageSlot(
  walletKey: string,
  roomId: string,
  policy: WalletMessageRatePolicy,
): Promise<WalletMessageRateResult> {
  const storageKey = buildStorageKey(walletKey, roomId)
  const windowMs = policy.windowSec * 1000
  const redis = await getRedisClient()

  if (redis) {
    const member = `${Date.now()}:${crypto.randomUUID()}`
    const allowedRaw = await redis.eval(SLIDING_WINDOW_LUA, {
      keys: [storageKey],
      arguments: [String(Date.now()), String(windowMs), String(policy.limit), member],
    })
    const allowed = Number(allowedRaw) === 1
    return { allowed, policy }
  }

  const allowed = await consumeSlidingWindowMemory(storageKey, policy)
  return { allowed, policy }
}
