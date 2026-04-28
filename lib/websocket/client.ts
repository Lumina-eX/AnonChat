import {
  WebSocketMessage,
  WebSocketEventType,
  WebSocketServerEventType,
  ConnectionState,
} from "@/types/websocket";
import { rateLimiter } from "@/lib/rate-limiter";
import { handleAppError } from "@/lib/error-handler";

const RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private messageHandlers: Map<
    WebSocketEventType,
    Set<(msg: WebSocketMessage) => void>
  >;
  private connectionStateHandlers: Set<(state: ConnectionState) => void>;
  private connectionState: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private clientId: string | null = null;
  private walletAddress: string | null = null;

  constructor(url: string) {
    this.url = url;
    this.messageHandlers = new Map();
    this.connectionStateHandlers = new Set();
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (
          this.connectionState === "connecting" ||
          this.connectionState === "connected"
        ) {
          return resolve();
        }

        this.setConnectionState("connecting");
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.reconnectDelay = INITIAL_RECONNECT_DELAY;
          this.setConnectionState("connected");
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as WebSocketMessage;
            if (message.type === "connection_established") {
              this.clientId = message.payload.clientId;
            }
            if (message.type === "error") {
              handleAppError(
                new Error(message.payload.message || "Server error"),
                "SEND_MESSAGE",
              );
            }
            const handlers = this.messageHandlers.get(message.type);
            handlers?.forEach((h) => h(message));
          } catch (error) {
            console.error("[WebSocket Client] Parse error", error);
          }
        };

        this.ws.onerror = (error) => {
          this.setConnectionState("error");
          handleAppError("WS_CONNECTION_FAILED", "NETWORK");
          reject(error);
        };

        this.ws.onclose = (event) => {
          this.setConnectionState("disconnected");
          if (event.code !== 1000) this.attemptReconnect();
        };
      } catch (error) {
        this.setConnectionState("error");
        handleAppError(error, "NETWORK");
        reject(error);
      }
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= RECONNECT_ATTEMPTS) {
      handleAppError("RECONNECT_LIMIT_REACHED", "NETWORK");
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY,
    );
    this.reconnectTimeout = setTimeout(
      () => this.connect().catch(() => {}),
      delay,
    );
  }

  disconnect(): void {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setConnectionState("disconnected");
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.connectionStateHandlers.forEach((h) => h(state));
    }
  }

  send(message: WebSocketMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  // --- Domain Methods ---

  sendMessage(
    roomId: string,
    content: string,
  ): { success: boolean; error?: string } {
    if (!this.walletAddress) {
      handleAppError("Wallet not connected", "WALLET_CONNECT");
      return { success: false };
    }

    const rateLimit = rateLimiter.check(this.walletAddress);
    if (!rateLimit.allowed) {
      const seconds = Math.ceil((rateLimit.remainingMs || 0) / 1000);
      const limitMsg = `Please wait ${seconds}s before sending another message.`;
      handleAppError(limitMsg, "SEND_MESSAGE");
      return { success: false, error: limitMsg };
    }

    if (!this.isConnected()) {
      handleAppError("OFFLINE", "NETWORK");
      return { success: false };
    }

    this.send({
      type: "send_message",
      payload: { roomId, content },
      timestamp: Date.now(),
    });
    return { success: true };
  }

  /**
   * FIX FOR JOB 72843331390:
   * Explicitly defining the missing method called in hooks.ts
   */
  notifyWalletEvent(action: "connect" | "disconnect", walletAddress: string) {
    this.send({
      type: "wallet_event",
      payload: { action, walletAddress },
      timestamp: Date.now(),
    });
  }

  authenticate(
    userId: string,
    walletAddress: string,
    displayName: string,
    avatarUrl?: string,
  ) {
    this.walletAddress = walletAddress;
    this.send({
      type: "auth",
      payload: { userId, walletAddress, displayName, avatarUrl },
      timestamp: Date.now(),
    });
  }

  onMessage(
    type: WebSocketServerEventType,
    handler: (msg: WebSocketMessage) => void,
  ) {
    if (!this.messageHandlers.has(type))
      this.messageHandlers.set(type, new Set());
    this.messageHandlers.get(type)?.add(handler);
    return () => this.messageHandlers.get(type)?.delete(handler);
  }

  onConnectionStateChange = (h: (s: ConnectionState) => void) => {
    this.connectionStateHandlers.add(h);
    return () => this.connectionStateHandlers.delete(h);
  };

  isConnected = () =>
    this.connectionState === "connected" &&
    this.ws?.readyState === WebSocket.OPEN;
  joinRoom = (roomId: string) =>
    this.send({
      type: "room_join",
      payload: { roomId },
      timestamp: Date.now(),
    });
  leaveRoom = (roomId: string) =>
    this.send({
      type: "leave_room",
      payload: { roomId },
      timestamp: Date.now(),
    });
  notifyTyping = (roomId: string) =>
    this.send({ type: "typing", payload: { roomId }, timestamp: Date.now() });
  notifyStopTyping = (roomId: string) =>
    this.send({
      type: "stop_typing",
      payload: { roomId },
      timestamp: Date.now(),
    });

  /**
   * FIX FOR JOB 72926850335:
   * Add missing method to acknowledge message delivery
   */
  markAsDelivered = (messageId: string, roomId: string) =>
    this.send({
      type: "message_delivered",
      payload: { messageId, roomId },
      timestamp: Date.now(),
    });
}

let instance: WebSocketClient | null = null;
export function getWebSocketClient(url?: string): WebSocketClient {
  if (!instance) {
    const wsUrl =
      url || process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";
    instance = new WebSocketClient(wsUrl);
  }
  return instance;
}

export function resetWebSocketClient() {
  if (instance) {
    instance.disconnect();
    instance = null;
  }
}
