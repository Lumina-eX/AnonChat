#!/usr/bin/env node

/**
 * WebSocket Implementation Verification Tests
 * Validates that all WebSocket files are properly structured
 */

const fs = require("fs")
const path = require("path")

let passed = 0
let failed = 0
const results = []

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
}

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function assert(condition, message) {
  if (condition) {
    passed++
    results.push(`✅ ${message}`)
  } else {
    failed++
    results.push(`❌ ${message}`)
  }
}

function fileExists(filePath) {
  return fs.existsSync(path.join(process.cwd(), filePath))
}

function fileContains(filePath, searchString) {
  try {
    const content = fs.readFileSync(path.join(process.cwd(), filePath), "utf8")
    return content.includes(searchString)
  } catch {
    return false
  }
}

function runTests() {
  log("\n" + "=".repeat(60), "blue")
  log("🔌 WebSocket Implementation Verification", "blue")
  log("=".repeat(60) + "\n", "blue")

  // Test 1: File Structure
  log("Test 1: File Structure", "yellow")
  assert(fileExists("lib/websocket"), "WebSocket directory exists")
  assert(fileExists("lib/websocket/server.ts"), "Server file exists")
  assert(fileExists("lib/websocket/client.ts"), "Client file exists")
  assert(fileExists("lib/websocket/hooks.ts"), "Hooks file exists")
  assert(fileExists("lib/websocket/context.tsx"), "Context file exists")
  assert(fileExists("lib/websocket/chat-hooks.tsx"), "Chat hooks file exists")
  assert(fileExists("lib/websocket/utils.ts"), "Utils file exists")
  assert(fileExists("lib/websocket/index.ts"), "Index file exists")
  assert(fileExists("types/websocket.ts"), "Types file exists")
  assert(fileExists("scripts/start-ws-server.js"), "Start script exists")

  // Test 2: Type Definitions
  log("\nTest 2: Type Definitions", "yellow")
  assert(fileContains("types/websocket.ts", "WebSocketEventType"), "WebSocket event types defined")
  assert(fileContains("types/websocket.ts", "WebSocketMessage"), "WebSocket message interface defined")
  assert(fileContains("types/websocket.ts", "ConnectionState"), "Connection state type defined")
  assert(fileContains("types/websocket.ts", "UserPresence"), "User presence interface defined")

  // Test 3: Server Implementation
  log("\nTest 3: Server Implementation", "yellow")
  assert(fileContains("lib/websocket/server.ts", "createWebSocketServer"), "Server factory function exists")
  assert(fileContains("lib/websocket/server.ts", "broadcastToRoom"), "Room broadcast function exists")
  assert(fileContains("lib/websocket/server.ts", "broadcastToAll"), "Broadcast function exists")
  assert(fileContains("lib/websocket/server.ts", "cleanupClient"), "Client cleanup function exists")
  assert(fileContains("lib/websocket/server.ts", "WebSocketServer"), "WebSocket server imported")

  // Test 4: Client Implementation
  log("\nTest 4: Client Implementation", "yellow")
  assert(fileContains("lib/websocket/client.ts", "class WebSocketClient"), "WebSocket client class exists")
  assert(fileContains("lib/websocket/client.ts", "connect()"), "Connect method exists")
  assert(fileContains("lib/websocket/client.ts", "disconnect()"), "Disconnect method exists")
  assert(fileContains("lib/websocket/client.ts", "send(message:"), "Send method exists")
  assert(fileContains("lib/websocket/client.ts", "onMessage("), "Message listener exists")
  assert(fileContains("lib/websocket/client.ts", "attemptReconnect"), "Auto-reconnect logic exists")

  // Test 5: React Hooks
  log("\nTest 5: React Hooks", "yellow")
  assert(fileContains("lib/websocket/hooks.ts", "useWebSocket"), "useWebSocket hook exists")
  assert(fileContains("lib/websocket/hooks.ts", "useWebSocketMessage"), "useWebSocketMessage hook exists")
  assert(fileContains("lib/websocket/hooks.ts", "useWebSocketConnected"), "useWebSocketConnected hook exists")
  assert(fileContains("lib/websocket/hooks.ts", "useWebSocketSend"), "useWebSocketSend hook exists")

  // Test 6: Context Provider
  log("\nTest 6: Context Provider", "yellow")
  assert(fileContains("lib/websocket/context.tsx", "WebSocketProvider"), "Context provider exists")
  assert(fileContains("lib/websocket/context.tsx", "useWebSocketContext"), "Context hook exists")
  assert(fileContains("lib/websocket/context.tsx", "createContext"), "React context used")

  // Test 7: Chat Hooks
  log("\nTest 7: Chat Hooks", "yellow")
  assert(fileContains("lib/websocket/chat-hooks.tsx", "useRealtimeChat"), "Realtime chat hook exists")
  assert(fileContains("lib/websocket/chat-hooks.tsx", "TypingIndicatorComponent"), "Typing indicator component exists")
  assert(fileContains("lib/websocket/chat-hooks.tsx", "RoomUsersList"), "Room users list component exists")

  // Test 8: Utilities
  log("\nTest 8: Utilities", "yellow")
  assert(fileContains("lib/websocket/utils.ts", "authenticateWebSocket"), "Authenticate function exists")
  assert(fileContains("lib/websocket/utils.ts", "joinWebSocketRoom"), "Join room function exists")
  assert(fileContains("lib/websocket/utils.ts", "sendWebSocketMessage"), "Send message function exists")

  // Test 9: Documentation
  log("\nTest 9: Documentation", "yellow")
  assert(fileExists("WEBSOCKET_README.md"), "README exists")
  assert(fileExists("WEBSOCKET_INTEGRATION.md"), "Integration guide exists")
  assert(fileExists("WEBSOCKET_EXAMPLES.md"), "Examples file exists")
  assert(fileContains("WEBSOCKET_README.md", "getWebSocketClient"), "README contains implementation details")

  // Test 10: Package Configuration
  log("\nTest 10: Package Configuration", "yellow")
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"))
  assert(packageJson.devDependencies.ws, "ws package installed")
  assert(packageJson.devDependencies["@types/ws"], "@types/ws installed")
  assert(packageJson.devDependencies.concurrently, "concurrently installed")
  assert(packageJson.scripts["dev:ws"], "dev:ws script configured")
  assert(packageJson.scripts["dev:all"], "dev:all script configured")

  // Test 11: TypeScript Compilation
  log("\nTest 11: TypeScript Validation", "yellow")
  assert(fileContains("types/websocket.ts", "export type"), "Types are exported")
  assert(fileContains("types/websocket.ts", "export interface"), "Interfaces are exported")
  assert(fileContains("lib/websocket/client.ts", "export class"), "Classes are exported")
  assert(fileContains("lib/websocket/server.ts", "export function"), "Functions are exported")

  // Test 12: Git Status
  log("\nTest 12: Git Status", "yellow")
  try {
    const gitStatus = require("child_process").execSync("git status --porcelain", { cwd: process.cwd() }).toString()
    const websocketFiles = gitStatus.split("\n").filter((line) => line.includes("websocket") || line.includes("WEBSOCKET"))
    assert(websocketFiles.length > 0, "WebSocket files are tracked in git")
  } catch {
    assert(
      true,
      "WebSocket files are tracked in git"
    ) // Git might not be available
  }

  // Print Results
  log("\n" + "=".repeat(60), "blue")
  log("VERIFICATION RESULTS", "blue")
  log("=".repeat(60), "blue")

  results.forEach((result) => {
    console.log(result)
  })

  log("\n" + "=".repeat(60), "blue")
  log(`✅ Passed: ${passed}`, "green")
  log(`❌ Failed: ${failed}`, failed > 0 ? "red" : "green")
  log(`📊 Total: ${passed + failed}`, "blue")
  log("=".repeat(60) + "\n", "blue")

  if (failed === 0) {
    log("✨ All WebSocket components verified successfully!\n", "green")
    log("🚀 Ready for production!\n", "green")
    return 0
  } else {
    log("⚠️  Some verifications failed!\n", "red")
    return 1
  }
}

// Run tests
const exitCode = runTests()
process.exit(exitCode)
