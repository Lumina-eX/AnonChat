import React from 'react';
import { Message } from '@/src/types/message';
import { EncryptionBadge } from './EncryptionBadge';

interface Props {
  message: Message;
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const MessageItem: React.FC<Props> = ({ message }) => {
  return (
    <div className={message.isOwn ? 'flex flex-col items-end mb-3' : 'flex flex-col items-start mb-3'}>
      <div className={message.isOwn ? 'max-w-xs md:max-w-md px-4 py-2 rounded-2xl text-sm break-words bg-blue-600 text-white' : 'max-w-xs md:max-w-md px-4 py-2 rounded-2xl text-sm break-words bg-gray-100 text-gray-900'}>
        {!message.isOwn && (
          <p className='text-xs text-indigo-400 mb-1 font-mono truncate'>{message.sender}</p>
        )}
        <p>{message.text}</p>
      </div>
      <div className="flex items-center gap-1 mt-1 px-1">
        <span className='text-xs text-gray-500'>{formatTimestamp(message.timestamp)}</span>
        {message.isEncrypted && <EncryptionBadge />}
      </div>
    </div>
  );
};