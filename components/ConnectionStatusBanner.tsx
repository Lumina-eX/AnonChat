"use client"

import { useWebSocketContext } from "@/lib/websocket/context"
import { useEffect, useState } from "react"
import { WifiOff, RefreshCw, CheckCircle } from "lucide-react"

export function ConnectionStatusBanner() {
  const { connectionState } = useWebSocketContext()
  const [hasBeenDisconnected, setHasBeenDisconnected] = useState(false)
  const [showConnectedSuccess, setShowConnectedSuccess] = useState(false)

  // Track if we ever lose the connection
  useEffect(() => {
    if (connectionState === "disconnected" || connectionState === "error") {
      setHasBeenDisconnected(true)
      setShowConnectedSuccess(false)
    }
  }, [connectionState])

  // Handle successful reconnection transition
  useEffect(() => {
    if (connectionState === "connected" && hasBeenDisconnected) {
      setShowConnectedSuccess(true)
      const timer = setTimeout(() => {
        setHasBeenDisconnected(false)
        setShowConnectedSuccess(false)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [connectionState, hasBeenDisconnected])

  // Don't show banner if WebSocket is not configured
  const wsUrl = typeof window !== 'undefined' ? process.env.NEXT_PUBLIC_WS_URL : null
  const isWebSocketConfigured = wsUrl && wsUrl.trim() !== ""
  
  const showBanner = isWebSocketConfigured && (connectionState !== "connected" || showConnectedSuccess)

  if (!showBanner) return null

  let bgColor = "bg-amber-600/95"
  let textColor = "text-white"
  let message = "Reconnecting to chat server..."
  let icon = <RefreshCw className="h-4 w-4 animate-spin shrink-0" />

  if (connectionState === "disconnected") {
    bgColor = "bg-destructive/95"
    message = "Disconnected from chat server. Attempting to reconnect..."
    icon = <WifiOff className="h-4 w-4 shrink-0" />
  } else if (connectionState === "error") {
    bgColor = "bg-destructive/95"
    message = "Connection error. Retrying..."
    icon = <WifiOff className="h-4 w-4 shrink-0" />
  } else if (connectionState === "connected" && showConnectedSuccess) {
    bgColor = "bg-green-600/95"
    message = "Connection restored!"
    icon = <CheckCircle className="h-4 w-4 shrink-0" />
  }

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold shadow-lg backdrop-blur-md transition-all duration-300 pointer-events-none animate-in fade-in slide-in-from-top-2 ${bgColor} ${textColor}`}
      role="alert"
      data-testid="connection-status-banner"
    >
      {icon}
      <span>{message}</span>
    </div>
  )
}
