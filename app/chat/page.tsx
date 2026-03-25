"use client"

import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import Image from "next/image";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import {
  PresenceIndicator,
  type PresenceStatus,
} from "@/components/presence-indicator";
import ConnectWallet from "@/components/wallet-connector";
import { RoomMembersDialog } from "@/components/room-members-dialog";
import { ChatEmptyState } from "@/components/chat-empty-state";
import { EditGroupDialog } from "@/components/edit-group-dialog";
import { cn } from "@/lib/utils";
import { getPublicKey, onDisconnect } from "@/app/stellar-wallet-kit";
import {
  Search,
  MessageCircle,
  Send,
  Check,
  CheckCheck,
  Clock,
  Wallet,
  Share2,
  Phone,
  Video,
  MoreVertical,
  Star,
  Loader2,
} from "lucide-react";
import { calculateReputation, trackActivity } from "@/lib/reputation";
import { CONFIG } from "@/lib/config";
import {
  useRealtimeChat,
  TypingIndicatorComponent,
  useDebouncedTyping,
  type TypingIndicator,
} from "@/lib/websocket/chat-hooks";
import { useWebSocketSend, useWebSocketMessage } from "@/lib/websocket/hooks";
import { WebSocketMessage } from "@/types/websocket";

type ChatPreview = {
  id: string
  name: string
  address: string
  lastMessage: string
  lastSeen: string
  unreadCount: number
  status: PresenceStatus
}

type ChatMessage = {
  id: string
  author: "me" | "them"
  text: string
  time: string
  delivered: boolean
  read: boolean
  status?: "sending" | "sent" | "delivered" | "read"
}

interface DBRoom {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  is_private?: boolean;
  owner_wallet?: string | null;
  address?: string;
  unread_count?: number;
}

interface DBMessage {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
}

export default function ChatPage() {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [inputMessage, setInputMessage] = useState("");
  const [walletConnected, setWalletConnected] = useState(false);
  const [roomMembersOpen, setRoomMembersOpen] = useState(false);
  const [currentPublicKey, setCurrentPublicKey] = useState<string | null>(null);
  const [reputationScore, setReputationScore] = useState(0);

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState<
    Record<string, boolean>
  >({});
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [messagesByChat, setMessagesByChat] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [dbRooms, setDbRooms] = useState<DBRoom[]>([]);
  const [chats, setChats] = useState<ChatPreview[]>([]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  /* ---------------- Fetch Current User ---------------- */

  useEffect(() => {
    const fetchUser = async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  /* ---------------- Fetch Rooms ---------------- */

  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const res = await fetch("/api/rooms");
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? "Failed to fetch rooms");
        }

        const rooms = (data.rooms ?? []) as DBRoom[];
        setDbRooms(rooms);
        setChats(
          rooms.map((room) => ({
            id: room.id,
            name: room.name,
            address: room.owner_wallet
              ? `${room.owner_wallet.slice(0, 4)}...${room.owner_wallet.slice(-4)}`
              : "Unknown",
            lastMessage: room.description ?? "No messages yet",
            lastSeen: new Date(room.created_at).toLocaleDateString(),
            unreadCount: room.unread_count ?? 0,
            status: "offline" as PresenceStatus,
          })),
        );
      } catch (error) {
        console.error("Failed to fetch rooms:", error);
      }
    };

    fetchRooms();
  }, []);

  /* ---------------- Transform DB Message ---------------- */

  const transformToChatMessage = useCallback(
    (msg: DBMessage): ChatMessage => {
      const time = new Date(msg.created_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      return {
        id: msg.id,
        author: msg.user_id === currentUser?.id ? "me" : "them",
        text: msg.content,
        time,
        delivered: true,
        read: true,
        status: "read",
      };
    },
    [currentUser],
  );

  /* ---------------- Fetch Historical Messages ---------------- */

  const fetchHistoricalMessages = useCallback(
    async (roomId: string, isLoadMore = false) => {
      if ((isLoadMore && isLoadingMore) || (!isLoadMore && isLoadingMessages))
        return;

      const limit = 20;
      const currentOffset = isLoadMore ? offsets[roomId] || 0 : 0;

      isLoadMore ? setIsLoadingMore(true) : setIsLoadingMessages(true);

      try {
        const res = await fetch(
          `/api/messages?room_id=${roomId}&limit=${limit}&offset=${currentOffset}`,
        );
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const newMessages = (data.messages || [])
          .map(transformToChatMessage)
          .reverse();

        setMessagesByChat((prev) => {
          const existing = isLoadMore ? prev[roomId] || [] : [];
          const combined = isLoadMore
            ? [...newMessages, ...existing]
            : newMessages;

          const unique = combined.filter(
            (msg: ChatMessage, index: number, self: ChatMessage[]) =>
              index === self.findIndex((m: ChatMessage) => m.id === msg.id),
          );

          return { ...prev, [roomId]: unique };
        });

        setOffsets((prev) => ({
          ...prev,
          [roomId]: currentOffset + newMessages.length,
        }));

        setHasMoreMessages((prev) => ({
          ...prev,
          [roomId]: (data.messages || []).length === limit,
        }));

        if (isLoadMore && scrollContainerRef.current) {
          const container = scrollContainerRef.current;
          const oldHeight = container.scrollHeight;
          const oldScrollTop = container.scrollTop;

          requestAnimationFrame(() => {
            const newHeight = container.scrollHeight;
            const heightDiff = newHeight - oldHeight;
            container.scrollTop = oldScrollTop + heightDiff;
          });
        }
      } catch (err) {
        console.error("Failed to fetch messages:", err);
      } finally {
        setIsLoadingMessages(false);
        setIsLoadingMore(false);
      }
    },
    [offsets, isLoadingMessages, isLoadingMore, transformToChatMessage],
  );

  /* ---------------- Auto Scroll ---------------- */

  useEffect(() => {
    if (scrollContainerRef.current && !isLoadingMore) {
      const container = scrollContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [selectedChatId, messagesByChat, isLoadingMore]);

  /* ---------------- Wallet Sync ---------------- */

  useEffect(() => {
    const checkWallet = async () => {
      const address = await getPublicKey();
      setWalletConnected(!!address);
      if (address) setCurrentPublicKey(address);
    };
    checkWallet();
    const unsubscribe = onDisconnect(() => {
      setWalletConnected(false);
      setCurrentPublicKey(null);
    });
    const interval = setInterval(checkWallet, 3000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  /* ---------------- Reputation ---------------- */

  useEffect(() => {
    const updateScore = () =>
      setReputationScore(calculateReputation(currentPublicKey));
    updateScore();
    window.addEventListener("reputationUpdate", updateScore);
    return () => window.removeEventListener("reputationUpdate", updateScore);
  }, [currentPublicKey]);

  /* ---------------- Select Chat ---------------- */

  const handleSelectChat = async (id: string) => {
    setSelectedChatId(id);
    if (!messagesByChat[id]) {
      fetchHistoricalMessages(id);
    }
  };

  /* ---------------- Send Message ---------------- */

  const handleSendMessage = () => {
    if (!inputMessage.trim() || !selectedChatId) return;

    const newMessage: ChatMessage = {
      id: `m${Date.now()}`,
      author: "me",
      text: inputMessage,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
      delivered: false,
      read: false,
      status: "sent",
    };

    setMessagesByChat((prev) => ({
      ...prev,
      [selectedChatId]: [...(prev[selectedChatId] || []), newMessage],
    }));

    setInputMessage("");
    trackActivity(currentPublicKey, "message");
  };

  const selectedChat = selectedChatId
    ? (chats.find((c) => c.id === selectedChatId) ?? null)
    : null;

  const messages = selectedChat ? (messagesByChat[selectedChat.id] ?? []) : [];
  const selectedRoom = selectedChatId
    ? (dbRooms.find((room) => room.id === selectedChatId) ?? null)
    : null;
  const canEditSelectedRoom =
    !!selectedRoom?.owner_wallet &&
    !!currentPublicKey &&
    selectedRoom.owner_wallet.toUpperCase() === currentPublicKey.toUpperCase();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 flex justify-center pt-24 pb-8">
        <div className="w-full max-w-6xl h-[min(82vh,760px)] bg-card border rounded-2xl shadow-lg flex overflow-hidden">
          {/* Sidebar */}
          <aside className="w-[340px] border-r flex flex-col">
            <div className="p-4 font-semibold text-sm border-b">Messages</div>
            <div className="flex-1 overflow-y-auto">
              {chats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => handleSelectChat(chat.id)}
                  className="w-full text-left px-4 py-3 hover:bg-muted/20"
                >
                  {chat.name}
                </button>
              ))}
            </div>
          </aside>

          {/* Chat Area */}
          <section className="flex-1 flex flex-col">
            {!selectedChat && <ChatEmptyState />}

            {selectedChat && (
              <>
                <div className="flex items-center justify-between gap-4 border-b p-4">
                  <div>
                    <div className="font-semibold">{selectedChat.name}</div>
                    {selectedRoom?.description && (
                      <div className="text-sm text-muted-foreground">
                        {selectedRoom.description}
                      </div>
                    )}
                  </div>
                  {selectedRoom && (
                    <EditGroupDialog
                      room={selectedRoom}
                      canEdit={canEditSelectedRoom}
                      onUpdated={(updatedRoom) => {
                        setDbRooms((prev) =>
                          prev.map((room) =>
                            room.id === updatedRoom.id ? { ...room, ...updatedRoom } : room,
                          ),
                        );
                        setChats((prev) =>
                          prev.map((chat) =>
                            chat.id === updatedRoom.id
                              ? { ...chat, name: updatedRoom.name }
                              : chat,
                          ),
                        );
                      }}
                    />
                  )}
                </div>

                <div
                  ref={scrollContainerRef}
                  className="flex-1 overflow-y-auto p-4 space-y-3"
                >
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "max-w-[70%] px-4 py-2 rounded-xl text-sm",
                        message.author === "me"
                          ? "ml-auto bg-primary/10"
                          : "bg-card border",
                      )}
                    >
                      {message.text}
                    </div>
                  ))}
                </div>

                <div className="p-4 border-t flex gap-2">
                  <input
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    className="flex-1 border rounded-full px-4 py-2 text-sm"
                    placeholder="Type a message"
                  />
                  <button
                    onClick={handleSendMessage}
                    className="bg-primary text-white rounded-full px-4"
                  >
                    Send
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
