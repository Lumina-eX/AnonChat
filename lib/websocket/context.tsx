"use client"

import React, { createContext, useContext, ReactNode } from "react"
import { useWebSocket } from "@/lib/websocket/hooks"
import { ConnectionState, WebSocketEventType, WebSocketServerEventType } from "@/types/websocket"
import { WebSocketMessage } from "@/types/websocket"

interface WebSocketContextValue {
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

const WebSocketContext = createContext<WebSocketContextValue | undefined>(undefined)

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const websocket = useWebSocket({ autoConnect: true })

  return (
    <WebSocketContext.Provider value={websocket}>
      {children}
    </WebSocketContext.Provider>
  )
}

export function useWebSocketContext(): WebSocketContextValue {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error("useWebSocketContext must be used within WebSocketProvider")
  }
  return context
}
