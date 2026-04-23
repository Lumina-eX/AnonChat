// WebSocket Client
export { WebSocketClient, getWebSocketClient, resetWebSocketClient } from "./client"

// WebSocket Hooks
export {
  useWebSocket,
  useWebSocketMessage,
  useWebSocketConnected,
  useWebSocketSend,
} from "./hooks"

// WebSocket Context
export { WebSocketProvider, useWebSocketContext } from "./context"

// WebSocket Utilities
export {
  authenticateWebSocket,
  joinWebSocketRoom,
  leaveWebSocketRoom,
  sendWebSocketMessage,
  notifyWebSocketTyping,
  notifyWebSocketStopTyping,
  notifyWebSocketWalletEvent,
  getWebSocketStatus,
  isWebSocketConnected,
  disconnectWebSocket,
} from "./utils"

// Chat-specific hooks
export { useRealtimeChat, TypingIndicatorComponent, RoomUsersList } from "./chat-hooks"

// Types
export type {
  WebSocketEventType,
  WebSocketMessage,
  UserPresence,
  RoomPresence,
  ChatMessage,
  RoomMember,
  WalletEvent,
  ConnectionState,
  WebSocketContextType,
} from "@/types/websocket"
