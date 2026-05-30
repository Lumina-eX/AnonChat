"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Message, ReadReceipt } from "../types/message";
import { useWebSocketSend, useWebSocketMessage } from "@/lib/websocket/hooks";
import { WebSocketMessage } from "@/types/websocket";

interface UseReadReceiptsOptions {
  roomId: string;
  messages: Message[];
  currentUserId?: string;
  /** CSS selector for the scroll container. Defaults to the first scrollable parent. */
  scrollContainerSelector?: string;
}

interface UseReadReceiptsReturn {
  /** Map of messageId → array of read receipts */
  readReceipts: Map<string, ReadReceipt[]>;
  /** Get the count of users who read a specific message */
  getReadCount: (messageId: string) => number;
  /** Check if a specific user has read a specific message */
  hasUserRead: (messageId: string, userId: string) => boolean;
}

const BATCH_DELAY_MS = 500;

export function useReadReceipts(
  options: UseReadReceiptsOptions,
): UseReadReceiptsReturn {
  const { roomId, messages, currentUserId } = options;

  const [readReceipts, setReadReceipts] = useState<Map<string, ReadReceipt[]>>(
    new Map(),
  );

  const { markAsRead } = useWebSocketSend();

  // Batch pending message IDs to mark as read
  const pendingReadIdsRef = useRef<Set<string>>(new Set());
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const observedElementsRef = useRef<Set<Element>>(new Set());

  // Flush batched read receipts to API + WebSocket
  const flushReadBatch = useCallback(() => {
    const ids = Array.from(pendingReadIdsRef.current);
    if (ids.length === 0 || !roomId) return;

    pendingReadIdsRef.current.clear();

    // Persist to database
    fetch("/api/messages/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_ids: ids, room_id: roomId }),
    }).catch((err) =>
      console.error("[useReadReceipts] Failed to persist reads:", err),
    );

    // Broadcast via WebSocket for real-time updates
    markAsRead(roomId, ids);

    // Optimistically update local state
    if (currentUserId) {
      setReadReceipts((prev) => {
        const updated = new Map(prev);
        const now = new Date();
        for (const id of ids) {
          const existing = updated.get(id) || [];
          // Don't add duplicate
          if (!existing.some((r) => r.userId === currentUserId)) {
            updated.set(id, [...existing, { userId: currentUserId, readAt: now }]);
          }
        }
        return updated;
      });
    }
  }, [roomId, markAsRead, currentUserId]);

  // Schedule a batched flush
  const scheduleFlush = useCallback(() => {
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
    }
    batchTimerRef.current = setTimeout(flushReadBatch, BATCH_DELAY_MS);
  }, [flushReadBatch]);

  // Mark a message as read (add to pending batch)
  const markMessageRead = useCallback(
    (messageId: string) => {
      if (!currentUserId) return;

      // Skip if we already know this user read it
      const existing = readReceipts.get(messageId);
      if (existing?.some((r) => r.userId === currentUserId)) return;

      pendingReadIdsRef.current.add(messageId);
      scheduleFlush();
    },
    [currentUserId, readReceipts, scheduleFlush],
  );

  // Setup IntersectionObserver for auto-detecting visible messages
  useEffect(() => {
    if (!currentUserId) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const messageId = (entry.target as HTMLElement).dataset.messageId;
            if (messageId) {
              markMessageRead(messageId);
            }
          }
        }
      },
      {
        threshold: 0.5, // At least 50% visible
        rootMargin: "0px",
      },
    );

    return () => {
      observerRef.current?.disconnect();
      observedElementsRef.current.clear();
    };
  }, [currentUserId, markMessageRead]);

  // Observe/unobserve message elements as messages change
  useEffect(() => {
    const observer = observerRef.current;
    if (!observer || !currentUserId) return;

    // Find all message elements in the DOM
    const messageElements = document.querySelectorAll("[data-message-id]");
    const currentElements = new Set<Element>();

    messageElements.forEach((el) => {
      currentElements.add(el);
      const messageId = (el as HTMLElement).dataset.messageId;
      if (!messageId) return;

      // Find the message to check if it's our own
      const msg = messages.find((m) => m.id === messageId);
      if (!msg || msg.isOwn) return; // Don't track reads on own messages

      // Only observe if not already observed
      if (!observedElementsRef.current.has(el)) {
        observer.observe(el);
        observedElementsRef.current.add(el);
      }
    });

    // Unobserve elements that are no longer in the DOM
    observedElementsRef.current.forEach((el) => {
      if (!currentElements.has(el)) {
        observer.unobserve(el);
        observedElementsRef.current.delete(el);
      }
    });
  }, [messages, currentUserId]);

  // Listen for incoming read receipts from other users
  useWebSocketMessage("message_read", (msg: WebSocketMessage) => {
    const payload = msg.payload as {
      roomId: string;
      messageIds: string[];
      userId: string;
      readAt: number;
    };

    if (payload.roomId !== roomId) return;

    setReadReceipts((prev) => {
      const updated = new Map(prev);
      const readAt = new Date(payload.readAt);

      for (const messageId of payload.messageIds) {
        const existing = updated.get(messageId) || [];
        // Don't add duplicate
        if (!existing.some((r) => r.userId === payload.userId)) {
          updated.set(messageId, [
            ...existing,
            { userId: payload.userId, readAt },
          ]);
        }
      }

      return updated;
    });
  });

  // Fetch existing read receipts when room changes or messages load
  useEffect(() => {
    if (!roomId || messages.length === 0) return;

    const messageIds = messages.map((m) => m.id).join(",");

    fetch(
      `/api/messages/read?room_id=${encodeURIComponent(roomId)}&message_ids=${encodeURIComponent(messageIds)}`,
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.reads && Array.isArray(data.reads)) {
          const receiptsMap = new Map<string, ReadReceipt[]>();
          for (const read of data.reads) {
            const existing = receiptsMap.get(read.message_id) || [];
            existing.push({
              userId: read.user_id,
              readAt: new Date(read.read_at),
            });
            receiptsMap.set(read.message_id, existing);
          }
          setReadReceipts(receiptsMap);
        }
      })
      .catch((err) =>
        console.error("[useReadReceipts] Failed to fetch reads:", err),
      );
  }, [roomId, messages.length]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
      // Flush any remaining pending reads
      flushReadBatch();
    };
  }, [flushReadBatch]);

  const getReadCount = useCallback(
    (messageId: string): number => {
      return readReceipts.get(messageId)?.length || 0;
    },
    [readReceipts],
  );

  const hasUserRead = useCallback(
    (messageId: string, userId: string): boolean => {
      return (
        readReceipts.get(messageId)?.some((r) => r.userId === userId) || false
      );
    },
    [readReceipts],
  );

  return {
    readReceipts,
    getReadCount,
    hasUserRead,
  };
}
