import React, { useState, useRef, KeyboardEvent } from 'react';
import { ReplyToInfo } from '../types/message';
import { Reply, X } from 'lucide-react';

interface Props {
  onSend: (text: string, replyTo?: ReplyToInfo | null) => void;
  disabled?: boolean;
  replyingTo?: ReplyToInfo | null;
  onCancelReply?: () => void;
}

export const MessageInput: React.FC<Props> = ({ onSend, disabled, replyingTo, onCancelReply }) => {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, replyingTo);
    setText('');
    onCancelReply?.();
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && replyingTo) {
      e.preventDefault();
      onCancelReply?.();
      return;
    }
    // Handle Enter key for sending message (only when not combined with Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Only send if there's actual content to send
      if (text.trim()) {
        handleSend();
      }
    }
  };

  return (
    <div className='flex flex-col border-t border-gray-800 bg-gray-950'>
      {replyingTo && (
        <div className="flex items-center justify-between px-4 py-2 bg-gray-900/80 border-b border-gray-800 text-xs text-gray-300">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Reply className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="font-semibold text-indigo-400 text-[11px]">
                Replying to {replyingTo.sender || 'message'}
              </span>
              <p className="text-gray-400 truncate text-xs">{replyingTo.text}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-gray-100 transition-colors"
            title="Cancel reply (Esc)"
            aria-label="Cancel reply"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className='flex items-end gap-2 px-4 py-3'>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='Type a message (Enter to send, Shift+Enter for new line)'
          disabled={disabled}
          rows={1}
          className='flex-1 resize-none rounded-xl bg-gray-800 text-gray-100 placeholder-gray-500 px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 max-h-32 overflow-y-auto'
        />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className='px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
        >
          Send
        </button>
      </div>
    </div>
  );
};

