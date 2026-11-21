import React, { useState, useEffect } from 'react';
import { useMessageReadReceipts, type ReadReceipt } from '@/src/hooks/useMessageReadReceipts';

export interface MessageReadReceiptIndicatorProps {
  messageId: string;
  roomId: string;
  senderId: string;
  currentUserId: string;
  isOwn: boolean;
  disabled?: boolean;
}

export function MessageReadReceiptIndicator({
  messageId,
  roomId,
  senderId,
  currentUserId,
  isOwn,
  disabled = false,
}: MessageReadReceiptIndicatorProps) {
  const [showDetails, setShowDetails] = useState(false);
  const { readStatus, fetchReadReceipts } = useMessageReadReceipts({ 
    roomId, 
    userId: currentUserId,
    enabled: !disabled 
  });

  const messageReadData = readStatus[messageId];

  useEffect(() => {
    // Only fetch for own messages (sender can see read receipts)
    if (isOwn && !messageReadData && !disabled) {
      fetchReadReceipts(messageId);
    }
  }, [messageId, isOwn, messageReadData, disabled, fetchReadReceipts]);

  if (!isOwn || disabled || !messageReadData) {
    return null;
  }

  const { readCount, readReceipts } = messageReadData;

  if (readCount === 0) {
    return (
      <div className="flex items-center gap-1 text-xs text-gray-400" title="No read receipts">
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 cursor-pointer"
        title={`Read by ${readCount} ${readCount === 1 ? 'person' : 'people'}`}
      >
        <svg
          className="w-3 h-3"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
        <span>{readCount}</span>
      </button>

      {showDetails && readReceipts.length > 0 && (
        <div className="absolute bottom-full right-0 mb-2 bg-gray-900 text-white rounded-lg shadow-lg p-2 z-10 min-w-max text-xs">
          <div className="font-semibold mb-1 text-gray-300">Read by:</div>
          <div className="space-y-1">
            {readReceipts.map((receipt: ReadReceipt) => (
              <div key={receipt.userId} className="flex items-center gap-2">
                {receipt.avatar_url && (
                  <img
                    src={receipt.avatar_url}
                    alt={receipt.displayName}
                    className="w-4 h-4 rounded-full"
                  />
                )}
                <div>
                  <div className="text-gray-100">{receipt.displayName}</div>
                  <div className="text-gray-400">
                    {new Date(receipt.readAt).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
