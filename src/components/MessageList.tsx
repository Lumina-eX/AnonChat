import React, { useEffect, useRef } from 'react';
import { Message } from '../types/message';
import { MessageItem } from './MessageItem';

interface Props {
  messages: Message[];
}

export const MessageList: React.FC<Props> = ({ messages }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className='flex-1 overflow-y-auto px-4 py-2 space-y-1'>
      {messages.length === 0 && (
        <p className='text-center text-gray-600 text-sm mt-10'>No messages yet. Start the conversation.</p>
      )}
      {messages.map((msg) => (
        <MessageItem key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
};
