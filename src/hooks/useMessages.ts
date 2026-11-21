import { useState, useCallback, useEffect, useRef } from 'react';
import { Message, MessageStatus } from '../types/message';

interface UseMessagesOptions {
  roomId?: string;
  pageSize?: number;
}

interface PaginationState {
  offset: number;
  hasMore: boolean;
}

export function useMessages(options: UseMessagesOptions = {}) {
  const { roomId, pageSize = 50 } = options;
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Use refs to prevent race conditions and stale closures
  const paginationRef = useRef<PaginationState>({ offset: 0, hasMore: true });
  const loadingRef = useRef(false);
  const firstMessageIdRef = useRef<string | null>(null);

  // Load initial messages on roomId change
  useEffect(() => {
    if (roomId) {
      // Reset pagination state
      paginationRef.current = { offset: 0, hasMore: true };
      firstMessageIdRef.current = null;
      loadMessages(0, true);
    }
  }, [roomId]);

  const loadMessages = useCallback(async (currentOffset: number, isInitial = false) => {
    if (!roomId) return;

    // Prevent concurrent requests
    if (loadingRef.current) return;

    loadingRef.current = true;
    if (isInitial) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }

    try {
      const response = await fetch(
        `/api/messages?room_id=${encodeURIComponent(roomId)}&limit=${pageSize}&offset=${currentOffset}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch messages');
      }

      const data = await response.json();
      const fetchedMessages = data.messages || [];

      // Transform API messages to Message type
      const transformedMessages: Message[] = fetchedMessages.map((msg: any) => ({
        id: msg.id,
        text: msg.content,
        sender: msg.profiles?.display_name || 'Anonymous',
        timestamp: new Date(msg.created_at),
        isOwn: false,
        isEncrypted: msg.is_encrypted || false,
        status: 'sent' as MessageStatus,
      }));

      setMessages((prevMessages) => {
        let newMessages: Message[];

        if (isInitial) {
          // Reverse for chronological order (API returns descending)
          newMessages = transformedMessages.reverse();
        } else {
          // Prepend older messages (they come in descending order, so reverse them)
          newMessages = [...transformedMessages.reverse(), ...prevMessages];
        }

        // Track first message ID for scroll restoration
        if (newMessages.length > 0 && transformedMessages.length > 0) {
          firstMessageIdRef.current = transformedMessages[transformedMessages.length - 1]?.id || null;
        }

        return newMessages;
      });

      // Update pagination state
      const hasMoreMessages = fetchedMessages.length === pageSize;
      paginationRef.current = {
        offset: currentOffset + fetchedMessages.length,
        hasMore: hasMoreMessages,
      };
    } catch (error) {
      console.error('Error loading messages:', error);
      paginationRef.current.hasMore = false;
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [roomId, pageSize]);

  const loadMoreMessages = useCallback(() => {
    // Prevent loading if already loading or no more messages
    if (loadingRef.current || !paginationRef.current.hasMore) return;

    loadMessages(paginationRef.current.offset, false);
  }, [loadMessages]);

  const addMessage = useCallback((msg: Omit<Message, 'id' | 'timestamp'>) => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newMsg: Message = {
      ...msg,
      id: tempId,
      tempId,
      timestamp: new Date(),
      status: msg.status ?? 'sending',
    };
    setMessages((prev) => [...prev, newMsg]);
    return tempId;
  }, []);

  const updateMessageStatus = useCallback((messageId: string, status: MessageStatus, serverId?: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === messageId || m.tempId === messageId) {
          const updated: Message = { ...m, status };
          if (serverId) {
            updated.id = serverId;
          }
          return updated;
        }
        return m;
      })
    );
  }, []);

  const retryMessage = useCallback((messageId: string, onRetry: (text: string) => Promise<void>) => {
    const msg = messages.find((m) => m.id === messageId || m.tempId === messageId);
    if (!msg || msg.status !== 'failed') return;

    updateMessageStatus(messageId, 'sending');
    onRetry(msg.text).catch(() => {
      updateMessageStatus(messageId, 'failed');
    });
  }, [messages, updateMessageStatus]);

  const removeMessage = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId && m.tempId !== messageId));
  }, []);

  return {
    messages,
    addMessage,
    updateMessageStatus,
    retryMessage,
    removeMessage,
    loadMoreMessages,
    isLoading,
    isLoadingMore,
    hasMore: paginationRef.current.hasMore,
    firstMessageId: firstMessageIdRef.current,
  };
}
