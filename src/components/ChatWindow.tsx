import React, { useCallback, useState } from 'react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { useMessages } from '../hooks/useMessages';
import { useChatSubscription } from '../hooks/useChatSubscription';
import { Settings } from 'lucide-react';
import { GroupSettingsPanel } from './GroupSettingsPanel';
import { Message, ReplyToInfo } from '../types/message';

interface Props {
  walletAddress: string;
  sdk: any;
  onSendToChain?: (text: string) => Promise<void>;
  roomId?: string;
}

export const ChatWindow: React.FC<Props> = ({
  walletAddress,
  sdk,
  onSendToChain,
  roomId
}) => {
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ReplyToInfo | null>(null);

  const {
    messages,
    addMessage,
    loadMoreMessages,
    isLoading,
    isLoadingMore,
    hasMore,
    firstMessageId,
  } = useMessages({ roomId, pageSize: 50 });

  useChatSubscription(sdk, addMessage);

  const handleSend = useCallback(async (text: string, replyTo?: ReplyToInfo | null) => {
    addMessage({
      text,
      sender: walletAddress,
      isOwn: true,
      isEncrypted: true,
      replyTo: replyTo || null,
    });
    setReplyingTo(null);
    try {
      await onSendToChain?.(text);
    } catch (err) {
      console.error('Failed to send message to chain:', err);
    }
  }, [addMessage, walletAddress, onSendToChain]);

  const handleReply = useCallback((message: Message) => {
    setReplyingTo({
      id: message.id,
      text: message.text,
      sender: message.isOwn ? 'You' : message.sender,
    });
  }, []);

  const handleJumpToMessage = useCallback((msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-indigo-500');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-indigo-500');
      }, 2000);
    }
  }, []);

  const currentRoomName = roomId ? `Room: ${roomId.substring(0, 8)}...` : 'Main Anonymous Chat';

  return (
    <div className='flex flex-col h-full bg-gray-950 text-gray-100 relative overflow-hidden'>
      <div className="w-full h-14 bg-gray-900 border-b border-gray-800 px-6 flex items-center justify-between shadow-sm shrink-0">
        <div className="flex flex-col">
          <span className="font-bold text-sm tracking-wide text-gray-100">{currentRoomName}</span>
          <span className="text-[11px] text-green-400 font-medium flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            End-to-End Encrypted
          </span>
        </div>
        <button
          onClick={() => setIsPanelOpen(true)}
          className="p-2 bg-gray-800/40 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 text-gray-400 hover:text-purple-400 rounded-xl transition-all shadow-sm group"
          title="Open Group Settings"
        >
          <Settings className="size-4.5 transition-transform group-hover:rotate-45" />
        </button>
      </div>

      <MessageList
        messages={messages}
        onLoadMore={loadMoreMessages}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        firstMessageId={firstMessageId}
        onReply={handleReply}
        onJumpToMessage={handleJumpToMessage}
      />

      <MessageInput
        onSend={handleSend}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
      />

      <GroupSettingsPanel
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        roomName={currentRoomName}
      />
    </div>
  );
};