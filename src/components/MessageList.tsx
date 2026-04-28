import React, { useEffect, useRef } from 'react';
import { Message } from '../types/message';
import { MessageItem } from '@/components/MessageItem';

interface Props {
  messages: Message[];
}

export const MessageList: React.FC<Props> = ({ messages }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const testMessage = {
  id: 'test-1',
  text: 'Great job! The encryption badge is working.',
  sender: 'System Test',
  timestamp: new Date(),
  isOwn: false,
  isEncrypted: true
};

  return (
    <div className='flex-1 overflow-y-auto px-4 py-2 space-y-1'>
      {/* 1. This forces your new test message to show up on the screen */}
      <MessageItem key={testMessage.id} message={testMessage} />

      {/* 2. This shows a message if there are no other real messages */}
      {messages.length === 0 && (
        <p className='text-center text-gray-600 text-sm mt-10'>Test Message Displayed Successfully!</p>
      )}
      
      {/* 3. This maps any real messages if they ever arrive */}
      {messages.map((msg) => (
        <MessageItem key={msg.id} message={msg} />
      ))}
      
      <div ref={bottomRef} />
    </div>
  );
};
