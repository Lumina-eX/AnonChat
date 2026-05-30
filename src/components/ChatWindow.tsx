import React, { useCallback, useState, useEffect } from 'react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { useMessages } from '../hooks/useMessages';
import { useChatSubscription } from '../hooks/useChatSubscription';
import { useReadReceipts } from '../hooks/useReadReceipts';
import { createBrowserClient } from '@supabase/ssr';
import { Settings } from 'lucide-react'; // Import the toggle icon
import { GroupSettingsPanel } from './GroupSettingsPanel'; // Import our new panel

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
  const [isPanelOpen, setIsPanelOpen] = useState(false); // State to open/close drawer
  const [currentUserId, setCurrentUserId] = useState<string | undefined>();

  // Fetch the Supabase user ID for read receipts
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setCurrentUserId(data.user.id);
      }
    });
  }, []);

  const {
    messages,
    addMessage,
    loadMoreMessages,
    isLoading,
    hasMore
  } = useMessages({ roomId, pageSize: 50 });

  useChatSubscription(sdk, addMessage);

  // Read receipts — auto-tracks visibility and syncs in real-time
  const { readReceipts } = useReadReceipts({
    roomId: roomId || "",
    messages,
    currentUserId,
  });

  const handleSend = useCallback(async (text: string) => {
    addMessage({ text, sender: walletAddress, isOwn: true, isEncrypted: true });
    try {
      await onSendToChain?.(text);
    } catch (err) {
      console.error('Failed to send message to chain:', err);
    }
  }, [addMessage, walletAddress, onSendToChain]);

  // Derive a dynamic presentation room name or fall back cleanly
  const currentRoomName = roomId ? `Room: ${roomId.substring(0, 8)}...` : "Main Anonymous Chat";

  return (
    <div className='flex flex-col h-full bg-gray-950 text-gray-100 relative overflow-hidden'>
      
      {/* Dynamic Group Top Header Block */}
      <div className="w-full h-14 bg-gray-900 border-b border-gray-800 px-6 flex items-center justify-between shadow-sm shrink-0">
        <div className="flex flex-col">
          <span className="font-bold text-sm tracking-wide text-gray-100">{currentRoomName}</span>
          <span className="text-[11px] text-green-400 font-medium flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            End-to-End Encrypted
          </span>
        </div>
        
        {/* Info/Settings Action Trigger */}
        <button
          onClick={() => setIsPanelOpen(true)}
          className="p-2 bg-gray-800/40 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 text-gray-400 hover:text-purple-400 rounded-xl transition-all shadow-sm group"
          title="Open Group Settings"
        >
          <Settings className="size-4.5 transition-transform group-hover:rotate-45" />
        </button>
      </div>

      {/* Messages Feed View Container */}
      <MessageList
        messages={messages}
        onLoadMore={loadMoreMessages}
        isLoading={isLoading}
        hasMore={hasMore}
        readReceipts={readReceipts}
      />
      
      {/* Message Chat Field Box */}
      <MessageInput onSend={handleSend} />

      {/* Embedded Group Settings Slide Drawer Component */}
      <GroupSettingsPanel 
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        roomName={currentRoomName}
      />
    </div>
  );
};