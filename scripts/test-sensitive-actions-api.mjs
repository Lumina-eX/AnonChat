#!/usr/bin/env node
/**
 * Smoke test for wallet-protected sensitive action APIs.
 * Run with: node scripts/test-sensitive-actions-api.mjs [BASE_URL]
 * Default BASE_URL: http://localhost:3000
 * Requires the Next.js dev server to be running.
 */

const BASE = process.argv[2] || "http://localhost:3000";
const groupId = "test-group-" + Date.now();

async function request(method, path, body = null) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const opts = { method, headers: {} };
  if (body && (method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH")) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  return { status: res.status, json, text };
}

async function run() {
  let passed = 0;
  let failed = 0;

  function ok(condition, name) {
    if (condition) {
      passed++;
      console.log(`  ✓ ${name}`);
    } else {
      failed++;
      console.log(`  ✗ ${name}`);
    }
  }

  console.log("Testing wallet-protected sensitive actions at", BASE);
  console.log("");

  // DELETE group without auth -> 401
  const deleteNoAuth = await request("DELETE", `/api/groups/${groupId}`, {
    walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    signature: "0".repeat(128),
  });
  ok(deleteNoAuth.status === 401, "DELETE group without auth returns 401");

  // DELETE group without signature -> 400 or 401
  const deleteNoSig = await request("DELETE", `/api/groups/${groupId}`, {
    walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  });
  ok(
    deleteNoSig.status === 400 || deleteNoSig.status === 401,
    "DELETE group without signature returns 400 or 401",
  );

  // POST transfer-ownership without auth -> 401
  const transferNoAuth = await request(
    "POST",
    `/api/groups/${groupId}/transfer-ownership`,
    {
      walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      signature: "0".repeat(128),
      newOwnerWalletAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    },
  );
  ok(transferNoAuth.status === 401, "POST transfer-ownership without auth returns 401");

  // POST invite without auth -> 401
  const inviteNoAuth = await request("POST", `/api/groups/${groupId}/invite`, {
    walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    signature: "0".repeat(128),
  });
  ok(inviteNoAuth.status === 401, "POST invite without auth returns 401");

  // POST invite with invalid wallet -> 400 or 401
  const inviteBadWallet = await request("POST", `/api/groups/${groupId}/invite`, {
    walletAddress: "not-a-wallet",
    signature: "0".repeat(128),
  });
  ok(
    inviteBadWallet.status === 400 || inviteBadWallet.status === 401,
    "POST invite with invalid wallet returns 400 or 401",
  );

  console.log("");
  console.log(`Result: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  if (err.cause?.code === "ECONNREFUSED" || err.message?.includes("fetch")) {
    console.error("Cannot connect to server. Start the dev server first:");
    console.error("  pnpm dev");
    console.error("Then run: node scripts/test-sensitive-actions-api.mjs");
  } else {
    console.error("Test run failed:", err.message);
  }
  process.exit(1);
});
