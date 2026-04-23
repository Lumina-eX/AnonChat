import {
  WebSocketMessage,
  WebSocketEventType,
  WebSocketServerEventType,
  WebSocketClientEventType,
  ConnectionState,
} from "@/types/websocket"
import { rateLimiter } from "@/lib/rate-limiter"

const RECONNECT_ATTEMPTS = 5
const INITIAL_RECONNECT_DELAY = 1000 // 1 second
const MAX_RECONNECT_DELAY = 30000 // 30 seconds

export class WebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private messageHandlers: Map<WebSocketEventType, Set<(msg: WebSocketMessage) => void>>
  private connectionStateHandlers: Set<(state: ConnectionState) => void>
  private connectionState: ConnectionState = "disconnected"
  private reconnectAttempts = 0
  private reconnectDelay = INITIAL_RECONNECT_DELAY
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private clientId: string | null = null
  private walletAddress: string | null = null

  constructor(url: string) {
    this.url = url
    this.messageHandlers = new Map()
    this.connectionStateHandlers = new Set()
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.setConnectionState("connecting")

        this.ws = new WebSocket(this.url)

        this.ws.onopen = () => {
          console.log("[WebSocket Client] Connected")
          this.reconnectAttempts = 0
          this.reconnectDelay = INITIAL_RECONNECT_DELAY
          this.setConnectionState("connected")
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as WebSocketMessage

            // Handle connection established
            if (message.type === "connection_established") {
              this.clientId = message.payload.clientId
              console.log("[WebSocket Client] Connection established with ID:", this.clientId)
            }

            // Handle errors
            if (message.type === "error") {
              console.error("[WebSocket Client] Server error:", message.payload)
            }

            // Call registered handlers
            const handlers = this.messageHandlers.get(message.type)
            if (handlers) {
              handlers.forEach((handler) => {
                try {
                  handler(message)
                } catch (error) {
                  console.error("[WebSocket Client] Error in message handler:", error)
                }
              })
            }
          } catch (error) {
            console.error("[WebSocket Client] Error parsing message:", error)
          }
        }

        this.ws.onerror = (error) => {
          console.error("[WebSocket Client] Error:", error)
          this.setConnectionState("error")
          reject(error)
        }

        this.ws.onclose = () => {
          console.log("[WebSocket Client] Disconnected")
          this.setConnectionState("disconnected")
          this.attemptReconnect()
        }
      } catch (error) {
        console.error("[WebSocket Client] Connection error:", error)
        this.setConnectionState("error")
        reject(error)
      }
    })
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= RECONNECT_ATTEMPTS) {
      console.error("[WebSocket Client] Max reconnection attempts reached")
      this.setConnectionState("error")
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY,
    )

    console.log(
      `[WebSocket Client] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${RECONNECT_ATTEMPTS})`,
    )

    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch((error) => {
        console.error("[WebSocket Client] Reconnection failed:", error)
      })
    }, delay)
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.setConnectionState("disconnected")
  }

  send(message: WebSocketMessage): void {
    if (!this.isConnected()) {
      console.warn("[WebSocket Client] Cannot send message: not connected")
      return
    }

    if (this.ws) {
      this.ws.send(JSON.stringify(message))
    }
  }

  onMessage(
    type: WebSocketServerEventType,
    handler: (message: WebSocketMessage) => void,
  ): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set())
    }

    this.messageHandlers.get(type)?.add(handler)

    // Return unsubscribe function
    return () => {
      this.messageHandlers.get(type)?.delete(handler)
    }
  }

  onConnectionStateChange(handler: (state: ConnectionState) => void): () => void {
    this.connectionStateHandlers.add(handler)

    // Return unsubscribe function
    return () => {
      this.connectionStateHandlers.delete(handler)
    }
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state
      this.connectionStateHandlers.forEach((handler) => {
        try {
          handler(state)
        } catch (error) {
          console.error("[WebSocket Client] Error in connection state handler:", error)
        }
      })
    }
  }

  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  isConnected(): boolean {
    return this.connectionState === "connected" && this.ws?.readyState === WebSocket.OPEN
  }

  // Convenience methods for common messages
  authenticate(userId: string, walletAddress: string, displayName: string, avatarUrl?: string) {
    this.walletAddress = walletAddress
    this.send({
      type: "auth",
      payload: {
        userId,
        walletAddress,
        displayName,
        avatarUrl,
      },
      timestamp: Date.now(),
    })
  }

  joinRoom(roomId: string) {
    this.send({
      type: "room_join",
      payload: { roomId },
      timestamp: Date.now(),
    })
  }

  leaveRoom(roomId: string) {
    this.send({
      type: "leave_room",
      payload: { roomId },
      timestamp: Date.now(),
    })
  }

  sendMessage(roomId: string, content: string): { success: boolean; error?: string } {
    if (!this.walletAddress) {
      return { success: false, error: "Wallet not connected" }
    }

    const rateLimitCheck = rateLimiter.check(this.walletAddress)
    if (!rateLimitCheck.allowed) {
      const seconds = Math.ceil((rateLimitCheck.remainingMs || 0) / 1000)
      return { 
        success: false, 
        error: `You are sending messages too quickly. Please wait ${seconds} second${seconds !== 1 ? 's' : ''}.` 
      }
    }

    this.send({
      type: "send_message",
      payload: { roomId, content },
      timestamp: Date.now(),
    })
    return { success: true }
  }

  notifyTyping(roomId: string) {
    this.send({
      type: "typing",
      payload: { roomId },
      timestamp: Date.now(),
    })
  }

  notifyStopTyping(roomId: string) {
    this.send({
      type: "stop_typing",
      payload: { roomId },
      timestamp: Date.now(),
    })
  }

  notifyWalletEvent(action: "connect" | "disconnect", walletAddress: string) {
    this.send({
      type: "wallet_event",
      payload: { action, walletAddress },
      timestamp: Date.now(),
    })
  }
}

// Singleton instance
let instance: WebSocketClient | null = null

export function getWebSocketClient(url?: string): WebSocketClient {
  if (!instance) {
    const wsUrl = url || process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001"
    instance = new WebSocketClient(wsUrl)
  }

  return instance
}

export function resetWebSocketClient() {
  if (instance) {
    instance.disconnect()
    instance = null
  }
}
