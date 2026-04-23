import React from 'react';
import { Message } from '../types/message';

interface Props {
  message: Message;
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const MessageItem: React.FC<Props> = ({ message }) => {
  return (
    <div className={message.isOwn ? 'flex flex-col items-end mb-3' : 'flex flex-col items-start mb-3'}>
      <div className={message.isOwn ? 'max-w-xs md:max-w-md px-4 py-2 rounded-2xl text-sm break-words bg-indigo-600 text-white rounded-br-none' : 'max-w-xs md:max-w-md px-4 py-2 rounded-2xl text-sm break-words bg-gray-800 text-gray-100 rounded-bl-none'}>
        {!message.isOwn && (
          <p className='text-xs text-indigo-400 mb-1 font-mono truncate'>{message.sender}</p>
        )}
        <p>{message.text}</p>
      </div>
      <span className='text-xs text-gray-500 mt-1 px-1'>{formatTimestamp(message.timestamp)}</span>
    </div>
  );
};
