"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  WebSocketMessage,
  ConnectionState,
  WebSocketServerEventType,
} from "@/types/websocket";
import { getWebSocketClient } from "@/lib/websocket/client";

interface UseWebSocketOptions {
  autoConnect?: boolean;
  reconnect?: boolean;
}

interface UseWebSocketReturn {
  connectionState: ConnectionState;
  isConnected: boolean;
  send: (message: WebSocketMessage) => void;
  on: (
    type: WebSocketServerEventType,
    handler: (message: WebSocketMessage) => void,
  ) => () => void;
  connect: () => Promise<void>;
  disconnect: () => void;
}

/**
 * Core hook to interact with the WebSocket singleton instance.
 */
export function useWebSocket(
  options: UseWebSocketOptions = {},
): UseWebSocketReturn {
  const { autoConnect = true } = options;

  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const clientRef = useRef(getWebSocketClient());

  // Setup connection state listener
  useEffect(() => {
    const client = clientRef.current;
    const unsubscribe = client.onConnectionStateChange((state) => {
      setConnectionState(state);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Auto-connect on mount if required
  useEffect(() => {
    if (autoConnect) {
      const client = clientRef.current;

      if (!client.isConnected()) {
        client.connect().catch((error) => {
          // Technical log for debugging; UI is handled by handleAppError in the client
          console.error("[useWebSocket] Auto-connect failed:", error);
        });
      }
    }
  }, [autoConnect]);

  const send = useCallback((message: WebSocketMessage) => {
    clientRef.current.send(message);
  }, []);

  const on = useCallback(
    (
      type: WebSocketServerEventType,
      handler: (message: WebSocketMessage) => void,
    ): (() => void) => {
      return clientRef.current.onMessage(type, handler);
    },
    [],
  );

  const connect = useCallback(async () => {
    return clientRef.current.connect();
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current.disconnect();
  }, []);

  return {
    connectionState,
    isConnected: connectionState === "connected",
    send,
    on,
    connect,
    disconnect,
  };
}

/**
 * Hook for listening to specific message types.
 */
export function useWebSocketMessage(
  type: WebSocketServerEventType,
  handler?: (message: WebSocketMessage) => void,
): void {
  const { on } = useWebSocket({ autoConnect: false });

  useEffect(() => {
    if (!handler) return;

    const unsubscribe = on(type, handler);
    return unsubscribe;
  }, [type, handler, on]);
}

/**
 * Hook for checking connection status.
 */
export function useWebSocketConnected(): boolean {
  const { isConnected } = useWebSocket({ autoConnect: false });
  return isConnected;
}

/**
 * Hook for sending domain-specific messages.
 * Uses useCallback to prevent unnecessary re-renders in child components.
 */
export function useWebSocketSend() {
  const client = useRef(getWebSocketClient());

  return {
    authenticate: useCallback(
      (
        userId: string,
        walletAddress: string,
        displayName: string,
        avatarUrl?: string,
      ) => {
        client.current.authenticate(
          userId,
          walletAddress,
          displayName,
          avatarUrl,
        );
      },
      [],
    ),
    joinRoom: useCallback((roomId: string) => {
      client.current.joinRoom(roomId);
    }, []),
    leaveRoom: useCallback((roomId: string) => {
      client.current.leaveRoom(roomId);
    }, []),
    sendMessage: useCallback((roomId: string, content: string) => {
      return client.current.sendMessage(roomId, content);
    }, []),
    notifyTyping: useCallback((roomId: string) => {
      client.current.notifyTyping(roomId);
    }, []),
    notifyStopTyping: useCallback((roomId: string) => {
      client.current.notifyStopTyping(roomId);
    }, []),
    /**
     * Resolves Job 72843331390 by calling the newly added method in WebSocketClient.
     */
    notifyWalletEvent: useCallback(
      (action: "connect" | "disconnect", walletAddress: string) => {
        client.current.notifyWalletEvent(action, walletAddress);
      },
      [],
    ),
    /**
     * FIX FOR JOB 72926850335:
     * Add missing method to acknowledge message delivery
     */
    markAsDelivered: useCallback((messageId: string, roomId: string) => {
      client.current.markAsDelivered(messageId, roomId);
    }, []),
  };
}
