#!/usr/bin/env node

/**
 * Test script for ephemeral message cleanup functionality
 * Usage: node scripts/test-ephemeral-cleanup.mjs
 */

import fetch from "node-fetch";
import chalk from "chalk";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const CLEANUP_SECRET = process.env.EPHEMERAL_CLEANUP_SECRET || "test-secret";

const log = {
  info: (msg) => console.log(chalk.blue("ℹ"), msg),
  success: (msg) => console.log(chalk.green("✓"), msg),
  error: (msg) => console.log(chalk.red("✗"), msg),
  warning: (msg) => console.log(chalk.yellow("⚠"), msg),
  section: (msg) => console.log(chalk.cyan(`\n### ${msg}`)),
};

async function testEphemeralCleanup() {
  log.section("Testing Ephemeral Message Cleanup");

  try {
    // Test 1: Get config
    log.info("Test 1: Fetching global config...");
    const configRes = await fetch(`${API_BASE_URL}/api/ephemeral/config`);
    if (!configRes.ok) {
      log.error(`Failed to fetch config: ${configRes.status}`);
      return;
    }
    const config = await configRes.json();
    log.success(`Global config: ${JSON.stringify(config.global)}`);

    // Test 2: Get cleanup stats
    log.info("Test 2: Fetching cleanup statistics...");
    const statsRes = await fetch(`${API_BASE_URL}/api/ephemeral/cleanup`);
    if (!statsRes.ok) {
      log.error(`Failed to fetch stats: ${statsRes.status}`);
      return;
    }
    const stats = await statsRes.json();
    log.success(`Cleanup stats: ${JSON.stringify(stats.stats)}`);

    // Test 3: Get cleanup logs
    log.info("Test 3: Fetching cleanup logs...");
    const logsRes = await fetch(`${API_BASE_URL}/api/ephemeral/cleanup?action=logs&limit=10`);
    if (!logsRes.ok) {
      log.error(`Failed to fetch logs: ${logsRes.status}`);
      return;
    }
    const logs = await logsRes.json();
    log.success(`Found ${logs.logs.length} cleanup logs`);

    // Test 4: Trigger cleanup (requires secret)
    log.info("Test 4: Triggering cleanup job...");
    const cleanupRes = await fetch(`${API_BASE_URL}/api/ephemeral/cleanup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cleanup-Secret": CLEANUP_SECRET,
      },
    });

    if (!cleanupRes.ok) {
      log.warning(`Cleanup trigger returned: ${cleanupRes.status}`);
      log.info("(This is expected if EPHEMERAL_CLEANUP_SECRET is not configured)");
    } else {
      const cleanupResult = await cleanupRes.json();
      log.success(
        `Cleanup triggered: ${cleanupResult.result.totalDeleted} messages deleted`
      );
    }

    log.success("\n✅ All tests completed!");
  } catch (error) {
    log.error(`Test failed: ${error.message}`);
    process.exit(1);
  }
}

testEphemeralCleanup();
