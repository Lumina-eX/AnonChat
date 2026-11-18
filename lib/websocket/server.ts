import WebSocket, { WebSocketServer } from "ws"
import http from "http"
import { randomUUID } from "crypto"
import { validateMessage, ValidationErrorType } from "../middleware/message-validation"
import { isValidUUID, getIdempotencyMetrics } from "../messages/idempotency"

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

interface PresenceRecord {
  userId: string
  displayName: string
  walletAddress?: string
  avatarUrl?: string
  status: "online" | "offline" | "away"
  lastSeen: number
}

// In-memory storage
const clients = new Map<string, ClientConnection>()
const rooms = new Map<string, Room>()
const userPresence = new Map<string, PresenceRecord>()
const userConnections = new Map<string, Set<string>>()
const presenceTimeouts = new Map<string, NodeJS.Timeout>()

// ---------------------------------------------------------------------------
// Idempotency tracking for WebSocket broadcasts
//
// The WebSocket server is broadcast-only (no DB writes). Idempotency here
// prevents the same client-generated message from being re-broadcast to a
// room when the client retransmits after a reconnection.
//
// Keys are stored with a TTL so the set doesn't grow unboundedly.
// On reconnect a client should reuse the SAME idempotency_key for a pending
// message; if the key is already in seenMessageKeys the broadcast is skipped
// and an ack is sent back to the sender instead.
// ---------------------------------------------------------------------------
interface SeenKeyEntry {
  broadcastId: string  // the UUID that was broadcast the first time
  roomId: string
  expiresAt: number    // unix ms
}
const seenMessageKeys = new Map<string, SeenKeyEntry>()
const WS_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000 // 5 minutes

/** Evict expired keys — called before every new key insertion. */
function evictExpiredKeys(): void {
  const now = Date.now()
  seenMessageKeys.forEach((entry, key) => {
    if (entry.expiresAt <= now) seenMessageKeys.delete(key)
  })
}

const HEARTBEAT_INTERVAL = 30000 // 30 seconds
const PRESENCE_GRACE_PERIOD = 5000 // 5 seconds

export function createWebSocketServer(port: number = 3001) {
  const server = http.createServer()
  const wss = new WebSocketServer({ server })

  // Utility functions
  function broadcastToRoom(roomId: string, message: any, excludeClientId?: string) {
    const room = rooms.get(roomId)
    if (!room) return

    const messageStr = JSON.stringify(message)
    room.users.forEach((clientId) => {
      const client = clients.get(clientId)
      if (client && client.ws.readyState === WebSocket.OPEN && clientId !== excludeClientId) {
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
    const messageStr = JSON.stringify(message)
    clients.forEach((client) => {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(messageStr)
      }
    })
  }

  function removeUserFromRoom(userId: string, roomId: string) {
    const room = rooms.get(roomId)
    if (!room) return

    room.users.forEach((clientId) => {
      if (clients.get(clientId)?.userId === userId) {
        room.users.delete(clientId)
      }
    })
  }

  function setupNotificationBridge(httpServer: http.Server) {
    httpServer.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (req.method !== "POST" || req.url !== "/notify") {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Not found" }))
        return
      }

      const secret = process.env.WS_NOTIFY_SECRET || "dev-notify-secret"
      const authHeader = req.headers.authorization
      if (authHeader !== `Bearer ${secret}`) {
        res.writeHead(401, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Unauthorized" }))
        return
      }

      let body = ""
      req.on("data", (chunk: Buffer) => {
        body += chunk
      })

      req.on("end", () => {
        try {
          const parsed = JSON.parse(body) as {
            userId?: string
            event?: {
              type?: string
              payload?: Record<string, unknown>
            }
            notification?: Record<string, unknown>
          }
          const event = parsed.event ?? (parsed.notification
            ? { type: "notification", payload: parsed.notification }
            : null)

          if (!parsed.userId || !event?.type || !event.payload) {
            res.writeHead(400, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ error: "userId and event are required" }))
            return
          }

          const eventGroupId = event.payload.groupId
          if (event.type === "member_removed" && typeof eventGroupId === "string") {
            removeUserFromRoom(parsed.userId, eventGroupId)
          }

          sendToUser(parsed.userId, {
            type: event.type,
            payload: event.payload,
            timestamp: Date.now(),
          })

          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ delivered: true }))
        } catch (error) {
          console.error("[WebSocket] Notification bridge error:", error)
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "Invalid request body" }))
        }
      })
    })
  }

  function getPresenceSnapshot() {
    return Array.from(userPresence.values()).map((presence) => ({
      userId: presence.userId,
      displayName: presence.displayName,
      walletAddress: presence.walletAddress,
      status: presence.status,
      lastSeen: presence.lastSeen,
    }))
  }

  function sendPresenceSnapshot(ws: WebSocket) {
    ws.send(
      JSON.stringify({
        type: "presence_snapshot",
        payload: {
          users: getPresenceSnapshot(),
        },
        timestamp: Date.now(),
      }),
    )
  }

  function clearPendingPresenceTimeout(userId: string) {
    const timeout = presenceTimeouts.get(userId)
    if (timeout) {
      clearTimeout(timeout)
      presenceTimeouts.delete(userId)
    }
  }

  function broadcastPresenceUpdate(presence: PresenceRecord) {
    broadcastToAll({
      type: "presence_update",
      payload: {
        userId: presence.userId,
        displayName: presence.displayName,
        walletAddress: presence.walletAddress,
        status: presence.status,
        lastSeen: presence.lastSeen,
      },
      timestamp: Date.now(),
    })
  }

  function registerUserConnection(clientId: string, user: User) {
    const connections = userConnections.get(user.id) ?? new Set<string>()
    connections.add(clientId)
    userConnections.set(user.id, connections)
    clearPendingPresenceTimeout(user.id)
  }

  function schedulePresenceOffline(userId: string) {
    clearPendingPresenceTimeout(userId)
    presenceTimeouts.set(
      userId,
      setTimeout(() => {
        const connections = userConnections.get(userId)
        if (connections && connections.size > 0) {
          return
        }

        const presence = userPresence.get(userId)
        if (!presence) {
          return
        }

        presence.status = "offline"
        presence.lastSeen = Date.now()
        broadcastPresenceUpdate(presence)
        userPresence.delete(userId)
      }, PRESENCE_GRACE_PERIOD),
    )
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
    if (client?.heartbeatTimer) {
      clearInterval(client.heartbeatTimer as any)
    }

    if (client?.userId) {
      const connections = userConnections.get(client.userId)
      if (connections) {
        connections.delete(clientId)
        if (connections.size === 0) {
          userConnections.delete(client.userId)
          schedulePresenceOffline(client.userId)
        } else {
          userConnections.set(client.userId, connections)
        }
      }
    }

    // Remove from all rooms
    rooms.forEach((room) => {
      if (room.users.has(clientId)) {
        room.users.delete(clientId)
      }
    })

    clients.delete(clientId)
  }

  function setUserOnline(user: User) {
    const previousPresence = userPresence.get(user.id)
    const nextPresence: PresenceRecord = {
      userId: user.id,
      displayName: user.displayName,
      walletAddress: user.walletAddress,
      avatarUrl: user.avatarUrl,
      status: "online",
      lastSeen: Date.now(),
    }
    userPresence.set(user.id, nextPresence)

    if (!previousPresence || previousPresence.status !== "online") {
      broadcastPresenceUpdate(nextPresence)
    }
    return nextPresence
  }

  // Handle WebSocket connections
  wss.on("connection", (ws: WebSocket) => {
    const clientId = randomUUID()
    const connection: ClientConnection = { ws }

    clients.set(clientId, connection)
    console.log(`[WebSocket] Client connected: ${clientId}`)

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

            registerUserConnection(clientId, connection.user)
            setUserOnline(connection.user)

            // Send a snapshot so late listeners can initialize immediately
            sendPresenceSnapshot(ws)
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

            rooms.get(roomId)?.users.add(clientId)

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
              rooms.get(leaveRoomId)?.users.delete(clientId)

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

            // Validate message content
            const validation = validateMessage(
              {
                content: message.payload.content,
                roomId: msgRoomId,
                // Pass idempotency_key through so validation doesn't strip it
                ...(message.payload.idempotency_key
                  ? { idempotency_key: message.payload.idempotency_key }
                  : {}),
              },
              "websocket",
            )

            if (!validation.isValid) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  payload: {
                    message: validation.error?.message,
                    type: validation.error?.type,
                    details: validation.error?.details,
                  },
                  timestamp: Date.now(),
                }),
              )
              break
            }

            // ------------------------------------------------------------------
            // Idempotency check (in-memory, broadcast layer)
            //
            // The WebSocket server does not persist to the DB — that is the
            // HTTP handler's responsibility.  Here we deduplicate the *broadcast*
            // so that a client reconnecting and resending a pending message does
            // not cause other room members to see it twice.
            // ------------------------------------------------------------------
            const clientKey: string | undefined =
              typeof message.payload.idempotency_key === "string"
                ? message.payload.idempotency_key
                : undefined

            if (clientKey && isValidUUID(clientKey)) {
              const existing = seenMessageKeys.get(clientKey)
              if (existing && existing.expiresAt > Date.now()) {
                // Already broadcast — send an ack back to the sender only
                console.info(
                  `[WebSocket][idempotency] Duplicate send_message suppressed`,
                  {
                    idempotency_key: clientKey,
                    original_broadcast_id: existing.broadcastId,
                    room_id: msgRoomId,
                    user_id: msgUserId,
                    metrics: getIdempotencyMetrics(),
                  },
                )
                ws.send(
                  JSON.stringify({
                    type: "message_ack",
                    payload: {
                      idempotency_key: clientKey,
                      message_id: existing.broadcastId,
                      duplicate: true,
                    },
                    timestamp: Date.now(),
                  }),
                )
                break
              }
            }

            // Generate a stable broadcast ID for this message
            const broadcastId = randomUUID()

            // Register the key before broadcasting so concurrent sends from the
            // same client (e.g., multi-tab) are also caught.
            if (clientKey && isValidUUID(clientKey)) {
              evictExpiredKeys()
              seenMessageKeys.set(clientKey, {
                broadcastId,
                roomId: msgRoomId,
                expiresAt: Date.now() + WS_IDEMPOTENCY_TTL_MS,
              })
            }

            const broadcastMessage = {
              type: "message",
              payload: {
                id: broadcastId,
                roomId: msgRoomId,
                userId: msgUserId,
                displayName: connection.user?.displayName,
                avatarUrl: connection.user?.avatarUrl,
                content: validation.sanitized?.content || message.payload.content,
                // Surface the key so clients can correlate the broadcast with
                // their own pending-message state
                idempotency_key: clientKey ?? null,
                createdAt: Date.now(),
              },
              timestamp: Date.now(),
            }

            broadcastToRoom(msgRoomId, broadcastMessage)

            // Send an ack to the original sender confirming delivery
            ws.send(
              JSON.stringify({
                type: "message_ack",
                payload: {
                  idempotency_key: clientKey ?? null,
                  message_id: broadcastId,
                  duplicate: false,
                },
                timestamp: Date.now(),
              }),
            )
            break
          }

          case "message_delivered": {
            const deliveredRoomId = message.payload.roomId
            const deliveredMessageId = message.payload.messageId

            // Broadcast status update to the room
            // In a production app, we would also update the database here
            broadcastToRoom(deliveredRoomId, {
              type: "message_status_update",
              payload: {
                messageId: deliveredMessageId,
                status: "delivered",
                roomId: deliveredRoomId,
              },
              timestamp: Date.now(),
            })
            break
          }

          case "edit_message": {
            const editRoomId = message.payload.roomId
            const editMessageId = message.payload.messageId
            const editContent = message.payload.content
            const editAuthorId = connection.userId

            if (!editRoomId || !editMessageId || !editContent || !editAuthorId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  payload: { message: "Invalid edit request" },
                  timestamp: Date.now(),
                }),
              )
              break
            }

            // Validate message content for edits
            const validation = validateMessage(
              { content: editContent, id: editMessageId, roomId: editRoomId },
              'websocket'
            )

            if (!validation.isValid) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  payload: {
                    message: validation.error?.message,
                    type: validation.error?.type,
                    details: validation.error?.details,
                  },
                  timestamp: Date.now(),
                }),
              )
              break
            }

            broadcastToRoom(editRoomId, {
              type: "message_edit",
              payload: {
                messageId: editMessageId,
                userId: editAuthorId,
                roomId: editRoomId,
                content: validation.sanitized?.content || editContent,
                editedAt: Date.now(),
              },
              timestamp: Date.now(),
            })
            break
          }

          case "message_read": {
            const readRoomId = message.payload.roomId
            const readMessageId = message.payload.messageId
            const readUserId = connection.userId

            if (!readUserId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  payload: { message: "Not authenticated" },
                  timestamp: Date.now(),
                }),
              )
              break
            }

            // Broadcast read receipt to the room
            // The actual read receipt will be persisted to the database via the REST API
            broadcastToRoom(readRoomId, {
              type: "message_read_receipt",
              payload: {
                messageId: readMessageId,
                userId: readUserId,
                displayName: connection.user?.displayName,
                readAt: Date.now(),
                roomId: readRoomId,
              },
              timestamp: Date.now(),
            })
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

          case "request_presence_snapshot": {
            sendPresenceSnapshot(ws)
            break
          }

          case "pong":
            // Heartbeat pong response - no action needed
            break

          default:
            console.log(`[WebSocket] Unknown message type: ${message.type}`)
        }
      } catch (error) {
        console.error("[WebSocket] Error processing message:", error)
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
      console.log(`[WebSocket] Pong from ${clientId}`)
    })

    ws.on("close", () => {
      console.log(`[WebSocket] Client disconnected: ${clientId}`)
      cleanupClient(clientId)
    })

    ws.on("error", (error) => {
      console.error(`[WebSocket] Error for ${clientId}:`, error)
      cleanupClient(clientId)
    })
  })

  setupNotificationBridge(server)

  server.listen(port, () => {
    console.log(`[WebSocket Server] Running on ws://localhost:${port}`)
  })

  return { server, wss }
}

// Export the factory function (don't auto-initialize)
export default createWebSocketServer