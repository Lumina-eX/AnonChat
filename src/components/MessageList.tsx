import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Message } from '../types/message';
import { MessageItem } from '@/components/MessageItem';

interface Props {
  messages: Message[];
  onLoadMore?: () => void;
  isLoading?: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  firstMessageId?: string | null;
  onReply?: (message: Message) => void;
  onJumpToMessage?: (messageId: string) => void;
}

export const MessageList: React.FC<Props> = ({
  messages,
  onLoadMore,
  isLoading = false,
  isLoadingMore = false,
  hasMore = false,
  firstMessageId,
  onReply,
  onJumpToMessage,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const firstMessageRef = useRef<HTMLDivElement>(null);
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(true);
  const loadMoreObserverRef = useRef<IntersectionObserver | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  // Setup IntersectionObserver for load-more trigger
  useEffect(() => {
    if (!onLoadMore || isLoading || isLoadingMore || !hasMore) {
      loadMoreObserverRef.current?.disconnect();
      return;
    }

    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;

    loadMoreObserverRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !isLoadingMore && !isLoading) {
            onLoadMore();
          }
        });
      },
      { threshold: 0.1, rootMargin: '50px' }
    );

    loadMoreObserverRef.current.observe(sentinel);

    return () => {
      loadMoreObserverRef.current?.disconnect();
    };
  }, [onLoadMore, isLoading, isLoadingMore, hasMore]);

  // Scroll to bottom on initial load or new messages
  useEffect(() => {
    if (shouldScrollToBottom && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, shouldScrollToBottom]);

  // Restore scroll position to first old message after loading more
  useEffect(() => {
    if (firstMessageRef.current && !isLoadingMore && firstMessageId) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        if (firstMessageRef.current && scrollContainerRef.current) {
          firstMessageRef.current.scrollIntoView({ block: 'start' });
        }
      });
    }
  }, [firstMessageId, isLoadingMore]);

  // Handle scroll event for manual pagination detection and auto-scroll logic
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Check if user is near bottom to enable auto-scroll for new messages
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    setShouldScrollToBottom(isNearBottom);
  }, []);

  return (
    <div
      ref={scrollContainerRef}
      className='flex-1 overflow-y-auto px-4 py-2 space-y-1'
      onScroll={handleScroll}
    >
      {/* Sentinel element for IntersectionObserver to trigger load more */}
      <div ref={loadMoreSentinelRef} className='h-1' />

      {/* Loading indicator at top */}
      {isLoadingMore && (
        <div className='flex justify-center py-2'>
          <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500'></div>
        </div>
      )}

      {/* Show message if no more messages to load */}
      {!hasMore && messages.length > 0 && (
        <p className='text-center text-gray-500 text-xs py-2'>
          Beginning of conversation
        </p>
      )}

      {/* Empty state */}
      {messages.length === 0 && !isLoading && (
        <p className='text-center text-gray-600 text-sm mt-10'>
          No messages yet. Start the conversation!
        </p>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className='flex justify-center py-8'>
          <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500'></div>
        </div>
      )}
      
      {/* Message list */}
      {messages.map((msg, index) => (
        <div
          key={msg.id}
          ref={index === 0 ? firstMessageRef : undefined}
          data-message-id={msg.id}
        >
          <MessageItem
            message={msg}
            onReply={onReply}
            onJumpToMessage={onJumpToMessage}
          />
        </div>
      ))}
      
      <div ref={bottomRef} />
    </div>
  );
};
