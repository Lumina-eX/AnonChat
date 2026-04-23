import React, { useState, useRef, KeyboardEvent } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export const MessageInput: React.FC<Props> = ({ onSend, disabled }) => {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className='flex items-end gap-2 px-4 py-3 border-t border-gray-800 bg-gray-950'>
      <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={handleKeyDown} placeholder='Type a message...' disabled={disabled} rows={1} className='flex-1 resize-none rounded-xl bg-gray-800 text-gray-100 placeholder-gray-500 px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 max-h-32 overflow-y-auto' />
      <button onClick={handleSend} disabled={disabled || !text.trim()} className='px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'>Send</button>
    </div>
  );
};
