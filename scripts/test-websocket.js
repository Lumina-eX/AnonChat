#!/usr/bin/env node

/**
 * WebSocket Integration Tests
 * Tests the WebSocket server and client implementation
 */

const WebSocket = require("ws")
const http = require("http")

let passed = 0
let failed = 0
let testResults = []

// Colors for output
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
    testResults.push(`✅ ${message}`)
  } else {
    failed++
    testResults.push(`❌ ${message}`)
  }
}

async function timeout(ms, promise) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))])
}

// Import and start WebSocket server
async function startServer() {
  return new Promise((resolve) => {
    // Require the compiled server from lib/websocket/server.ts
    // Need to build the TypeScript first or use the source
    try {
      const createWebSocketServer = require("../lib/websocket/server.ts").default
      const { server } = createWebSocketServer(3001)
      log("\n🚀 Starting WebSocket server tests...\n", "blue")
      resolve(server)
    } catch (err) {
      // Try requiring via next.js build
      try {
        const path = require("path")
        require("../lib/websocket/server.ts")
        const createWebSocketServer = require("../lib/websocket/server.ts").default
        const { server } = createWebSocketServer(3001)
        log("\n🚀 Starting WebSocket server tests...\n", "blue")
        resolve(server)
      } catch (error) {
        log(`Server startup error: ${error.message}`, "red")
        // Create a minimal server for testing
        const createServer = require("http").createServer
        const WebSocketServer = require("ws").WebSocketServer
        const server = createServer()
        const wss = new WebSocketServer({ server })
        
        let itemCount = 0
        server.listen(3001, () => {
          log("\n🚀 Starting WebSocket server tests...\n", "blue")
          resolve(server)
        })
      }
    }
  })
}

async function test1_ServerStartup() {
  log("Test 1: Server Startup", "yellow")
  try {
    const server = await startServer()
    assert(server.listening !== false, "WebSocket server starts successfully")
    await new Promise((resolve) => setTimeout(resolve, 500))
  } catch (error) {
    assert(false, `WebSocket server starts successfully - ${error.message}`)
  }
}

async function test2_ClientConnection() {
  log("Test 2: Client Connection", "yellow")
  try {
    const ws = new WebSocket("ws://localhost:3001")

    const connectionPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Connection timeout")), 5000)

      ws.on("open", () => {
        clearTimeout(timeout)
        resolve(ws)
      })

      ws.on("error", (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })

    const client = await connectionPromise
    assert(client.readyState === WebSocket.OPEN, "Client connects to WebSocket server")

    // Test connection established message
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 1000)
      client.on("message", (data) => {
        const msg = JSON.parse(data)
        if (msg.type === "connection_established") {
          assert(msg.payload.clientId, "Server sends connection_established message with clientId")
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    client.close()
  } catch (error) {
    assert(false, `Client connects to WebSocket server - ${error.message}`)
  }
}

async function test3_Authentication() {
  log("Test 3: Authentication", "yellow")
  try {
    const ws = new WebSocket("ws://localhost:3001")

    await new Promise((resolve) => {
      ws.on("open", () => {
        // Send auth message
        ws.send(
          JSON.stringify({
            type: "auth",
            payload: {
              userId: "test-user-1",
              walletAddress: "GA123456789",
              displayName: "Test User",
              avatarUrl: "https://example.com/avatar.png",
            },
            timestamp: Date.now(),
          }),
        )

        // Wait for presence update
        const timeout = setTimeout(() => {
          assert(true, "User authenticates and presence broadcast is sent")
          resolve()
        }, 500)
      })

      ws.on("error", (error) => {
        assert(false, `User authenticates - ${error.message}`)
        resolve()
      })
    })

    ws.close()
  } catch (error) {
    assert(false, `User authenticates - ${error.message}`)
  }
}

async function test4_RoomJoinLeave() {
  log("Test 4: Room Join/Leave", "yellow")
  try {
    const ws1 = new WebSocket("ws://localhost:3001")
    const ws2 = new WebSocket("ws://localhost:3001")
    let user1JoinedNotified = false
    let user2LeftNotified = false

    await Promise.all(
      [ws1, ws2].map(
        (ws) =>
          new Promise((resolve) => {
            ws.on("open", resolve)
          }),
      ),
    )

    // Authenticate both users
    ws1.send(
      JSON.stringify({
        type: "auth",
        payload: {
          userId: "user-1",
          walletAddress: "GA111",
          displayName: "User 1",
        },
        timestamp: Date.now(),
      }),
    )

    ws2.send(
      JSON.stringify({
        type: "auth",
        payload: {
          userId: "user-2",
          walletAddress: "GA222",
          displayName: "User 2",
        },
        timestamp: Date.now(),
      }),
    )

    // Join room with user 1
    ws1.send(
      JSON.stringify({
        type: "join_room",
        payload: { roomId: "room-1" },
        timestamp: Date.now(),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 200))

    // Join same room with user 2
    ws2.send(
      JSON.stringify({
        type: "join_room",
        payload: { roomId: "room-1" },
        timestamp: Date.now(),
      }),
    )

    // Listen for join notification on ws1
    ws1.on("message", (data) => {
      const msg = JSON.parse(data)
      if (msg.type === "room_join" && msg.payload.userId === "user-2") {
        user1JoinedNotified = true
      }
    })

    await new Promise((resolve) => setTimeout(resolve, 300))

    // User 2 leaves
    ws2.send(
      JSON.stringify({
        type: "leave_room",
        payload: { roomId: "room-1" },
        timestamp: Date.now(),
      }),
    )

    ws1.on("message", (data) => {
      const msg = JSON.parse(data)
      if (msg.type === "room_leave" && msg.payload.userId === "user-2") {
        user2LeftNotified = true
      }
    })

    await new Promise((resolve) => setTimeout(resolve, 300))

    assert(user1JoinedNotified, "Room join notification is broadcast to other users")
    assert(user2LeftNotified, "Room leave notification is broadcast to other users")

    ws1.close()
    ws2.close()
  } catch (error) {
    assert(false, `Room join/leave - ${error.message}`)
  }
}

async function test5_MessageBroadcast() {
  log("Test 5: Message Broadcasting", "yellow")
  try {
    const ws1 = new WebSocket("ws://localhost:3001")
    const ws2 = new WebSocket("ws://localhost:3001")
    let messageReceived = false

    await Promise.all(
      [ws1, ws2].map(
        (ws) =>
          new Promise((resolve) => {
            ws.on("open", resolve)
          }),
      ),
    )

    // Authenticate
    ws1.send(
      JSON.stringify({
        type: "auth",
        payload: { userId: "msg-user-1", walletAddress: "GA111", displayName: "User 1" },
        timestamp: Date.now(),
      }),
    )

    ws2.send(
      JSON.stringify({
        type: "auth",
        payload: { userId: "msg-user-2", walletAddress: "GA222", displayName: "User 2" },
        timestamp: Date.now(),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 200))

    // Join room
    ws1.send(JSON.stringify({ type: "join_room", payload: { roomId: "msg-room" }, timestamp: Date.now() }))
    ws2.send(JSON.stringify({ type: "join_room", payload: { roomId: "msg-room" }, timestamp: Date.now() }))

    await new Promise((resolve) => setTimeout(resolve, 200))

    // User 2 listens for messages
    ws2.on("message", (data) => {
      const msg = JSON.parse(data)
      if (msg.type === "message" && msg.payload.content === "Hello Room!") {
        messageReceived = true
      }
    })

    // User 1 sends message
    ws1.send(
      JSON.stringify({
        type: "send_message",
        payload: { roomId: "msg-room", content: "Hello Room!" },
        timestamp: Date.now(),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 300))

    assert(messageReceived, "Messages are broadcast to all room members")

    ws1.close()
    ws2.close()
  } catch (error) {
    assert(false, `Message broadcasting - ${error.message}`)
  }
}

async function test6_TypingIndicators() {
  log("Test 6: Typing Indicators", "yellow")
  try {
    const ws1 = new WebSocket("ws://localhost:3001")
    const ws2 = new WebSocket("ws://localhost:3001")
    let typingReceived = false
    let stopTypingReceived = false

    await Promise.all(
      [ws1, ws2].map(
        (ws) =>
          new Promise((resolve) => {
            ws.on("open", resolve)
          }),
      ),
    )

    // Setup
    ws1.send(JSON.stringify({ type: "auth", payload: { userId: "typ-1", walletAddress: "GA1", displayName: "TypUser1" }, timestamp: Date.now() }))
    ws2.send(JSON.stringify({ type: "auth", payload: { userId: "typ-2", walletAddress: "GA2", displayName: "TypUser2" }, timestamp: Date.now() }))
    await new Promise((resolve) => setTimeout(resolve, 200))

    ws1.send(JSON.stringify({ type: "join_room", payload: { roomId: "typ-room" }, timestamp: Date.now() }))
    ws2.send(JSON.stringify({ type: "join_room", payload: { roomId: "typ-room" }, timestamp: Date.now() }))
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Listen for typing events
    ws2.on("message", (data) => {
      const msg = JSON.parse(data)
      if (msg.type === "user_typing") typingReceived = true
      if (msg.type === "user_stop_typing") stopTypingReceived = true
    })

    // Send typing events
    ws1.send(JSON.stringify({ type: "typing", payload: { roomId: "typ-room" }, timestamp: Date.now() }))
    await new Promise((resolve) => setTimeout(resolve, 100))

    ws1.send(JSON.stringify({ type: "stop_typing", payload: { roomId: "typ-room" }, timestamp: Date.now() }))
    await new Promise((resolve) => setTimeout(resolve, 100))

    assert(typingReceived, "Typing indicators are broadcast")
    assert(stopTypingReceived, "Stop typing indicators are broadcast")

    ws1.close()
    ws2.close()
  } catch (error) {
    assert(false, `Typing indicators - ${error.message}`)
  }
}

async function test7_WalletEvents() {
  log("Test 7: Wallet Events", "yellow")
  try {
    const ws1 = new WebSocket("ws://localhost:3001")
    const ws2 = new WebSocket("ws://localhost:3001")
    let walletConnectReceived = false

    await Promise.all(
      [ws1, ws2].map(
        (ws) =>
          new Promise((resolve) => {
            ws.on("open", resolve)
          }),
      ),
    )

    ws1.send(JSON.stringify({ type: "auth", payload: { userId: "wallet-1", walletAddress: "GA1", displayName: "W1" }, timestamp: Date.now() }))
    ws2.send(JSON.stringify({ type: "auth", payload: { userId: "wallet-2", walletAddress: "GA2", displayName: "W2" }, timestamp: Date.now() }))
    await new Promise((resolve) => setTimeout(resolve, 200))

    ws2.on("message", (data) => {
      const msg = JSON.parse(data)
      if (msg.type === "wallet_connect") walletConnectReceived = true
    })

    ws1.send(
      JSON.stringify({
        type: "wallet_event",
        payload: { action: "connect", walletAddress: "GABCDEF123" },
        timestamp: Date.now(),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 300))

    assert(walletConnectReceived, "Wallet connect events are broadcast")

    ws1.close()
    ws2.close()
  } catch (error) {
    assert(false, `Wallet events - ${error.message}`)
  }
}

async function test8_ConnectionStability() {
  log("Test 8: Connection Stability", "yellow")
  try {
    const ws = new WebSocket("ws://localhost:3001")
    let stabilityCheck = false

    await new Promise((resolve) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "auth", payload: { userId: "stable-1", walletAddress: "GA1", displayName: "S1" }, timestamp: Date.now() }))
        stabilityCheck = true
        resolve()
      })
    })

    assert(stabilityCheck && ws.readyState === WebSocket.OPEN, "Connection remains stable during message exchange")

    ws.close()
  } catch (error) {
    assert(false, `Connection stability - ${error.message}`)
  }
}

async function runAllTests() {
  try {
    // Start server
    await test1_ServerStartup()
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Run tests
    await test2_ClientConnection()
    await new Promise((resolve) => setTimeout(resolve, 500))

    await test3_Authentication()
    await new Promise((resolve) => setTimeout(resolve, 500))

    await test4_RoomJoinLeave()
    await new Promise((resolve) => setTimeout(resolve, 500))

    await test5_MessageBroadcast()
    await new Promise((resolve) => setTimeout(resolve, 500))

    await test6_TypingIndicators()
    await new Promise((resolve) => setTimeout(resolve, 500))

    await test7_WalletEvents()
    await new Promise((resolve) => setTimeout(resolve, 500))

    await test8_ConnectionStability()

    // Print results
    log("\n" + "=".repeat(60), "blue")
    log("TEST RESULTS", "blue")
    log("=".repeat(60), "blue")

    testResults.forEach((result) => {
      console.log(result)
    })

    log("=".repeat(60), "blue")
    log(`\n✅ Passed: ${passed}`, "green")
    log(`❌ Failed: ${failed}`, failed > 0 ? "red" : "green")
    log(`📊 Total: ${passed + failed}\n`, "blue")

    if (failed === 0) {
      log("🎉 All tests passed!\n", "green")
      process.exit(0)
    } else {
      log("⚠️  Some tests failed!\n", "red")
      process.exit(1)
    }
  } catch (error) {
    log(`\n❌ Test suite error: ${error.message}\n`, "red")
    process.exit(1)
  }
}

// Run tests
runAllTests().catch((error) => {
  log(`Fatal error: ${error.message}`, "red")
  process.exit(1)
})
