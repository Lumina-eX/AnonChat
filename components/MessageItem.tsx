import React from 'react';
import { Message } from '@/src/types/message';
import { EncryptionBadge } from './EncryptionBadge';
import { Reply } from 'lucide-react';

interface Props {
  message: Message;
  onReply?: (message: Message) => void;
  onJumpToMessage?: (messageId: string) => void;
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const MessageItem: React.FC<Props> = ({ message, onReply, onJumpToMessage }) => {
  return (
    <div
      id={`msg-${message.id}`}
      data-message-id={message.id}
      className={message.isOwn ? 'group relative flex flex-col items-end mb-3' : 'group relative flex flex-col items-start mb-3'}
    >
      <div className="relative">
        <div className={message.isOwn ? 'max-w-xs md:max-w-md px-4 py-2 rounded-2xl text-sm break-words bg-blue-600 text-white' : 'max-w-xs md:max-w-md px-4 py-2 rounded-2xl text-sm break-words bg-gray-100 text-gray-900'}>
          {!message.isOwn && (
            <p className='text-xs text-indigo-400 mb-1 font-mono truncate'>{message.sender}</p>
          )}

          {message.replyTo && (
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onJumpToMessage?.(message.replyTo!.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onJumpToMessage?.(message.replyTo!.id);
                }
              }}
              className={message.isOwn
                ? 'mb-2 rounded-lg border-l-2 border-white/60 bg-white/10 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-white/20 transition-colors text-left'
                : 'mb-2 rounded-lg border-l-2 border-blue-600 bg-gray-200/80 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-gray-200 transition-colors text-left'
              }
              title="Click to jump to original message"
              aria-label={`Replying to: ${message.replyTo.text}`}
            >
              <div className="flex items-center gap-1 font-semibold text-[11px] opacity-90 mb-0.5">
                <Reply className="h-3 w-3 inline-block shrink-0" />
                <span className="truncate max-w-[180px]">{message.replyTo.sender || 'Replied message'}</span>
              </div>
              <p className={message.replyTo.isDeleted ? 'italic opacity-60 text-[11px] truncate' : 'opacity-85 text-[11px] truncate'}>
                {message.replyTo.isDeleted ? 'Original message was deleted' : message.replyTo.text}
              </p>
            </div>
          )}

          <p>{message.text}</p>
        </div>

        {onReply && (
          <button
            type="button"
            onClick={() => onReply(message)}
            className="absolute -top-3 right-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full bg-gray-800 text-gray-200 hover:bg-gray-700 shadow border border-gray-700 text-xs"
            title="Reply to message"
            aria-label="Reply to message"
          >
            <Reply className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 mt-1 px-1 flex-wrap">
        <span className='text-xs text-gray-500'>{formatTimestamp(message.timestamp)}</span>
        {message.editedAt && (
          <span className='text-xs text-gray-400 italic'>Edited</span>
        )}
        {message.isEncrypted && <EncryptionBadge />}
      </div>
    </div>
  );
};

