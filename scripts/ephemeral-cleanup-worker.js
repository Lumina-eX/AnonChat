#!/usr/bin/env node

/**
 * Ephemeral Message Cleanup Worker
 * Run this as a separate Node.js process for local development or alternative deployments
 * 
 * Usage: node scripts/ephemeral-cleanup-worker.js
 * Or: npm run cleanup:worker
 * 
 * Environment variables:
 * - CLEANUP_INTERVAL: Interval in minutes (default: 5)
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY: Supabase service role key
 */

import cron from "node-cron";

// This will be resolved at runtime after build
const { cleanupExpiredMessages } = await import("../lib/ephemeral-cleanup.ts");
const { logger } = await import("../lib/logger.ts");

const CLEANUP_INTERVAL = process.env.CLEANUP_INTERVAL || "5"; // minutes
const cronExpression = `*/${CLEANUP_INTERVAL} * * * *`; // Every N minutes

logger.info("🧹 Ephemeral Message Cleanup Worker Starting", {
  interval: `${CLEANUP_INTERVAL} minutes`,
  cronExpression,
});

// Schedule the cleanup job
const cleanupJob = cron.schedule(cronExpression, async () => {
  try {
    logger.info("⏰ Running scheduled cleanup job");
    const result = await cleanupExpiredMessages();

    if (result.totalDeleted > 0 || result.errors.length > 0) {
      logger.info("✅ Cleanup job completed", result);
    } else {
      logger.debug("✓ Cleanup job completed - no expired messages");
    }
  } catch (error) {
    logger.error("❌ Cleanup job failed:", error);
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down cleanup worker");
  cleanupJob.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down cleanup worker");
  cleanupJob.stop();
  process.exit(0);
});

logger.info("✅ Cleanup worker is running. Press Ctrl+C to stop.");
