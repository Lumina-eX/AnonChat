#!/usr/bin/env node

/**
 * Manual cleanup trigger script
 * Useful for testing or manual maintenance
 * Usage: EPHEMERAL_CLEANUP_SECRET=your-secret node scripts/trigger-cleanup.mjs
 */

import fetch from "node-fetch";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const CLEANUP_SECRET = process.env.EPHEMERAL_CLEANUP_SECRET;

if (!CLEANUP_SECRET) {
  console.error(
    "Error: EPHEMERAL_CLEANUP_SECRET environment variable is required"
  );
  process.exit(1);
}

async function triggerCleanup() {
  try {
    console.log("🧹 Triggering ephemeral message cleanup...");

    const response = await fetch(`${API_BASE_URL}/api/ephemeral/cleanup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cleanup-Secret": CLEANUP_SECRET,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    console.log("\n✅ Cleanup completed:");
    console.log(`   Total deleted: ${result.result.totalDeleted}`);
    console.log(`   Duration: ${result.result.duration_ms}ms`);

    if (result.result.deletedByRoom && Object.keys(result.result.deletedByRoom).length > 0) {
      console.log("\n   Deleted by room:");
      for (const [roomId, count] of Object.entries(result.result.deletedByRoom)) {
        console.log(`     - ${roomId}: ${count} messages`);
      }
    }

    if (result.result.errors.length > 0) {
      console.log("\n⚠️  Errors occurred:");
      for (const error of result.result.errors) {
        console.log(`   - ${error.room_id}: ${error.error}`);
      }
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

triggerCleanup();
