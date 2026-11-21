import { useState, useCallback, useEffect, useRef } from 'react';

export interface ReadReceipt {
  userId: string;
  displayName: string;
  avatar_url?: string;
  wallet_address?: string;
  readAt: number;
}

interface MessageReadStatus {
  [messageId: string]: {
    readCount: number;
    readReceipts: ReadReceipt[];
    isLoading: boolean;
  };
}

interface UseMessageReadReceiptsOptions {
  roomId?: string;
  userId?: string;
  enabled?: boolean;
}

export function useMessageReadReceipts(options: UseMessageReadReceiptsOptions = {}) {
  const { roomId, userId, enabled = true } = options;
  const [readStatus, setReadStatus] = useState<MessageReadStatus>({});
  const [isMarkingRead, setIsMarkingRead] = useState<{ [key: string]: boolean }>({});
  const readTimeoutsRef = useRef<{ [key: string]: NodeJS.Timeout }>({});

  /**
   * Mark a message as read
   * Debounced to avoid excessive API calls
   */
  const markMessageAsRead = useCallback(
    async (messageId: string) => {
      if (!enabled || !messageId) return;

      // Cancel any pending timeout for this message
      if (readTimeoutsRef.current[messageId]) {
        clearTimeout(readTimeoutsRef.current[messageId]);
      }

      // Debounce the actual API call by 500ms
      readTimeoutsRef.current[messageId] = setTimeout(async () => {
        try {
          setIsMarkingRead((prev) => ({ ...prev, [messageId]: true }));

          const response = await fetch(`/api/messages/${messageId}/read`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            console.error(`Failed to mark message ${messageId} as read`);
            return;
          }

          const data = await response.json();
          
          // Emit a WebSocket event to broadcast the read receipt
          if (window.__websocket && roomId) {
            window.__websocket.send({
              type: 'message_read',
              payload: {
                messageId,
                roomId,
              },
            });
          }

          // Update local state
          setReadStatus((prev) => ({
            ...prev,
            [messageId]: {
              ...prev[messageId],
              readCount: (prev[messageId]?.readCount || 0) + 1,
            },
          }));
        } catch (error) {
          console.error(`Error marking message ${messageId} as read:`, error);
        } finally {
          setIsMarkingRead((prev) => ({ ...prev, [messageId]: false }));
        }
      }, 500);
    },
    [enabled, roomId],
  );

  /**
   * Fetch read receipts for a specific message
   */
  const fetchReadReceipts = useCallback(
    async (messageId: string) => {
      if (!enabled || !messageId) return;

      try {
        setReadStatus((prev) => ({
          ...prev,
          [messageId]: { ...(prev[messageId] || {}), isLoading: true } as any,
        }));

        const response = await fetch(`/api/messages/${messageId}/read`);

        if (!response.ok) {
          console.error(`Failed to fetch read receipts for message ${messageId}`);
          return;
        }

        const data = await response.json();

        setReadStatus((prev) => ({
          ...prev,
          [messageId]: {
            readCount: data.readCount || 0,
            readReceipts: (data.readReceipts || []).map((r: any) => ({
              userId: r.user_id,
              displayName: r.profiles?.display_name || 'Anonymous',
              avatar_url: r.profiles?.avatar_url,
              wallet_address: r.profiles?.wallet_address,
              readAt: new Date(r.read_at).getTime(),
            })),
            isLoading: false,
          },
        }));
      } catch (error) {
        console.error(`Error fetching read receipts for message ${messageId}:`, error);
        setReadStatus((prev) => ({
          ...prev,
          [messageId]: {
            ...(prev[messageId] || {}),
            isLoading: false,
          } as any,
        }));
      }
    },
    [enabled],
  );

  /**
   * Handle incoming read receipt from WebSocket
   */
  const handleReadReceiptUpdate = useCallback(
    (event: any) => {
      if (event.type !== 'message_read_receipt') return;

      const { messageId, userId: readUserId, displayName, readAt, roomId: eventRoomId } = event.payload;

      // Only update if it's for a message in the current room
      if (roomId && roomId !== eventRoomId) return;

      setReadStatus((prev) => {
        const current = prev[messageId] || { readCount: 0, readReceipts: [], isLoading: false };
        
        // Check if this read receipt already exists
        const existingIndex = current.readReceipts.findIndex((r) => r.userId === readUserId);
        
        let updatedReceipts: ReadReceipt[];
        if (existingIndex >= 0) {
          // Update existing read receipt
          updatedReceipts = [...current.readReceipts];
          updatedReceipts[existingIndex] = {
            ...updatedReceipts[existingIndex],
            readAt,
          };
        } else {
          // Add new read receipt
          updatedReceipts = [
            ...current.readReceipts,
            {
              userId: readUserId,
              displayName,
              readAt,
            },
          ];
        }

        return {
          ...prev,
          [messageId]: {
            ...current,
            readCount: updatedReceipts.length,
            readReceipts: updatedReceipts.sort((a, b) => a.readAt - b.readAt),
          },
        };
      });
    },
    [roomId],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(readTimeoutsRef.current).forEach((timeout) => clearTimeout(timeout));
    };
  }, []);

  return {
    readStatus,
    markMessageAsRead,
    fetchReadReceipts,
    handleReadReceiptUpdate,
    isMarkingRead,
  };
}

// Make WebSocket accessible globally for the hook
declare global {
  interface Window {
    __websocket?: {
      send: (message: any) => void;
    };
  }
}
