import WebSocket, { WebSocketServer } from "ws"
import http from "http"
import { randomUUID } from "crypto"
import { logSystemEvent } from "@/lib/logging"

// Type definitions
interface User {
  id: string
  walletAddress: string
  displayName: string
  avatarUrl?: string
}

interface ClientConnection {
  ws: WebSocket
  userId?: string
  user?: User
  heartbeatTimer?: NodeJS.Timer
}

interface Room {
  id: string
  users: Set<string>
}

// In-memory storage
const clients = new Map<string, ClientConnection>()
const rooms = new Map<string, Room>()
const userPresence = new Map<string, User>()

const HEARTBEAT_INTERVAL = 30000 // 30 seconds
const RECONNECT_TIMEOUT = 60000 // 60 seconds

export function createWebSocketServer(port: number = 3001) {
  const server = http.createServer()
  const wss = new WebSocketServer({ server })

  // Utility functions
  function broadcastToRoom(roomId: string, message: any, excludeClientId?: string) {
    const room = rooms.get(roomId)
    if (!room) return

    const messageStr = JSON.stringify(message)
    room.users.forEach((userId) => {
      const client = clients.get(userId)
      if (client && client.ws.readyState === WebSocket.OPEN && userId !== excludeClientId) {
        client.ws.send(messageStr)
      }
    })
  }

  function broadcastToAll(message: any, excludeClientId?: string) {
    const messageStr = JSON.stringify(message)
    clients.forEach((client, clientId) => {
      if (client.ws.readyState === WebSocket.OPEN && clientId !== excludeClientId) {
        client.ws.send(messageStr)
      }
    })
  }

  function sendToUser(userId: string, message: any) {
    const client = clients.get(userId)
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message))
    }
  }

  function setupHeartbeat(clientId: string) {
    const client = clients.get(clientId)
    if (!client) return

    if (client.heartbeatTimer) {
      clearInterval(client.heartbeatTimer as any)
    }

    client.heartbeatTimer = setInterval(() => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping()
      }
    }, HEARTBEAT_INTERVAL)
  }

  function cleanupClient(clientId: string) {
    const client = clients.get(clientId)
    if (client) {
      if (client.heartbeatTimer) {
        clearInterval(client.heartbeatTimer as any)
      }
      client.ws.close()
    }
    clients.delete(clientId)

    // Notify about presence update
    if (client?.userId) {
      userPresence.delete(client.userId)
      broadcastToAll({
        type: "presence_update",
        payload: {
          userId: client.userId,
          status: "offline",
        },
        timestamp: Date.now(),
      })
    }
  }

  // Handle WebSocket connections
  wss.on("connection", (ws: WebSocket) => {
    const clientId = randomUUID()
    const connection: ClientConnection = { ws }

    clients.set(clientId, connection)
    logSystemEvent("info", "client_connected", { clientId })

    // Send connection established message
    ws.send(
      JSON.stringify({
        type: "connection_established",
        payload: { clientId },
        timestamp: Date.now(),
      }),
    )

    // Setup heartbeat for this connection
    setupHeartbeat(clientId)

    ws.on("message", (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString())
        console.log(`[WebSocket] Message from ${clientId}:`, message.type)
        logSystemEvent("info", "websocket_message_received", {
          eventType: "websocket_message_received",
          clientId,
          messageType: message.type,
        })

        switch (message.type) {
          case "auth": {
            // Authenticate user
            connection.userId = message.payload.userId
            connection.user = {
              id: message.payload.userId,
              walletAddress: message.payload.walletAddress,
              displayName: message.payload.displayName,
              avatarUrl: message.payload.avatarUrl,
            }

            userPresence.set(message.payload.userId, connection.user)

            // Broadcast presence update
            broadcastToAll({
              type: "presence_update",
              payload: {
                userId: message.payload.userId,
                displayName: message.payload.displayName,
                status: "online",
              },
              timestamp: Date.now(),
            })
            logSystemEvent("info", "user_authenticated", {
              eventType: "user_authenticated",
              userId: message.payload.userId,
              clientId,
            })
            break
          }

          case "join_room": {
            const roomId = message.payload.roomId
            const userId = connection.userId

            if (!userId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  payload: { message: "Not authenticated" },
                  timestamp: Date.now(),
                }),
              )
              break
            }

            if (!rooms.has(roomId)) {
              rooms.set(roomId, { id: roomId, users: new Set() })
            }

            rooms.get(roomId)?.users.add(userId)

            // Notify room members
            broadcastToRoom(roomId, {
              type: "room_join",
              payload: {
                userId,
                roomId,
                displayName: connection.user?.displayName,
              },
              timestamp: Date.now(),
            })
            break
          }

          case "leave_room": {
            const leaveRoomId = message.payload.roomId
            const leaveUserId = connection.userId

            if (leaveUserId && rooms.has(leaveRoomId)) {
              rooms.get(leaveRoomId)?.users.delete(leaveUserId)

              broadcastToRoom(leaveRoomId, {
                type: "room_leave",
                payload: {
                  userId: leaveUserId,
                  roomId: leaveRoomId,
                },
                timestamp: Date.now(),
              })
            }
            break
          }

          case "send_message": {
            const msgRoomId = message.payload.roomId
            const msgUserId = connection.userId

            if (!msgUserId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  payload: { message: "Not authenticated" },
                  timestamp: Date.now(),
                }),
              )
              break
            }

            const broadcastMessage = {
              type: "message",
              payload: {
                id: randomUUID(),
                roomId: msgRoomId,
                userId: msgUserId,
                displayName: connection.user?.displayName,
                avatarUrl: connection.user?.avatarUrl,
                content: message.payload.content,
                createdAt: Date.now(),
              },
              timestamp: Date.now(),
            }

            broadcastToRoom(msgRoomId, broadcastMessage)
            break
          }

          case "typing": {
            const typingRoomId = message.payload.roomId

            broadcastToRoom(typingRoomId, {
              type: "user_typing",
              payload: {
                roomId: typingRoomId,
                userId: connection.userId,
                displayName: connection.user?.displayName,
              },
              timestamp: Date.now(),
            })
            break
          }

          case "stop_typing": {
            const stopTypingRoomId = message.payload.roomId

            broadcastToRoom(stopTypingRoomId, {
              type: "user_stop_typing",
              payload: {
                roomId: stopTypingRoomId,
                userId: connection.userId,
              },
              timestamp: Date.now(),
            })
            break
          }

          case "wallet_event": {
            const walletAction = message.payload.action
            const walletAddress = message.payload.walletAddress

            broadcastToAll({
              type: walletAction === "connect" ? "wallet_connect" : "wallet_disconnect",
              payload: {
                userId: connection.userId,
                walletAddress,
              },
              timestamp: Date.now(),
            })
            break
          }

          case "pong":
            // Heartbeat pong response - no action needed
            break

          default:
            logSystemEvent("warn", "unknown_message_type", {
              eventType: "unknown_message_type",
              clientId,
              messageType: message.type,
            })
        }
      } catch (error) {
        logSystemEvent("error", "error_processing_message", {
          eventType: "error_processing_message",
          clientId,
          error: error instanceof Error ? error.message : String(error),
        })
        ws.send(
          JSON.stringify({
            type: "error",
            payload: { message: "Error processing message" },
            timestamp: Date.now(),
          }),
        )
      }
    })

    ws.on("pong", () => {
      logSystemEvent("info", "pong_received", {
        eventType: "pong_received",
        clientId,
      })
    })

    ws.on("close", () => {
      logSystemEvent("info", "client_disconnected", {
        eventType: "client_disconnected",
        clientId,
      })
      cleanupClient(clientId)
    })

    ws.on("error", (error) => {
      logSystemEvent("error", "client_error", {
        eventType: "client_error",
        clientId,
        error: error instanceof Error ? error.message : String(error),
      })
      cleanupClient(clientId)
    })
  })

  server.listen(port, () => {
    logSystemEvent("info", "websocket_server_started", {
      eventType: "websocket_server_started",
      port,
    })
  })

  return { server, wss }
}

// Export the factory function (don't auto-initialize)
export default createWebSocketServer
