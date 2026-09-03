import { getRedisClient } from "@/lib/redis";
import { logger } from "@/lib/logger";

export interface SessionRecord {
  sessionId: string;
  walletAddress: string;
  createdAt: number;
  lastActivityAt: number;
  userAgent?: string;
  ipAddress?: string;
}

const DEFAULT_SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
const SESSION_CLEANUP_SCAN_COUNT = 100;

function getSessionTTLSec(): number {
  const env = process.env.SESSION_TTL_SECONDS;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_SESSION_TTL_SEC;
}

function sessionKey(sessionId: string): string {
  return `session:${sessionId}`;
}

function walletSessionsKey(walletAddress: string): string {
  return `wallet_sessions:${walletAddress.toLowerCase()}`;
}

function normalizeWallet(walletAddress: string): string {
  return walletAddress.toLowerCase();
}

/** Create a new session for a wallet. Returns the sessionId. */
export async function createSession(params: {
  walletAddress: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<string> {
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const ttlSec = getSessionTTLSec();

  const record: SessionRecord = {
    sessionId,
    walletAddress: normalizeWallet(params.walletAddress),
    createdAt: now,
    lastActivityAt: now,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  };

  const redis = await getRedisClient();

  if (redis) {
    await redis.set(sessionKey(sessionId), JSON.stringify(record), { EX: ttlSec });
    await redis.sAdd(walletSessionsKey(params.walletAddress), sessionId);
    await redis.expire(walletSessionsKey(params.walletAddress), ttlSec);
  } else {
    memorySessions.set(sessionId, { record, expiresAt: Date.now() + ttlSec * 1000 });
    const walletSet = memoryWalletSessions.get(normalizeWallet(params.walletAddress)) ?? new Set();
    walletSet.add(sessionId);
    memoryWalletSessions.set(normalizeWallet(params.walletAddress), walletSet);
  }

  logger.info("Session created", {
    sessionId,
    walletAddress: params.walletAddress.substring(0, 8) + "...",
  });

  return sessionId;
}

/** Validate that a session exists and is active. Updates lastActivityAt. */
export async function validateSession(
  sessionId: string,
): Promise<SessionRecord | null> {
  const redis = await getRedisClient();

  if (redis) {
    const raw = await redis.get(sessionKey(sessionId));
    if (!raw) return null;

    let record: SessionRecord;
    try {
      record = JSON.parse(raw);
    } catch {
      return null;
    }

    record.lastActivityAt = Date.now();
    const ttlSec = getSessionTTLSec();
    await redis.set(sessionKey(sessionId), JSON.stringify(record), { EX: ttlSec });

    return record;
  }

  const entry = memorySessions.get(sessionId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memorySessions.delete(sessionId);
    return null;
  }

  entry.record.lastActivityAt = Date.now();
  const ttlSec = getSessionTTLSec();
  entry.expiresAt = Date.now() + ttlSec * 1000;

  return entry.record;
}

/** Terminate a specific session. */
export async function terminateSession(
  sessionId: string,
  walletAddress: string,
): Promise<boolean> {
  const redis = await getRedisClient();

  if (redis) {
    const raw = await redis.get(sessionKey(sessionId));
    if (!raw) return false;

    let record: SessionRecord;
    try {
      record = JSON.parse(raw);
    } catch {
      return false;
    }

    if (record.walletAddress !== normalizeWallet(walletAddress)) {
      return false;
    }

    await redis.del(sessionKey(sessionId));
    await redis.sRem(walletSessionsKey(walletAddress), sessionId);

    logger.info("Session terminated", {
      sessionId,
      walletAddress: walletAddress.substring(0, 8) + "...",
    });
    return true;
  }

  const entry = memorySessions.get(sessionId);
  if (!entry) return false;
  if (entry.record.walletAddress !== normalizeWallet(walletAddress)) {
    return false;
  }

  memorySessions.delete(sessionId);
  const walletSet = memoryWalletSessions.get(normalizeWallet(walletAddress));
  if (walletSet) {
    walletSet.delete(sessionId);
  }

  logger.info("Session terminated", {
    sessionId,
    walletAddress: walletAddress.substring(0, 8) + "...",
  });
  return true;
}

/** Terminate all sessions for a wallet (logout everywhere). */
export async function terminateAllSessions(
  walletAddress: string,
  excludeSessionId?: string,
): Promise<number> {
  const normalized = normalizeWallet(walletAddress);
  const redis = await getRedisClient();

  if (redis) {
    const sessionIds = await redis.sMembers(walletSessionsKey(normalized));
    let count = 0;

    for (const sid of sessionIds) {
      if (excludeSessionId && sid === excludeSessionId) continue;
      await redis.del(sessionKey(sid));
      await redis.sRem(walletSessionsKey(normalized), sid);
      count++;
    }

    if (count > 0) {
      logger.info("All sessions terminated", {
        walletAddress: walletAddress.substring(0, 8) + "...",
        count,
      });
    }
    return count;
  }

  const walletSet = memoryWalletSessions.get(normalized);
  if (!walletSet) return 0;

  let count = 0;
  for (const sid of Array.from(walletSet)) {
    if (excludeSessionId && sid === excludeSessionId) continue;
    memorySessions.delete(sid);
    walletSet.delete(sid);
    count++;
  }

  if (count > 0) {
    logger.info("All sessions terminated", {
      walletAddress: walletAddress.substring(0, 8) + "...",
      count,
    });
  }
  return count;
}

/** List all active sessions for a wallet. */
export async function listSessions(
  walletAddress: string,
): Promise<SessionRecord[]> {
  const normalized = normalizeWallet(walletAddress);
  const redis = await getRedisClient();

  if (redis) {
    const sessionIds = await redis.sMembers(walletSessionsKey(normalized));
    if (sessionIds.length === 0) return [];

    const sessions: SessionRecord[] = [];
    for (const sid of sessionIds) {
      const raw = await redis.get(sessionKey(sid));
      if (!raw) {
        await redis.sRem(walletSessionsKey(normalized), sid);
        continue;
      }
      try {
        sessions.push(JSON.parse(raw));
      } catch {
        await redis.del(sessionKey(sid));
        await redis.sRem(walletSessionsKey(normalized), sid);
      }
    }

    return sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  const walletSet = memoryWalletSessions.get(normalized);
  if (!walletSet) return [];

  const sessions: SessionRecord[] = [];
  for (const sid of walletSet) {
    const entry = memorySessions.get(sid);
    if (!entry) {
      walletSet.delete(sid);
      continue;
    }
    if (Date.now() > entry.expiresAt) {
      memorySessions.delete(sid);
      walletSet.delete(sid);
      continue;
    }
    sessions.push(entry.record);
  }

  return sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/** Clean up expired sessions from in-memory store. */
export async function cleanupExpiredSessions(): Promise<number> {
  const redis = await getRedisClient();

  if (redis) {
    let cleaned = 0;
    let cursor = 0;

    do {
      const result = await redis.scan(cursor, {
        MATCH: "session:*",
        COUNT: SESSION_CLEANUP_SCAN_COUNT,
      });

      for (const key of result.keys) {
        const ttl = await redis.ttl(key);
        if (ttl === -2) {
          cleaned++;
        }
      }

      cursor = result.cursor;
    } while (cursor !== 0);

    return cleaned;
  }

  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, entry] of memorySessions) {
    if (now > entry.expiresAt) {
      memorySessions.delete(sessionId);
      const walletSet = memoryWalletSessions.get(entry.record.walletAddress);
      if (walletSet) walletSet.delete(sessionId);
      cleaned++;
    }
  }

  return cleaned;
}

// In-memory fallback stores (when Redis is unavailable)
const memorySessions = new Map<string, { record: SessionRecord; expiresAt: number }>();
const memoryWalletSessions = new Map<string, Set<string>>();

/** Clear all in-memory session data. Intended for testing only. */
export async function clearAllSessions(): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) {
    memorySessions.clear();
    memoryWalletSessions.clear();
    return;
  }
  // When using Redis we cannot safely wipe everything, so this is a no-op.
}
