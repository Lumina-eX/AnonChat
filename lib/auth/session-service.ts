import { createAdminClient } from "@/lib/supabase/server";
import { getRedisClient } from "@/lib/redis";
import { createRefreshTokenId } from "@/lib/auth/wallet-jwt";
import {
  type SessionRecord,
  type CreateSessionInput,
  SESSION_TABLE,
  DEFAULT_SESSION_TTL_DAYS,
} from "@/lib/auth/session-types";
import { logger } from "@/lib/logger";

function sessionRedisKey(id: string): string {
  return `wallet_session:${id}`;
}

function walletSessionsRedisKey(walletAddress: string): string {
  return `wallet_sessions:${walletAddress}`;
}

export async function createSession(
  input: CreateSessionInput,
): Promise<SessionRecord> {
  const sessionId = createRefreshTokenId();
  const now = new Date().toISOString();

  const record: SessionRecord = {
    id: sessionId,
    wallet_address: input.walletAddress,
    refresh_token_jti: input.refreshTokenJti,
    created_at: now,
    expires_at: input.expiresAt.toISOString(),
    last_active_at: now,
    revoked_at: null,
  };

  const supabase = createAdminClient();
  const { error } = await supabase.from(SESSION_TABLE).insert(record);

  if (error) {
    logger.error("session.create_failed", {
      error: error.message,
      walletAddress: input.walletAddress,
    });
    throw new Error("Failed to create session");
  }

  const redis = await getRedisClient();
  if (redis) {
    const ttlSec = Math.floor(
      (input.expiresAt.getTime() - Date.now()) / 1000,
    );
    if (ttlSec > 0) {
      await redis.setEx(sessionRedisKey(sessionId), ttlSec, JSON.stringify(record));
      await redis.sAdd(walletSessionsRedisKey(input.walletAddress), sessionId);
    }
  }

  logger.info("session.created", {
    sessionId,
    walletAddress: input.walletAddress,
  });

  return record;
}

export async function getSession(
  sessionId: string,
): Promise<SessionRecord | null> {
  const redis = await getRedisClient();
  if (redis) {
    const cached = await redis.get(sessionRedisKey(sessionId));
    if (cached) {
      return JSON.parse(cached) as SessionRecord;
    }
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(SESSION_TABLE)
    .select("*")
    .eq("id", sessionId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as SessionRecord;
}

export async function validateSession(
  sessionId: string,
  walletAddress: string,
): Promise<{ valid: boolean; reason?: string }> {
  const session = await getSession(sessionId);

  if (!session) {
    return { valid: false, reason: "Session not found" };
  }

  if (session.wallet_address !== walletAddress) {
    return { valid: false, reason: "Session wallet mismatch" };
  }

  if (session.revoked_at) {
    return { valid: false, reason: "Session has been revoked" };
  }

  if (new Date(session.expires_at) < new Date()) {
    return { valid: false, reason: "Session has expired" };
  }

  return { valid: true };
}

export async function revokeSessionByJti(jti: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data: sessions, error: findError } = await supabase
    .from(SESSION_TABLE)
    .select("id")
    .eq("refresh_token_jti", jti)
    .is("revoked_at", null);

  if (findError || !sessions || sessions.length === 0) {
    return false;
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from(SESSION_TABLE)
    .update({ revoked_at: now })
    .eq("refresh_token_jti", jti)
    .is("revoked_at", null);

  if (error) {
    logger.error("session.revoke_by_jti_failed", {
      error: error.message,
      jti,
    });
    return false;
  }

  const redis = await getRedisClient();
  if (redis) {
    await Promise.all(
      sessions.map((s: { id: string }) => redis.del(sessionRedisKey(s.id))),
    );
  }

  logger.info("session.revoked_by_jti", { jti });
  return true;
}

export async function revokeSession(sessionId: string): Promise<boolean> {
  const now = new Date().toISOString();

  const supabase = createAdminClient();
  const { error } = await supabase
    .from(SESSION_TABLE)
    .update({ revoked_at: now })
    .eq("id", sessionId);

  if (error) {
    logger.error("session.revoke_failed", {
      error: error.message,
      sessionId,
    });
    return false;
  }

  const redis = await getRedisClient();
  if (redis) {
    await redis.del(sessionRedisKey(sessionId));
  }

  logger.info("session.revoked", { sessionId });
  return true;
}

export async function revokeAllSessions(
  walletAddress: string,
): Promise<number> {
  const now = new Date().toISOString();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(SESSION_TABLE)
    .update({ revoked_at: now })
    .eq("wallet_address", walletAddress)
    .is("revoked_at", null)
    .select("id");

  if (error) {
    logger.error("session.revoke_all_failed", {
      error: error.message,
      walletAddress,
    });
    return 0;
  }

  const redis = await getRedisClient();
  if (redis) {
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (ids.length > 0) {
      await Promise.all([
        ...ids.map((id: string) => redis.del(sessionRedisKey(id))),
        redis.del(walletSessionsRedisKey(walletAddress)),
      ]);
    }
  }

  logger.info("session.revoked_all", {
    walletAddress,
    count: (data ?? []).length,
  });

  return (data ?? []).length;
}

export async function getActiveSessions(
  walletAddress: string,
): Promise<SessionRecord[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(SESSION_TABLE)
    .select("*")
    .eq("wallet_address", walletAddress)
    .is("revoked_at", null)
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("session.list_active_failed", {
      error: error.message,
      walletAddress,
    });
    return [];
  }

  return (data ?? []) as SessionRecord[];
}

export async function cleanupExpiredSessions(): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(SESSION_TABLE)
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("id");

  if (error) {
    logger.error("session.cleanup_failed", {
      error: error.message,
    });
    return 0;
  }

  const ids = (data ?? []).map((r: { id: string }) => r.id);
  const count = ids.length;

  if (count > 0) {
    const redis = await getRedisClient();
    if (redis) {
      await Promise.all(ids.map((id: string) => redis.del(sessionRedisKey(id))));
    }
  }

  logger.info("session.cleanup_completed", { removedCount: count });
  return count;
}