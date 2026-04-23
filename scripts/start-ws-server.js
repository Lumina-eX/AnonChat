#!/usr/bin/env node

/**
 * WebSocket Server Startup Script
 * This script runs the WebSocket server alongside the Next.js dev server
 * 
 * Usage: node scripts/start-ws-server.js
 */

const { createWebSocketServer } = require("../lib/websocket/server")

const WS_PORT = process.env.WS_PORT || 3001

try {
  console.log("Starting WebSocket server...")
  createWebSocketServer(Number(WS_PORT))
  console.log(`✅ WebSocket server ready on ws://localhost:${WS_PORT}`)
} catch (error) {
  console.error("❌ Failed to start WebSocket server:", error)
  process.exit(1)
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down WebSocket server...")
  process.exit(0)
})

process.on("SIGTERM", () => {
  console.log("\nShutting down WebSocket server...")
  process.exit(0)
})
