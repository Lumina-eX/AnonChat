# WebSocket Integration Example

This document provides code examples for integrating WebSocket support into your existing React components.

## Basic Setup

### 1. Wrap Your App with WebSocketProvider

In `app/layout.tsx`:
```tsx
import { WebSocketProvider } from "@/lib/websocket"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html>
      <body>
        <WebSocketProvider>
          {children}
        </WebSocketProvider>
      </body>
    </html>
  )
}
```

## Usage Examples

### 2. Using WebSocket in Chat Component

```tsx
"use client"

import { useEffect, useState } from "react"
import { useWebSocketSend, useWebSocketMessage } from "@/lib/websocket"
import { useRealtimeChat } from "@/lib/websocket/chat-hooks"

export function ChatComponent({ roomId, userId, displayName }: Props) {
  const [messageText, setMessageText] = useState("")
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timer>()

  // Use the realtime chat hook for automatic message sync
  const {
    messages,
    typingUsers,
    roomUsers,
    connectionStatus,
    handlers,
  } = useRealtimeChat(roomId, userId)

  // Send message handler
  const handleSendMessage = () => {
    if (!messageText.trim()) return

    handlers.sendMessage(messageText)
    setMessageText("")
    handlers.stopTyping()
  }

  // Typing indicator handler
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value
    setMessageText(text)

    // Clear existing timeout
    if (typingTimeout) clearTimeout(typingTimeout)

    // Notify typing
    handlers.typing()

    // Stop typing after 3 seconds of inactivity
    const timeout = setTimeout(() => {
      handlers.stopTyping()
    }, 3000)

    setTypingTimeout(timeout)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Connection status indicator */}
      <div className="px-4 py-2 text-xs">
        Status: <span className="font-semibold">{connectionStatus}</span>
      </div>

      {/* Online users count */}
      <div className="px-4 py-2 text-xs text-muted-foreground">
        {roomUsers.length} users online
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.userId === userId ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-xs px-4 py-2 rounded-lg ${
                msg.userId === userId
                  ? "bg-blue-500 text-white"
                  : "bg-gray-200 text-black"
              }`}
            >
              {msg.userId !== userId && (
                <div className="text-xs font-semibold mb-1">{msg.displayName}</div>
              )}
              <p className="text-sm">{msg.content}</p>
              <div className="text-xs opacity-70 mt-1">
                {msg.status === "sending" && "Sending..."}
                {msg.status === "sent" && "Sent"}
                {msg.status === "delivered" && "Delivered"}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Typing indicators */}
      {typingUsers.length > 0 && (
        <div className="px-4 py-2 text-xs text-muted-foreground">
          {typingUsers.map((u) => u.displayName).join(", ")} is typing...
        </div>
      )}

      {/* Message input */}
      <div className="border-t px-4 py-3 flex gap-2">
        <input
          type="text"
          value={messageText}
          onChange={handleInputChange}
          onKeyPress={(e) => {
            if (e.key === "Enter") handleSendMessage()
          }}
          placeholder="Type a message..."
          className="flex-1 px-3 py-2 border rounded-lg"
        />
        <button
          onClick={handleSendMessage}
          disabled={!messageText.trim()}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  )
}
```

### 3. Authenticating User

```tsx
import { useEffect } from "react"
import { useWebSocketSend } from "@/lib/websocket"

export function AuthenticateUser({ userId, walletAddress, displayName, avatarUrl }: Props) {
  const { authenticate } = useWebSocketSend()

  useEffect(() => {
    // Authenticate when user is available
    if (userId && walletAddress) {
      authenticate(userId, walletAddress, displayName, avatarUrl)
    }
  }, [userId, walletAddress, displayName, avatarUrl, authenticate])

  return null
}
```

### 4. Monitoring Wallet Events

```tsx
import { useEffect } from "react"
import { useWebSocketMessage } from "@/lib/websocket"
import { toast } from "sonner"

export function WalletEventMonitor() {
  useWebSocketMessage("wallet_connect", (msg) => {
    toast.success(`User connected wallet: ${msg.payload.walletAddress}`)
  })

  useWebSocketMessage("wallet_disconnect", (msg) => {
    toast.info(`User disconnected wallet`)
  })

  return null
}
```

### 5. Presence Awareness

```tsx
import { useEffect, useState } from "react"
import { useWebSocketMessage } from "@/lib/websocket"

export function PresenceIndicator({ userId }: { userId: string }) {
  const [isOnline, setIsOnline] = useState(false)

  useWebSocketMessage("presence_update", (msg) => {
    if (msg.payload.userId === userId) {
      setIsOnline(msg.payload.status === "online")
    }
  })

  return (
    <div
      className={`h-3 w-3 rounded-full ${isOnline ? "bg-green-500" : "bg-gray-400"}`}
      title={isOnline ? "Online" : "Offline"}
    />
  )
}
```

### 6. Room Join/Leave Handling

```tsx
import { toast } from "sonner"
import { useWebSocketMessage } from "@/lib/websocket"

export function RoomActivityMonitor({ roomId }: { roomId: string }) {
  useWebSocketMessage("room_join", (msg) => {
    if (msg.payload.roomId === roomId) {
      toast.info(`${msg.payload.displayName} joined the room`)
    }
  })

  useWebSocketMessage("room_leave", (msg) => {
    if (msg.payload.roomId === roomId) {
      toast.info(`User left the room`)
    }
  })

  return null
}
```

## Advanced Usage

### Custom Message Handling

```tsx
import { useCallback } from "react"
import { useWebSocketContext } from "@/lib/websocket"

export function CustomMessageHandler() {
  const { on } = useWebSocketContext()

  const handleCustomEvent = useCallback((msg) => {
    console.log("Custom event:", msg)
    // Your custom logic here
  }, [])

  // Subscribe to custom event type
  useEffect(() => {
    const unsubscribe = on("custom_event_type", handleCustomEvent)
    return unsubscribe
  }, [on, handleCustomEvent])

  return null
}
```

### Checking Connection Status

```tsx
import { useWebSocketConnected } from "@/lib/websocket"

export function ConnectionStatusBar() {
  const isConnected = useWebSocketConnected()

  return (
    <div className={`text-sm px-4 py-2 ${isConnected ? "bg-green-100" : "bg-red-100"}`}>
      WebSocket: {isConnected ? "✅ Connected" : "❌ Disconnected"}
    </div>
  )
}
```

## Integration Checklist

- [ ] Add `WebSocketProvider` to root layout
- [ ] Set `NEXT_PUBLIC_WS_URL` environment variable
- [ ] Install dependencies: `pnpm add ws @types/ws`
- [ ] Install dev dependency: `pnpm add -D concurrently`
- [ ] Start WebSocket server and Next.js: `npm run dev:all`
- [ ] Add authentication where user logs in
- [ ] Implement message sending/receiving
- [ ] Add typing indicators
- [ ] Add presence awareness
- [ ] Test with multiple clients
- [ ] Deploy WebSocket to production service

## Troubleshooting

### WebSocket Not Connecting
```tsx
import { isWebSocketConnected, getWebSocketStatus } from "@/lib/websocket"

// Check status
console.log("Connected:", isWebSocketConnected())
console.log("Status:", getWebSocketStatus())
```

### Not Receiving Messages
- Verify you've joined the room: `joinRoom(roomId)`
- Verify user is authenticated: `authenticate(...)`
- Check browser console for WebSocket errors
- Verify server is broadcasting to your room

### Messages Not Sending
- Check `isConnected` is true before sending
- Verify message content is not empty
- Check server logs for errors
- Verify room ID is correct

## Next Steps

1. Integrate WebSocket into your chat page
2. Add real-time message persistence to Supabase
3. Implement message history sync on reconnect
4. Add read receipts
5. Implement group video/voice calls using WebRTC
