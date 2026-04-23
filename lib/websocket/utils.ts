import { getWebSocketClient } from "@/lib/websocket/client"

/**
 * Authenticates the WebSocket connection with the current user's information
 * This should be called after the user is logged in
 */
export async function authenticateWebSocket(
  userId: string,
  walletAddress: string,
  displayName: string,
  avatarUrl?: string,
) {
  const client = getWebSocketClient()

  try {
    // Ensure connected
    if (!client.isConnected()) {
      await client.connect()
    }

    // Send authentication message
    client.authenticate(userId, walletAddress, displayName, avatarUrl)

    console.log("[WebSocket Auth] Authenticated user:", userId)
  } catch (error) {
    console.error("[WebSocket Auth] Failed to authenticate:", error)
    throw error
  }
}

/**
 * Joins a room in the WebSocket connection
 */
export function joinWebSocketRoom(roomId: string) {
  const client = getWebSocketClient()

  if (!client.isConnected()) {
    console.warn("[WebSocket] Not connected, cannot join room")
    return
  }

  client.joinRoom(roomId)
  console.log("[WebSocket] Joined room:", roomId)
}

/**
 * Leaves a room in the WebSocket connection
 */
export function leaveWebSocketRoom(roomId: string) {
  const client = getWebSocketClient()

  if (!client.isConnected()) {
    console.warn("[WebSocket] Not connected, cannot leave room")
    return
  }

  client.leaveRoom(roomId)
  console.log("[WebSocket] Left room:", roomId)
}

/**
 * Sends a message via WebSocket
 */
export function sendWebSocketMessage(roomId: string, content: string) {
  const client = getWebSocketClient()

  if (!client.isConnected()) {
    console.warn("[WebSocket] Not connected, cannot send message")
    return
  }

  client.sendMessage(roomId, content)
}

/**
 * Notifies that the user is typing
 */
export function notifyWebSocketTyping(roomId: string) {
  const client = getWebSocketClient()

  if (!client.isConnected()) {
    return
  }

  client.notifyTyping(roomId)
}

/**
 * Notifies that the user stopped typing
 */
export function notifyWebSocketStopTyping(roomId: string) {
  const client = getWebSocketClient()

  if (!client.isConnected()) {
    return
  }

  client.notifyStopTyping(roomId)
}

/**
 * Notifies a wallet connect/disconnect event
 */
export function notifyWebSocketWalletEvent(action: "connect" | "disconnect", walletAddress: string) {
  const client = getWebSocketClient()

  if (!client.isConnected()) {
    return
  }

  client.notifyWalletEvent(action, walletAddress)
}

/**
 * Gets the current WebSocket connection status
 */
export function getWebSocketStatus() {
  const client = getWebSocketClient()
  return client.getConnectionState()
}

/**
 * Checks if WebSocket is currently connected
 */
export function isWebSocketConnected() {
  const client = getWebSocketClient()
  return client.isConnected()
}

/**
 * Disconnects the WebSocket
 */
export function disconnectWebSocket() {
  const client = getWebSocketClient()
  client.disconnect()
}
