#!/usr/bin/env node

/**
 * Ephemeral Message Cleanup Worker
 * ─────────────────────────────────
 * Runs the TTL-based message cleanup scheduler as a standalone Node.js process.
 * Mirrors the pattern used by scripts/start-ws-server.js.
 *
 * Usage:
 *   node scripts/start-cleanup-worker.js
 *
 * Environment variables (all optional):
 *   EPHEMERAL_CLEANUP_INTERVAL_MS   How often to run (default: 300000 = 5 min)
 *   EPHEMERAL_CLEANUP_BATCH_SIZE    Messages deleted per DB round-trip (default: 200)
 *   NEXT_PUBLIC_SUPABASE_URL        Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY       Service-role key (bypasses RLS for deletion)
 *
 * The worker requires ts-node or a compiled build.  In development, run via:
 *   npx ts-node --project tsconfig.json -e "require('./scripts/start-cleanup-worker.js')"
 * or use the npm script:
 *   npm run dev:cleanup
 */

// Register ts-node so we can import TypeScript modules directly in development.
// In production (after `next build`) the compiled JS is used instead.
try {
  require("ts-node").register({
    transpileOnly: true,
    compilerOptions: { module: "commonjs" },
  })
} catch {
  // ts-node not available — assume we're running compiled JS
}

// Path aliases (@/) are resolved via tsconfig-paths in development.
try {
  const tsConfigPaths = require("tsconfig-paths")
  const tsConfig = require("../tsconfig.json")
  const baseUrl = require("path").resolve(__dirname, "..")
  tsConfigPaths.register({ baseUrl, paths: tsConfig.compilerOptions?.paths ?? {} })
} catch {
  // tsconfig-paths not available — aliases must be resolved by the build tool
}

const { startCleanupScheduler, stopCleanupScheduler } = require("../lib/ephemeral/scheduler")

console.log("🧹 Starting ephemeral message cleanup worker...")

try {
  startCleanupScheduler(true)
  console.log("✅ Cleanup worker running. Press Ctrl+C to stop.")
} catch (err) {
  console.error("❌ Failed to start cleanup worker:", err)
  process.exit(1)
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`\n[cleanup-worker] Received ${signal} — shutting down gracefully...`)
  try {
    await stopCleanupScheduler()
    console.log("[cleanup-worker] Shutdown complete.")
  } catch (err) {
    console.error("[cleanup-worker] Error during shutdown:", err)
  }
  process.exit(0)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
