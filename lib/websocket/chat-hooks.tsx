"use client"

import { useEffect, useState, useCallback, useMemo, memo, useRef } from "react"
import { useWebSocketSend, useWebSocketMessage } from "@/lib/websocket/hooks"
import { WebSocketMessage } from "@/types/websocket"
import { toast } from "sonner"

interface RealtimeMessageUpdate {
  id: string
  roomId: string
  userId: string
  displayName: string
  content: string
  createdAt: number
  status: "sending" | "sent" | "delivered"
}

export interface TypingIndicator {
  userId: string
  displayName: string
  roomId: string
}

interface RealtimeRoomUpdate {
  userId: string
  roomId: string
  displayName?: string
  action: "join" | "leave"
}

export function useRealtimeChat(roomId: string, userId?: string) {
  const [messages, setMessages] = useState<RealtimeMessageUpdate[]>([])
  const [typingUsers, setTypingUsers] = useState<Map<string, TypingIndicator>>(new Map())
  const [roomUsers, setRoomUsers] = useState<Set<string>>(new Set())
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected")

  const {
    sendMessage,
    joinRoom,
    leaveRoom,
    notifyTyping,
    notifyStopTyping,
  } = useWebSocketSend()

  // Join room on mount
  useEffect(() => {
    if (roomId) {
      joinRoom(roomId)
    }

    return () => {
      if (roomId) {
        leaveRoom(roomId)
      }
    }
  }, [roomId, joinRoom, leaveRoom])

  // Listen for new messages
  useWebSocketMessage("message", (msg: WebSocketMessage) => {
    if ((msg.payload as any).roomId === roomId) {
      const messagePayload = msg.payload as any as RealtimeMessageUpdate
      setMessages((prev) => [...prev, messagePayload])
    }
  })

  // Listen for room joins
  useWebSocketMessage("room_join", (msg: WebSocketMessage) => {
    if ((msg.payload as any).roomId === roomId) {
      setRoomUsers((prev) => new Set([...prev, (msg.payload as any).userId]))
      toast.info(`${(msg.payload as any).displayName} joined the room`)
    }
  })

  // Listen for room leaves
  useWebSocketMessage("room_leave", (msg: WebSocketMessage) => {
    if ((msg.payload as any).roomId === roomId) {
      setRoomUsers((prev) => {
        const updated = new Set(prev)
        updated.delete((msg.payload as any).userId)
        return updated
      })
    }
  })

  // Listen for typing indicators
  useWebSocketMessage("user_typing", (msg: WebSocketMessage) => {
    const payload = msg.payload as any
    if (payload.roomId === roomId) {
      setTypingUsers((prev) => {
        const updated = new Map(prev)
        updated.set(payload.userId, {
          userId: payload.userId,
          displayName: payload.displayName,
          roomId: roomId,
        })
        return updated
      })
    }
  })

  // Listen for stop typing
  useWebSocketMessage("user_stop_typing", (msg: WebSocketMessage) => {
    const payload = msg.payload as any
    if (payload.roomId === roomId) {
      setTypingUsers((prev) => {
        const updated = new Map(prev)
        updated.delete(payload.userId)
        return updated
      })
    }
  })

  // Listen for wallet events
  useWebSocketMessage("wallet_connect", (msg: WebSocketMessage) => {
    const payload = msg.payload as any
    toast.info(`${payload.userId} connected wallet`)
  })

  useWebSocketMessage("wallet_disconnect", (msg: WebSocketMessage) => {
    const payload = msg.payload as any
    toast.info(`${payload.userId} disconnected wallet`)
  })

  // Listen for presence updates
  useWebSocketMessage("presence_update", (msg: WebSocketMessage) => {
    const payload = msg.payload as any
    // Update presence status in UI if needed
    const status = payload.status
    if (status === "offline") {
      setRoomUsers((prev) => {
        const updated = new Set(prev)
        updated.delete(payload.userId)
        return updated
      })
    }
  })

  const handleSendMessage = useCallback(
    (content: string) => {
      if (!content.trim() || !roomId) return

      // Optimistically add message
      const optimisticMessage: RealtimeMessageUpdate = {
        id: `temp-${Date.now()}`,
        roomId,
        userId: userId || "unknown",
        displayName: "You",
        content,
        createdAt: Date.now(),
        status: "sending",
      }

      setMessages((prev) => [...prev, optimisticMessage])

      // Send via WebSocket with rate limit check
      const result = sendMessage(roomId, content)
      if (!result.success) {
        // Remove optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMessage.id))
        toast.error(result.error || "Failed to send message")
      }
    },
    [roomId, userId, sendMessage],
  )

  const handleTyping = useCallback(() => {
    if (roomId) {
      notifyTyping(roomId)
    }
  }, [roomId, notifyTyping])

  const handleStopTyping = useCallback(() => {
    if (roomId) {
      notifyStopTyping(roomId)
    }
  }, [roomId, notifyStopTyping])

  return {
    messages,
    typingUsers: Array.from(typingUsers.values()),
    roomUsers: Array.from(roomUsers),
    connectionStatus,
    handlers: {
      sendMessage: handleSendMessage,
      typing: handleTyping,
      stopTyping: handleStopTyping,
    },
  }
}

const TYPING_DEBOUNCE_MS = 300
const STOP_TYPING_IDLE_MS = 2000

export function useDebouncedTyping(
  roomId: string,
  notifyTyping: (roomId: string) => void,
  notifyStopTyping: (roomId: string) => void,
) {
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = null
    }
    if (stopTypingTimeoutRef.current) {
      clearTimeout(stopTypingTimeoutRef.current)
      stopTypingTimeoutRef.current = null
    }
  }, [])

  const onTypingActivity = useCallback(() => {
    if (!roomId) return
    clearTimers()
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => {
      typingTimeoutRef.current = null
      notifyTyping(roomId)
      stopTypingTimeoutRef.current = setTimeout(() => {
        stopTypingTimeoutRef.current = null
        notifyStopTyping(roomId)
      }, STOP_TYPING_IDLE_MS)
    }, TYPING_DEBOUNCE_MS)
  }, [roomId, notifyTyping, notifyStopTyping, clearTimers])

  const onStopTypingImmediate = useCallback(() => {
    clearTimers()
    if (roomId) notifyStopTyping(roomId)
  }, [roomId, notifyStopTyping, clearTimers])

  useEffect(() => clearTimers, [clearTimers])

  return { onTypingActivity, onStopTypingImmediate }
}

/** Format display name for typing indicator: "Wallet_xxx" style */
function formatWalletLabel(user: TypingIndicator): string {
  if (user.displayName?.trim()) {
    const name = user.displayName.trim()
    return name.startsWith("Wallet_") ? name : `Wallet_${name.replace(/\s/g, "_").slice(0, 12)}`
  }
  return `Wallet_${user.userId.slice(0, 8)}`
}

export const TypingIndicatorComponent = memo(function TypingIndicatorComponent({
  typingUsers,
}: {
  typingUsers: TypingIndicator[]
}) {
  const names = useMemo(
    () => typingUsers.map(formatWalletLabel).join(", "),
    [typingUsers],
  )
  const isPlural = typingUsers.length > 1

  if (typingUsers.length === 0) return null

  return (
    <div
      className="flex items-center gap-2 text-sm text-muted-foreground px-4 py-1.5 min-h-[2rem]"
      role="status"
      aria-live="polite"
    >
      <div className="flex gap-1 shrink-0" aria-hidden>
        <span className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0ms]" />
        <span className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:150ms]" />
        <span className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:300ms]" />
      </div>
      <span className="truncate">
        {names} {isPlural ? "are" : "is"} typing…
      </span>
    </div>
  )
})

export function RoomUsersList({ users }: { users: string[] }) {
  if (users.length === 0) return null

  return (
    <div className="text-xs text-muted-foreground px-4 py-2">
      <span className="font-medium">{users.length} user</span>
      {users.length > 1 && "s"} online
    </div>
  )
}
