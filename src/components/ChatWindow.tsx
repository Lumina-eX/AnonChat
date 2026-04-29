import React, { useCallback } from 'react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { useMessages } from '../hooks/useMessages';
import { useChatSubscription } from '../hooks/useChatSubscription';

interface Props {
  walletAddress: string;
  sdk: any;
  onSendToChain?: (text: string) => Promise<void>;
}

export const ChatWindow: React.FC<Props> = ({ walletAddress, sdk, onSendToChain }) => {
  const { messages, addMessage } = useMessages();

  useChatSubscription(sdk, addMessage);

  const handleSend = useCallback(async (text: string) => {
    addMessage({ text, sender: walletAddress, isOwn: true });
    try {
      await onSendToChain?.(text);
    } catch (err) {
      console.error('Failed to send message to chain:', err);
    }
  }, [addMessage, walletAddress, onSendToChain]);

  return (
    <div className='flex flex-col h-full bg-gray-950 text-gray-100'>
      <MessageList messages={messages} />
      <MessageInput onSend={handleSend} />
    </div>
  );
};
