export const CONFIG = {
  EXPERIMENTAL_REPUTATION_ENABLED: true,

  /**
   * Ephemeral message TTL defaults.
   * These are the compile-time fallbacks; runtime values are managed by
   * lib/ephemeral/config.ts which reads from environment variables.
   */
  EPHEMERAL: {
    /** Default TTL in seconds (24 hours). Override with EPHEMERAL_TTL_SECONDS env var. */
    DEFAULT_TTL_SECONDS: 86_400,
    /** Cleanup scheduler interval in ms (5 minutes). Override with EPHEMERAL_CLEANUP_INTERVAL_MS. */
    CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
    /** Rows deleted per DB batch. Override with EPHEMERAL_CLEANUP_BATCH_SIZE. */
    BATCH_SIZE: 200,
  },
};
