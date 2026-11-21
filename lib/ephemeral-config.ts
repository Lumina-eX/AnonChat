/**
 * Ephemeral message configuration constants and types
 */

export const EPHEMERAL_CONFIG = {
  /** Default TTL for ephemeral messages: 24 hours */
  DEFAULT_TTL_SECONDS: 24 * 60 * 60,
  
  /** Minimum TTL: 5 minutes */
  MIN_TTL_SECONDS: 5 * 60,
  
  /** Maximum TTL: 30 days */
  MAX_TTL_SECONDS: 30 * 24 * 60 * 60,
  
  /** Cleanup job interval: every 5 minutes */
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
  
  /** Batch size for cleanup operations */
  BATCH_SIZE: 100,
  
  /** Log retention: 90 days */
  LOG_RETENTION_DAYS: 90,
} as const;

export type EphemeralMessageConfig = {
  id: string;
  room_id: string;
  ttl_seconds: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type GlobalEphemeralConfig = {
  id: string;
  ttl_seconds: number;
  updated_at: string;
  updated_by: string | null;
};

export type EphemeralMessageCleanupLog = {
  id: string;
  deleted_message_id: string;
  room_id: string;
  deleted_at: string;
  user_id: string | null;
  expires_at: string | null;
  reason: 'expired' | 'manual_delete' | 'room_cleanup' | 'user_deletion';
};

export type CleanupResult = {
  totalDeleted: number;
  deletedByRoom: Record<string, number>;
  errors: Array<{ room_id: string; error: string }>;
  duration_ms: number;
};
