# WebSocket Integration Guide

## Overview
This document explains how to implement WebSocket support in the AnonChat application for real-time messaging and live synchronization.

## Setup Instructions

### 1. Environment Variables
Add the following to your `.env.local`:

```env
# WebSocket Server Configuration
NEXT_PUBLIC_WS_URL=ws://localhost:3001
WS_PORT=3001
```

### 2. Starting the WebSocket Server

Option A: Terminal 1 - Run WebSocket server and Next.js separately
```bash
# Terminal 1: Start WebSocket server
node scripts/start-ws-server.js

# Terminal 2: Start Next.js dev server
npm run dev
```

Option B: Single command with concurrently (recommended)
```bash
npm install -D concurrently
```

Then add to `package.json` scripts:
```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:next\" \"node scripts/start-ws-server.js\"",
    "dev:next": "next dev"
  }
}
```

### 3. Integration with React Components

#### Wrap your app with WebSocketProvider

In `app/layout.tsx`:
```tsx
import { WebSocketProvider } from "@/lib/websocket/context"

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

#### Use WebSocket in Components

Example in a chat component:
```tsx
import { useWebSocket, useWebSocketSend } from "@/lib/websocket/hooks"

export function ChatComponent() {
  const { isConnected, connectionState } = useWebSocket()
  const { sendMessage, joinRoom, authenticate } = useWebSocketSend()

  // Authenticate user when component mounts
  useEffect(() => {
    if (userAddress && displayName) {
      authenticate(userId, userAddress, displayName, avatarUrl)
      joinRoom(roomId)
    }
  }, [userId, userAddress, displayName])

  // Listen for incoming messages
  useEffect(() => {
    const unsubscribe = onMessage("message", (msg) => {
      // Handle new message
      setMessages(prev => [...prev, msg.payload])
    })

    return unsubscribe
  }, [])

  // Send message
  const handleSendMessage = (content: string) => {
    sendMessage(roomId, content)
  }

  return (
    <div>
      <div>Connection: {connectionState}</div>
      {isConnected && <input onSend={handleSendMessage} />}
    </div>
  )
}
```

## WebSocket Event Types

### Client → Server Messages
- `auth` - Authenticate user connection
- `join_room` - Join a specific room
- `leave_room` - Leave a room
- `send_message` - Send a message to a room
- `typing` - Notify that user is typing
- `stop_typing` - Notify that user stopped typing
- `wallet_event` - Wallet connect/disconnect event

### Server → Client Messages
- `connection_established` - Connection started
- `message` - New message received
- `room_join` - User joined room
- `room_leave` - User left room
- `user_typing` - User is typing
- `user_stop_typing` - User stopped typing
- `wallet_connect` - User connected wallet
- `wallet_disconnect` - User disconnected wallet
- `presence_update` - User presence changed
- `error` - Error occurred

## API Reference

### useWebSocket() Hook
Main hook for WebSocket functionality:
```tsx
const {
  connectionState,      // "connecting" | "connected" | "disconnected" | "error"
  isConnected,         // boolean
  send,               // (message: WebSocketMessage) => void
  on,                 // (type: EventType, handler) => unsubscribe
  connect,            // () => Promise<void>
  disconnect,         // () => void
} = useWebSocket()
```

### useWebSocketSend() Hook
Convenience methods for common operations:
```tsx
const {
  authenticate,
  joinRoom,
  leaveRoom,
  sendMessage,
  notifyTyping,
  notifyStopTyping,
  notifyWalletEvent,
} = useWebSocketSend()
```

## Real-Time Features Implemented

✅ **Real-time Messaging**
- Instant message delivery to all room members
- Message status tracking (sending → sent → delivered → read)

✅ **Group Activity Updates**
- User join/leave notifications
- Typing indicators
- Presence indicators (online/away/offline)

✅ **Wallet Integration**
- Automatic wallet connect/disconnect notifications
- Broadcast to all connected clients

✅ **Reconnection Logic**
- Automatic reconnection with exponential backoff
- Max 5 reconnection attempts
- Maintains connection state during brief disconnects

✅ **Security**
- Message-based authentication
- Per-room message isolation
- Type-safe event handling

## Production Deployment

### For Vercel/Serverless
Since Vercel doesn't support long-lived WebSocket connections, use one of:

1. **External WebSocket Service**
   - Heroku, Railway.app, or Render for WebSocket server
   - Update `NEXT_PUBLIC_WS_URL` to external service

2. **Socket.io via Polling**
   - Socket.io can fallback to polling for compatibility
   - Use `npm install socket.io-client`

Example with Socket.io:
```tsx
import io from "socket.io-client"

const socket = io(process.env.NEXT_PUBLIC_WS_URL, {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
  transports: ["websocket", "polling"],
})
```

## Troubleshooting

### Connection Fails
- Check WebSocket server is running: `ws://localhost:3001`
- Verify `NEXT_PUBLIC_WS_URL` in environment variables
- Check browser console for connection errors

### Messages Not Received
- Verify user is authenticated via `auth` message
- Check room is joined via `join_room` message
- Verify server is broadcasting to room

### Disconnections
- Check server logs for errors
- Monitor network tab for WebSocket status
- Verify reconnection attempts are occurring

## Architecture

```
┌─────────────────────────────────────────────────┐
│         Next.js App (Client)                    │
├─────────────────────────────────────────────────┤
│                                                 │
│  React Components                               │
│      ↓                                          │
│  useWebSocket Hook                              │
│      ↓                                          │
│  WebSocket Client (lib/websocket/client.ts)    │
│      ↓                                          │
│  WebSocket Connection (ws://localhost:3001)    │
│                                                 │
└─────────────────────────────────────────────────┘
           ↑                    ↓
           │ WebSocket Protocol │
           ↓                    ↑
┌─────────────────────────────────────────────────┐
│     WebSocket Server (Node.js)                  │
├─────────────────────────────────────────────────┤
│                                                 │
│  Message Routing                                │
│  - Room broadcasts                              │
│  - User presence tracking                       │
│  - Event distribution                           │
│                                                 │
│  In-Memory Storage                              │
│  - Connected clients                            │
│  - Room memberships                             │
│  - User presence data                           │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Next Steps

1. ✅ Basic WebSocket infrastructure created
2. 🔄 Update chat page to use WebSocket for real-time messages
3. 🔄 Integrate with Supabase for persistence
4. 🔄 Add typing indicators component
5. 🔄 Enhance presence awareness
6. 🔄 Test with multiple clients
7. 🔄 Deploy to production with external WebSocket service
