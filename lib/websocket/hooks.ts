"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { WebSocketMessage, ConnectionState, WebSocketServerEventType } from "@/types/websocket"
import { getWebSocketClient } from "@/lib/websocket/client"

interface UseWebSocketOptions {
  autoConnect?: boolean
  reconnect?: boolean
}

interface UseWebSocketReturn {
  connectionState: ConnectionState
  isConnected: boolean
  send: (message: WebSocketMessage) => void
  on: (
    type: WebSocketServerEventType,
    handler: (message: WebSocketMessage) => void,
  ) => () => void
  connect: () => Promise<void>
  disconnect: () => void
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const { autoConnect = true, reconnect = true } = options

  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected")
  const clientRef = useRef(getWebSocketClient())
  const unsubscribesRef = useRef<(() => void)[]>([])

  // Setup connection state listener
  useEffect(() => {
    const client = clientRef.current
    const unsubscribe = client.onConnectionStateChange((state) => {
      setConnectionState(state)
    })

    unsubscribesRef.current.push(unsubscribe)

    return () => {
      unsubscribe()
    }
  }, [])

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      const client = clientRef.current

      if (!client.isConnected()) {
        client.connect().catch((error) => {
          console.error("[useWebSocket] Failed to connect:", error)
        })
      }
    }

    return () => {
      // Optionally disconnect on unmount
      // clientRef.current.disconnect()
    }
  }, [autoConnect])

  const send = useCallback((message: WebSocketMessage) => {
    clientRef.current.send(message)
  }, [])

  const on = useCallback(
    (type: WebSocketServerEventType, handler: (message: WebSocketMessage) => void): (() => void) => {
      return clientRef.current.onMessage(type, handler)
    },
    [],
  )

  const connect = useCallback(async () => {
    return clientRef.current.connect()
  }, [])

  const disconnect = useCallback(() => {
    clientRef.current.disconnect()
  }, [])

  return {
    connectionState,
    isConnected: connectionState === "connected",
    send,
    on,
    connect,
    disconnect,
  }
}

// Hook for listening to specific message types
export function useWebSocketMessage(
  type: WebSocketServerEventType,
  handler?: (message: WebSocketMessage) => void,
): void {
  const { on } = useWebSocket()

  useEffect(() => {
    if (!handler) return

    const unsubscribe = on(type, handler)
    return unsubscribe
  }, [type, handler, on])
}

// Hook for checking connection status
export function useWebSocketConnected(): boolean {
  const { isConnected } = useWebSocket()
  return isConnected
}

// Hook for sending messages with automatic serialization
export function useWebSocketSend() {
  const { send } = useWebSocket()
  const client = useRef(getWebSocketClient())

  return {
    authenticate: useCallback(
      (userId: string, walletAddress: string, displayName: string, avatarUrl?: string) => {
        client.current.authenticate(userId, walletAddress, displayName, avatarUrl)
      },
      [],
    ),
    joinRoom: useCallback((roomId: string) => {
      client.current.joinRoom(roomId)
    }, []),
    leaveRoom: useCallback((roomId: string) => {
      client.current.leaveRoom(roomId)
    }, []),
    sendMessage: useCallback((roomId: string, content: string) => {
      return client.current.sendMessage(roomId, content)
    }, []),
    notifyTyping: useCallback((roomId: string) => {
      client.current.notifyTyping(roomId)
    }, []),
    notifyStopTyping: useCallback((roomId: string) => {
      client.current.notifyStopTyping(roomId)
    }, []),
    notifyWalletEvent: useCallback((action: "connect" | "disconnect", walletAddress: string) => {
      client.current.notifyWalletEvent(action, walletAddress)
    }, []),
  }
}
