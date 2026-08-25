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

/** Maximum number of client-side sent message IDs to retain in memory. */
const MAX_SENT_IDS = 500;

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
  private userId: string | null = null;
  private displayName: string | null = null;
  private avatarUrl: string | undefined = undefined;
  private joinedRooms: Set<string> = new Set();
  /**
   * Tracks client_message_ids that have already been dispatched so accidental
   * double-sends from the same client instance are caught locally, before the
   * message reaches the server.  Values are dispatch timestamps (ms).
   * Evicted when the cache exceeds MAX_SENT_IDS.
   */
  private sentMessageIds: Map<string, number> = new Map();

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

          // Restore session on reconnect
          if (this.userId && this.walletAddress && this.displayName) {
            this.authenticate(this.userId, this.walletAddress, this.displayName, this.avatarUrl);
          }
          this.joinedRooms.forEach((roomId) => {
            this.send({
              type: "room_join",
              payload: { roomId },
              timestamp: Date.now(),
            });
          });

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

  /**
   * Register a client_message_id as sent, evicting the oldest entry when the
   * cache is full to keep memory usage bounded.
   */
  private trackSentId(clientMessageId: string): void {
    if (this.sentMessageIds.size >= MAX_SENT_IDS) {
      // Evict the oldest entry (insertion-ordered Map)
      const firstKey = this.sentMessageIds.keys().next().value;
      if (firstKey !== undefined) this.sentMessageIds.delete(firstKey);
    }
    this.sentMessageIds.set(clientMessageId, Date.now());
  }

  sendMessage(
    roomId: string,
    content: string,
    /**
     * Optional pre-generated client_message_id.  Pass the same value on
     * retry; omit (or pass undefined) to auto-generate a fresh one.
     */
    clientMessageId?: string,
  ): { success: boolean; error?: string; clientMessageId?: string } {
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

    // Generate a fresh UUID if the caller did not supply one
    const msgId = clientMessageId ?? crypto.randomUUID();

    // Client-side duplicate guard: if this ID was already sent in this session,
    // skip re-sending.  The server also deduplicates, but catching it here avoids
    // a redundant round-trip.
    if (this.sentMessageIds.has(msgId)) {
      console.warn(
        `[WebSocketClient] Duplicate send blocked client-side (clientMessageId=${msgId})`,
      );
      return { success: true, clientMessageId: msgId };
    }

    this.trackSentId(msgId);

    this.send({
      type: "send_message",
      payload: { roomId, content, clientMessageId: msgId },
      timestamp: Date.now(),
    });
    return { success: true, clientMessageId: msgId };
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
    this.userId = userId;
    this.walletAddress = walletAddress;
    this.displayName = displayName;
    this.avatarUrl = avatarUrl;
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
  joinRoom = (roomId: string) => {
    this.joinedRooms.add(roomId);
    this.send({
      type: "room_join",
      payload: { roomId },
      timestamp: Date.now(),
    });
  };
  leaveRoom = (roomId: string) => {
    this.joinedRooms.delete(roomId);
    this.send({
      type: "leave_room",
      payload: { roomId },
      timestamp: Date.now(),
    });
  };
  notifyTyping = (roomId: string) =>
    this.send({ type: "typing", payload: { roomId }, timestamp: Date.now() });
  notifyStopTyping = (roomId: string) =>
    this.send({
      type: "stop_typing",
      payload: { roomId },
      timestamp: Date.now(),
    });

  requestPresenceSnapshot = () =>
    this.send({
      type: "request_presence_snapshot",
      payload: {},
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

  editMessage = (messageId: string, roomId: string, content: string) => {
    if (!this.isConnected()) {
      return { success: false, error: "OFFLINE" } as const;
    }
    this.send({
      type: "edit_message",
      payload: { messageId, roomId, content },
      timestamp: Date.now(),
    });
    return { success: true } as const;
  };
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
