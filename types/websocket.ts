// Server-to-client event types
export type WebSocketServerEventType =
  | "message"
  | "message_duplicate"
  | "message_status_update"
  | "message_edit"
  | "message_read_receipt"
  | "room_join"
  | "room_leave"
  | "user_typing"
  | "user_stop_typing"
  | "wallet_connect"
  | "wallet_disconnect"
  | "presence_update"
  | "presence_snapshot"
  | "notification"
  | "error"
  | "connection_established"

// Client-to-server event types
export type WebSocketClientEventType =
  | "auth"
  | "join_room"
  | "leave_room"
  | "send_message"
  | "message_delivered"
  | "edit_message"
  | "message_read"
  | "typing"
  | "stop_typing"
  | "wallet_event"
  | "request_presence_snapshot"
  | "pong"

// All event types
export type WebSocketEventType = WebSocketServerEventType | WebSocketClientEventType

export interface WebSocketMessage {
  type: WebSocketEventType
  payload: Record<string, any>
  timestamp: number
}

export interface UserPresence {
  userId: string
  displayName: string
  walletAddress?: string
  status: "online" | "offline" | "away"
  lastSeen: number
}

export interface RoomPresence {
  roomId: string
  users: UserPresence[]
}

export interface ChatMessage {
  id: string
  /** Client-generated UUID for idempotent delivery. Same value must be sent on retry. */
  clientMessageId?: string
  roomId: string
  userId: string
  displayName: string
  avatarUrl?: string
  content: string
  createdAt: number
  status?: "sending" | "sent" | "delivered"
}

export interface RoomMember {
  userId: string
  roomId: string
  displayName: string
  avatarUrl?: string
  joinedAt: number
}

export interface WalletEvent {
  userId: string
  action: "connect" | "disconnect"
  walletAddress: string
  timestamp: number
}

// WebSocket connection state
export type ConnectionState = "connecting" | "connected" | "disconnected" | "error"

export interface WebSocketContextType {
  connectionState: ConnectionState
  isConnected: boolean
  send: (event: WebSocketMessage) => void
  on: (type: WebSocketEventType, callback: (message: WebSocketMessage) => void) => () => void
  connect: () => Promise<void>
  disconnect: () => void
}