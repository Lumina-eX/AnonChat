import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { invalidateRoomMessageCache } from "@/lib/ephemeral-cleanup";
import { EPHEMERAL_CONFIG } from "@/lib/ephemeral-config";

export const MESSAGE_RETENTION = {
  MIN_SECONDS: 5 * 60,
  MAX_SECONDS: 30 * 24 * 60 * 60,
  BATCH_SIZE: EPHEMERAL_CONFIG.BATCH_SIZE,
} as const;

export type RetentionCleanupResult = {
  scanned: number;
  deleted: number;
  failed: number;
  duration_ms: number;
};

export async function cleanupExpiredRetentionMessages(): Promise<RetentionCleanupResult> {
  const startedAt = Date.now();
  const result: RetentionCleanupResult = {
    scanned: 0,
    deleted: 0,
    failed: 0,
    duration_ms: 0,
  };
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { data: expiredMessages, error: fetchError } = await supabase
    .from("messages")
    .select("id, room_id")
    .not("retention_expires_at", "is", null)
    .lte("retention_expires_at", now)
    .order("retention_expires_at", { ascending: true })
    .limit(MESSAGE_RETENTION.BATCH_SIZE);

  if (fetchError) {
    logger.error("Failed to scan expired retention messages", { error: fetchError });
    throw fetchError;
  }

  for (const message of expiredMessages ?? []) {
    result.scanned += 1;

    const { data, error } = await supabase.rpc(
      "delete_expired_retention_message",
      { p_message_id: message.id },
    );

    if (error) {
      result.failed += 1;
      logger.error("Retention message cleanup failed", {
        messageId: message.id,
        roomId: message.room_id,
        error,
      });

      const { error: retryError } = await supabase.rpc(
        "record_message_retention_cleanup_retry",
        {
          p_message_id: message.id,
          p_room_id: message.room_id,
          p_error: error.message,
        },
      );

      if (retryError) {
        logger.error("Failed to persist retention cleanup retry record", {
          messageId: message.id,
          error: retryError,
        });
      }
      continue;
    }

    const deletedRooms = (data ?? []) as Array<{ room_id: string }>;
    if (deletedRooms.length > 0) {
      result.deleted += 1;
      await invalidateRoomMessageCache(deletedRooms[0].room_id);
    }
  }

  result.duration_ms = Date.now() - startedAt;
  logger.info("Message retention cleanup completed", { result });
  return result;
}

export function applyActiveMessageFilters<T extends {
  or: (filters: string) => T;
}>(query: T, now: string): T {
  return query
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .or(`retention_expires_at.is.null,retention_expires_at.gt.${now}`);
}
