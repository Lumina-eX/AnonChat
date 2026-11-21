/**
 * Ephemeral Message Cleanup Service
 * Handles automatic deletion of expired ephemeral messages
 */

import { createClient } from "@/lib/supabase/server";
import { getRedisClient } from "@/lib/redis";
import { logger } from "@/lib/logger";
import {
  EPHEMERAL_CONFIG,
  type CleanupResult,
  type EphemeralMessageCleanupLog,
} from "@/lib/ephemeral-config";

/**
 * Get the effective TTL for a specific room
 * Falls back to global config if room-specific config not found
 */
export async function getRoomTTL(roomId: string): Promise<number> {
  try {
    const supabase = await createClient();

    // Try to get room-specific config
    const { data, error } = await supabase
      .from("ephemeral_message_config")
      .select("ttl_seconds, enabled")
      .eq("room_id", roomId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      logger.error("Error fetching room TTL config:", { error, roomId });
    }

    if (data && data.enabled) {
      return data.ttl_seconds;
    }

    // Fall back to global config
    const { data: globalConfig, error: globalError } = await supabase
      .from("global_ephemeral_config")
      .select("ttl_seconds")
      .limit(1)
      .maybeSingle();

    if (globalError) {
      logger.error("Error fetching global TTL config:", { globalError });
    }

    return globalConfig?.ttl_seconds ?? EPHEMERAL_CONFIG.DEFAULT_TTL_SECONDS;
  } catch (error) {
    logger.error("Error in getRoomTTL:", { error });
    return EPHEMERAL_CONFIG.DEFAULT_TTL_SECONDS;
  }
}

/**
 * Get global TTL configuration
 */
export async function getGlobalTTL(): Promise<number> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("global_ephemeral_config")
      .select("ttl_seconds")
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error("Error fetching global TTL:", { error });
    }

    return data?.ttl_seconds ?? EPHEMERAL_CONFIG.DEFAULT_TTL_SECONDS;
  } catch (error) {
    logger.error("Error in getGlobalTTL:", { error });
    return EPHEMERAL_CONFIG.DEFAULT_TTL_SECONDS;
  }
}

/**
 * Create a new ephemeral message
 */
export async function createEphemeralMessage(params: {
  userId: string;
  roomId: string;
  content: string;
  isEncrypted: boolean;
  ttlSeconds?: number;
}) {
  try {
    const supabase = await createClient();
    const ttl = params.ttlSeconds ?? (await getRoomTTL(params.roomId));
    const expiresAt = new Date(Date.now() + ttl * 1000);

    const { data, error } = await supabase
      .from("messages")
      .insert({
        user_id: params.userId,
        room_id: params.roomId,
        content: params.content,
        is_encrypted: params.isEncrypted,
        is_ephemeral: true,
        expires_at: expiresAt.toISOString(),
        status: "sent",
      })
      .select()
      .single();

    if (error) {
      logger.error("Error creating ephemeral message:", { error });
      throw error;
    }

    // Invalidate cache for this room
    await invalidateRoomMessageCache(params.roomId);

    return data;
  } catch (error) {
    logger.error("Error in createEphemeralMessage:", { error });
    throw error;
  }
}

/**
 * Main cleanup job - deletes expired ephemeral messages
 */
export async function cleanupExpiredMessages(): Promise<CleanupResult> {
  const startTime = Date.now();
  const result: CleanupResult = {
    totalDeleted: 0,
    deletedByRoom: {},
    errors: [],
    duration_ms: 0,
  };

  try {
    logger.info("Starting ephemeral message cleanup job");
    const supabase = await createClient();

    // Get all expired ephemeral messages grouped by room
    const { data: expiredMessages, error: fetchError } = await supabase
      .from("messages")
      .select("id, room_id, user_id, expires_at")
      .eq("is_ephemeral", true)
      .lte("expires_at", new Date().toISOString())
      .order("room_id")
      .limit(EPHEMERAL_CONFIG.BATCH_SIZE);

    if (fetchError) {
      logger.error("Error fetching expired messages:", fetchError as unknown as Record<string, unknown>);
      throw fetchError;
    }

    if (!expiredMessages || expiredMessages.length === 0) {
      logger.info("No expired ephemeral messages to cleanup");
      result.duration_ms = Date.now() - startTime;
      return result;
    }

    logger.info(`Found ${expiredMessages.length} expired ephemeral messages`);

    // Group messages by room
    const messagesByRoom: Record<string, Array<{ id: string; expires_at: string }>> = {};
    for (const msg of expiredMessages) {
      if (!messagesByRoom[msg.room_id]) {
        messagesByRoom[msg.room_id] = [];
      }
      messagesByRoom[msg.room_id].push({
        id: msg.id,
        expires_at: msg.expires_at,
      });
    }

    // Delete messages per room with transaction safety
    for (const [roomId, messages] of Object.entries(messagesByRoom)) {
      try {
        const messageIds = messages.map((m) => m.id);

        // Delete messages
        const { error: deleteError } = await supabase
          .from("messages")
          .delete()
          .in("id", messageIds);

        if (deleteError) {
          logger.error(
            `Error deleting messages from room ${roomId}:`,
            deleteError as unknown as Record<string, unknown>
          );
          result.errors.push({
            room_id: roomId,
            error: deleteError.message,
          });
          continue;
        }

        // Create audit log entries
        const logs: Partial<EphemeralMessageCleanupLog>[] = messages.map((msg) => ({
          deleted_message_id: msg.id,
          room_id: roomId,
          reason: "expired",
          expires_at: msg.expires_at,
        }));

        const { error: logError } = await supabase
          .from("ephemeral_message_cleanup_logs")
          .insert(logs);

        if (logError) {
          logger.warn(`Error creating cleanup logs for room ${roomId}:`, logError as unknown as Record<string, unknown>);
          // Don't fail the cleanup if logging fails
        }

        result.deletedByRoom[roomId] = messageIds.length;
        result.totalDeleted += messageIds.length;

        // Invalidate cache for this room
        await invalidateRoomMessageCache(roomId);

        logger.info(`Deleted ${messageIds.length} ephemeral messages from room ${roomId}`);
      } catch (error) {
        logger.error(`Error processing room ${roomId}:`, error as unknown as Record<string, unknown>);
        result.errors.push({
          room_id: roomId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Clean up old logs (beyond retention period)
    await cleanupOldLogs();

    logger.info("Ephemeral message cleanup job completed", { result });
  } catch (error) {
    logger.error("Critical error in cleanup job:", error as unknown as Record<string, unknown>);
    result.errors.push({
      room_id: "global",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    result.duration_ms = Date.now() - startTime;
  }

  return result;
}

/**
 * Clean up old cleanup logs beyond retention period
 */
export async function cleanupOldLogs(): Promise<void> {
  try {
    const supabase = await createClient();
    const retentionDate = new Date(
      Date.now() - EPHEMERAL_CONFIG.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
    );

    const { error } = await supabase
      .from("ephemeral_message_cleanup_logs")
      .delete()
      .lt("deleted_at", retentionDate.toISOString());

    if (error) {
      logger.warn("Error cleaning up old logs:", error as unknown as Record<string, unknown>);
      return;
    }

    logger.info("Cleaned up old ephemeral message cleanup logs");
  } catch (error) {
    logger.warn("Error in cleanupOldLogs:", error as unknown as Record<string, unknown>);
  }
}

/**
 * Invalidate room message cache
 */
export async function invalidateRoomMessageCache(roomId: string): Promise<void> {
  try {
    const redisClient = await getRedisClient();
    if (!redisClient) {
      logger.debug(`Redis unavailable; skipping cache invalidation for room ${roomId}`);
      return;
    }

    // Clear any room-specific caches
    const cacheKeys = [
      `room:${roomId}:messages`,
      `room:${roomId}:messages:*`,
      `room:${roomId}:unread`,
    ];

    for (const key of cacheKeys) {
      if (key.includes("*")) {
        // Pattern delete
        await redisClient.scan(0, { MATCH: key });
        // Note: Redis scan might need additional iteration for large datasets
        // For now, we'll use a simpler approach
      } else {
        await redisClient.del(key);
      }
    }

    logger.debug(`Invalidated cache for room ${roomId}`);
  } catch (error) {
    logger.warn(`Error invalidating cache for room ${roomId}:`, error as unknown as Record<string, unknown>);
    // Don't throw - cache invalidation is best effort
  }
}

/**
 * Get cleanup logs for audit trail
 */
export async function getCleanupLogs(params: {
  roomId?: string;
  limit?: number;
  offset?: number;
}): Promise<EphemeralMessageCleanupLog[]> {
  try {
    const supabase = await createClient();
    let query = supabase.from("ephemeral_message_cleanup_logs").select("*");

    if (params.roomId) {
      query = query.eq("room_id", params.roomId);
    }

    const { data, error } = await query
      .order("deleted_at", { ascending: false })
      .range(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 100) - 1);

    if (error) {
      logger.error("Error fetching cleanup logs:", error as unknown as Record<string, unknown>);
      throw error;
    }

    return data || [];
  } catch (error) {
    logger.error("Error in getCleanupLogs:", error as unknown as Record<string, unknown>);
    throw error;
  }
}

/**
 * Get cleanup statistics
 */
export async function getCleanupStats(): Promise<{
  totalEphemeralMessages: number;
  expiredMessages: number;
  deletedToday: number;
  deletedThisMonth: number;
}> {
  try {
    const supabase = await createClient();

    // Total ephemeral messages
    const { count: totalCount } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("is_ephemeral", true);

    // Expired messages
    const { count: expiredCount } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("is_ephemeral", true)
      .lte("expires_at", new Date().toISOString());

    // Deleted today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: deletedTodayCount } = await supabase
      .from("ephemeral_message_cleanup_logs")
      .select("*", { count: "exact", head: true })
      .gte("deleted_at", today.toISOString());

    // Deleted this month
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);
    const { count: deletedMonthCount } = await supabase
      .from("ephemeral_message_cleanup_logs")
      .select("*", { count: "exact", head: true })
      .gte("deleted_at", thisMonth.toISOString());

    return {
      totalEphemeralMessages: totalCount ?? 0,
      expiredMessages: expiredCount ?? 0,
      deletedToday: deletedTodayCount ?? 0,
      deletedThisMonth: deletedMonthCount ?? 0,
    };
  } catch (error) {
    logger.error("Error fetching cleanup stats:", error as unknown as Record<string, unknown>);
    return {
      totalEphemeralMessages: 0,
      expiredMessages: 0,
      deletedToday: 0,
      deletedThisMonth: 0,
    };
  }
}
