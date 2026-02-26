"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
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
  id: string;
  name: string;
  address: string;
  lastMessage: string;
  lastSeen: string;
  unreadCount: number;
  status: PresenceStatus;
};

type ChatMessage = {
  id: string;
  author: "me" | "them";
  text: string;
  time: string;
  delivered: boolean;
  read: boolean;
  status?: "sending" | "sent" | "delivered" | "read";
};

interface DBRoom {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  owner_wallet?: string;
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
  const [roomMembersOpen, setRoomMembersOpen] = useState(false);
  const [walletConnected, setWalletConnected] = useState(false);
  const [currentPublicKey, setCurrentPublicKey] = useState<string | null>(null);
  const [reputationScore, setReputationScore] = useState(0);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState<Record<string, boolean>>({});
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [messagesByChat, setMessagesByChat] = useState<Record<string, ChatMessage[]>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastScrollPosRef = useRef<number>(0);

  
  useEffect(() => {
    const fetchUser = async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const transformToChatMessage = useCallback((msg: DBMessage): ChatMessage => {
    const time = new Date(msg.created_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
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
  }, [currentUser]);

  const fetchHistoricalMessages = useCallback(async (roomId: string, isLoadMore = false) => {
    if ((isLoadMore && isLoadingMore) || (!isLoadMore && isLoadingMessages)) return;

    const limit = 20; 
    const currentOffset = isLoadMore ? (offsets[roomId] || 0) : 0;

    if (isLoadMore) setIsLoadingMore(true);
    else setIsLoadingMessages(true);

    try {
      const res = await fetch(`/api/messages?room_id=${roomId}&limit=${limit}&offset=${currentOffset}`);
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      const newMessages = (data.messages || []).map(transformToChatMessage).reverse();

      setMessagesByChat((prev: Record<string, ChatMessage[]>) => {
        const existingMessages = isLoadMore ? (prev[roomId] || []) : [];
        
        const combined = isLoadMore
          ? [...newMessages, ...existingMessages]
          : newMessages;

        const unique = combined.filter((msg: ChatMessage, index: number, self: ChatMessage[]) =>
          index === self.findIndex((m: ChatMessage) => m.id === msg.id)
        );

        return {
          ...prev,
          [roomId]: unique
        };
      });

      setOffsets((prev: Record<string, number>) => ({
        ...prev,
        [roomId]: currentOffset + newMessages.length
      }));

      setHasMoreMessages((prev: Record<string, boolean>) => ({
        ...prev,
        [roomId]: (data.messages || []).length === limit
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
    } catch (err: any) {
      console.error("Failed to fetch messages:", err);
    } finally {
      setIsLoadingMessages(false);
      setIsLoadingMore(false);
    }
  }, [offsets, isLoadingMessages, isLoadingMore, transformToChatMessage]);

 
  // Update reputation score
  useEffect(() => {
    const updateScore = () => {
      setReputationScore(calculateReputation(currentPublicKey))
    }
    updateScore()
    window.addEventListener("reputationUpdate", updateScore)
    return () => window.removeEventListener("reputationUpdate", updateScore)
  }, [currentPublicKey])

  
  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const res = await fetch("/api/rooms");
        const data = await res.json();
        if (data.rooms) {
          const mappedRooms: ChatPreview[] = data.rooms.map((r: DBRoom) => ({
            id: r.id,
            name: r.name,
            // display the owner&apos;s wallet address if we have it
            address: r.owner_wallet
              ? `${r.owner_wallet.slice(0, 4)}...${r.owner_wallet.slice(-4)}`
              : r.address || (r.id.slice(0, 8) + "..."),
            lastMessage: r.description || "No messages yet",
            lastSeen: new Date(r.created_at).toLocaleDateString(),
            unreadCount: r.unread_count || 0,
            status: "online", // mock status
          }));
          setChats(mappedRooms);
        }
      } catch (err) {
        console.error("Failed to fetch rooms:", err);
      }
    };
    if (currentUser) {
      fetchRooms();
    }
  }, [currentUser]);

  useEffect(() => {
    const checkWallet = async () => {
      const address = await getPublicKey()
      setWalletConnected(!!address)
      setCurrentPublicKey(address ?? null)
    }
    checkWallet()
    const unsubscribe = onDisconnect(() => {
      setWalletConnected(false)
      setCurrentPublicKey(null)
    })
    const interval = setInterval(checkWallet, 1000)

    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [])

  const [chats, setChats] = useState<ChatPreview[]>([
    {
      id: "1",
      name: "Anon Whisper",
      address: "GABC ... 1234",
      lastMessage: "Got your message, will reply soon.",
      lastSeen: "Today • 14:32",
      unreadCount: 2,
      status: "online",
    },
    {
      id: "2",
      name: "Room #xf23",
      address: "GCDE ... 5678",
      lastMessage: "Pinned the latest proposal for review.",
      lastSeen: "Today • 09:10",
      unreadCount: 0,
      status: "recently_active",
    },
    {
      id: "3",
      name: "Collector",
      address: "GHJK ... 9012",
      lastMessage: "Let’s sync tomorrow.",
      lastSeen: "Yesterday • 18:04",
      unreadCount: 0,
      status: "offline",
    },
  ]);

  const markRoomRead = async (roomId: string) => {
    try {
      await fetch("/api/rooms/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      })
    } catch (err) {
      console.error("Failed to mark room read", err)
    }
  }

  const handleSelectChat = async (id: string) => {
    setSelectedChatId(id);
    // update server and local unread count
    await markRoomRead(id);
    setChats((prev: ChatPreview[]) => prev.map((c: ChatPreview) => (c.id === id ? { ...c, unreadCount: 0 } : c)));

   
    if (!messagesByChat[id] || id.length > 5) { 
      fetchHistoricalMessages(id);
    }
  }


  useEffect(() => {
    if (scrollContainerRef.current && !isLoadingMore) {
      const container = scrollContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [selectedChatId, messagesByChat, isLoadingMore]);

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || !selectedChatId || isLoadingMore || !hasMoreMessages[selectedChatId]) return;

    if (scrollContainerRef.current.scrollTop < 50) {  
      fetchHistoricalMessages(selectedChatId, true);
    }
  }, [selectedChatId, isLoadingMore, hasMoreMessages, fetchHistoricalMessages]);

  const handleSendMessage = () => {
    if (!inputMessage.trim() || !selectedChatId) return
    onStopTypingImmediate()

    const newMessage: ChatMessage = {
      id: `m${Date.now()}`,
      author: "me",
      text: inputMessage,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      delivered: false,
      read: false,
      status: "sent"
    }

    setMessagesByChat((prev: Record<string, ChatMessage[]>) => ({
      ...prev,
      [selectedChatId]: [...(prev[selectedChatId] || []), newMessage]
    }))

    setChats((prev: ChatPreview[]) => prev.map((chat: ChatPreview) =>
      chat.id === selectedChatId
        ? { ...chat, lastMessage: inputMessage, lastSeen: "Just now", unreadCount: 0 }
        : chat
    ))

   
    if (realtimeHandlers.sendMessage) {
      realtimeHandlers.sendMessage(inputMessage);
    }

    setInputMessage("")
    trackActivity(currentPublicKey, 'message')
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const getDeliveryStatus = (message: ChatMessage) => {
    if (message.status) return message.status;
    if (message.read) return "read";
    if (message.delivered) return "delivered";
    return "sent";
  };

  const filteredChats = useMemo(() => {
    if (!query.trim()) return chats;
    const q = query.toLowerCase();
    return chats.filter(
      (c: ChatPreview) =>
        c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q),
    );
  }, [chats, query]);

  const selectedChat = selectedChatId
    ? (chats.find((c: ChatPreview) => c.id === selectedChatId) ?? null)
    : null;
  const messages = selectedChat ? (messagesByChat[selectedChat.id] ?? []) : [];

  // Realtime typing indicator for selected room
  const roomIdForRealtime = selectedChatId ?? "";
  const { typingUsers, handlers: realtimeHandlers } = useRealtimeChat(
    roomIdForRealtime,
    currentPublicKey ?? undefined,
  );
  const { authenticate } = useWebSocketSend();
  const { onTypingActivity, onStopTypingImmediate } = useDebouncedTyping(
    roomIdForRealtime,
    realtimeHandlers.typing,
    realtimeHandlers.stopTyping,
  );

  // Authenticate WebSocket when wallet is connected (required for typing to work)
  useEffect(() => {
    if (!currentPublicKey) return;
    const displayName =
      currentPublicKey.slice(0, 6) + "..." + currentPublicKey.slice(-4);
    authenticate(currentPublicKey, currentPublicKey, `Wallet_${displayName}`);
  }, [currentPublicKey, authenticate]);

  // Other users typing (exclude current user)
  const otherUsersTyping = useMemo(
    () => (Array.from(typingUsers.values()) as TypingIndicator[]).filter((u: TypingIndicator) => u.userId !== currentPublicKey),
    [typingUsers, currentPublicKey],
  );

  
  useWebSocketMessage("message", useCallback((msg: WebSocketMessage) => {
    const payload = msg.payload as any;
    if (payload.roomId) {
      const isMe = payload.userId === currentPublicKey;
      const time = new Date(payload.createdAt || Date.now()).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });

      const incoming: ChatMessage = {
        id: payload.id || Math.random().toString(36).substr(2, 9),
        author: isMe ? "me" : "them",
        text: payload.content,
        time,
        status: "read",
        delivered: true,
        read: true
      };

      setMessagesByChat((prev: Record<string, ChatMessage[]>) => {
        const roomMsgs = prev[payload.roomId] || [];
       
        if (roomMsgs.some((m: ChatMessage) => m.id === incoming.id)) return prev;

        return {
          ...prev,
          [payload.roomId]: [...roomMsgs, incoming]
        };
      });

     
      setChats((prev: ChatPreview[]) => prev.map((c: ChatPreview) =>
        c.id === payload.roomId
          ? { ...c, lastMessage: payload.content, lastSeen: "Just now" }
          : c
      ));
    }
  }, [currentPublicKey]));

  
  const MOCK_TYPING_CHAT_ID = "1";
  const mockTypingUser: TypingIndicator = useMemo(
    () => ({
      userId: "mock-typing-dummy",
      displayName: "GABC...1234",
      roomId: MOCK_TYPING_CHAT_ID,
    }),
    [],
  );

  const displayTypingUsers = useMemo(() => {
    const fromRealtime = otherUsersTyping;
    if (selectedChatId === MOCK_TYPING_CHAT_ID) {
      return [mockTypingUser, ...fromRealtime];
    }
    return fromRealtime;
  }, [selectedChatId, otherUsersTyping, mockTypingUser]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputMessage(e.target.value);
      onTypingActivity();
    },
    [onTypingActivity],
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 pt-24 pb-8 px-2 sm:px-4 lg:px-8 flex justify-center">
        <div className="w-full max-w-6xl h-[min(82vh,760px)] bg-card border border-border/60 rounded-2xl shadow-lg overflow-hidden flex">
          {/* Sidebar */}
          <aside className="w-[340px] border-r border-border/60 bg-card flex flex-col shrink-0">
            <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between gap-3 bg-card">
              <div className="flex items-center gap-2">
                <div className="relative h-8 w-8 rounded-xl overflow-hidden bg-primary/10 flex items-center justify-center">
                  <Image
                    src="/anonchat-logo2.webp"
                    alt="AnonChat logo"
                    fill
                    sizes="32px"
                    className="object-contain"
                  />
                </div>
                <div className="leading-tight">
                  <div className="text-sm font-semibold tracking-tight">
                    AnonChat
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    End‑to‑end encrypted
                  </div>
                </div>
              </div>
              <button className="inline-flex items-center justify-center rounded-full border border-primary/60 px-3 py-1.5 text-[11px] font-medium bg-primary/20 text-primary hover:bg-primary/30 transition">
                Create / Join room
              </button>
            </div>

            {walletConnected && (
              <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between bg-[#12121a] gap-3">
                <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="h-7 w-7 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
                    <Wallet className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
                      CONNECTED
                    </span>
                    <span className="text-[11px] font-mono text-foreground">
                      {currentPublicKey ? `${currentPublicKey.slice(0, 4)} ... ${currentPublicKey.slice(-4)}` : "None"}
                    </span>
                  </div>
                </div>

                {CONFIG.EXPERIMENTAL_REPUTATION_ENABLED && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20" title="Reputation Score (Experimental)">
                    <Star className="h-3 w-3 text-primary fill-primary" />
                    <span className="text-[11px] font-bold text-primary">
                      {reputationScore}
                    </span>
                  </div>
                )}

                <button className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-md bg-[#1b1b24] hover:bg-[#232330] transition border border-border/60">
                  <Share2 className="h-3 w-3" />
                  <span>Share</span>
                </button>
              </div>
            )}

            <div className="px-4 pt-3 pb-2 space-y-2 border-b border-border/60 bg-card">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-semibold tracking-wide uppercase text-foreground">
                  Messages
                </span>
                <MessageCircle className="h-4 w-4" />
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                  placeholder="Search ENS or Wallet"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-card text-sm border border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/60 placeholder:text-muted-foreground/70 transition"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {filteredChats.length === 0 ? (
                <div className="h-full flex items-center justify-center px-6 text-xs text-muted-foreground text-center">
                  No rooms match this search.
                </div>
              ) : (
                <ul className="py-1">
                  {filteredChats.map((chat: ChatPreview) => {
                    const isSelected = chat.id === selectedChatId
                    return (
                      <li key={chat.id}>
                        <button
                          onClick={() => void handleSelectChat(chat.id)}
                          className={cn(
                            "w-full px-3.5 py-2.5 flex gap-3 items-center text-left hover:bg-muted/10 transition cursor-pointer",
                            isSelected &&
                            "bg-primary/5 border-l-2 border-primary/80 shadow-[0_0_0_1px_rgba(168,85,247,0.08)]",
                          )}
                        >
                          <div className="relative">
                            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xs font-semibold text-white shadow-md">
                              {chat.name.charAt(0).toUpperCase()}
                            </div>
                            <PresenceIndicator
                              status={chat.status}
                              className="absolute -bottom-0.5 -right-0.5 scale-90"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium truncate">
                                {chat.name}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {chat.lastSeen}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {chat.lastMessage}
                            </p>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="px-4 py-2 border-t border-border/60 bg-card text-[11px] text-muted-foreground flex items-center justify-between gap-2">
              <span className="truncate">Wallet status for this device:</span>
              <ConnectWallet />
            </div>
          </aside>

          {/* Main chat area */}
          <section className="flex-1 flex flex-col bg-background min-w-0">
            {!selectedChat && <ChatEmptyState />}

            {/* Conversation view */}
            {selectedChat && (
              <>
                {/* Header */}
                <div className="px-6 py-3 border-b border-border/60 bg-card flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xs font-semibold text-white">
                        {selectedChat.name.charAt(0).toUpperCase()}
                      </div>
                      <PresenceIndicator
                        status={selectedChat.status}
                        className="absolute -bottom-0.5 -right-0.5 scale-90"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {selectedChat.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate font-mono">
                        {selectedChat.address}
                      </div>
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-3 text-muted-foreground">
                    {walletConnected && (
                      <div className="flex items-center gap-3">
                        {CONFIG.EXPERIMENTAL_REPUTATION_ENABLED && (
                          <div className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary">
                            <Star className="h-3 w-3 fill-primary" />
                            <span className="font-bold">{reputationScore} Rep</span>
                          </div>
                        )}
                        <div className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-primary/10 border border-border/60">
                          <Wallet className="h-3.5 w-3.5 text-primary" />
                          <span>Wallet linked</span>
                        </div>
                      </div>
                    )}
                    <button className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted/60 transition" type="button">
                      <Phone className="h-4 w-4" />
                    </button>
                    <button className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted/60 transition">
                      <Video className="h-4 w-4" />
                    </button>
                    <RoomMembersDialog
                      roomId={selectedChat.id}
                      open={roomMembersOpen}
                      onOpenChange={setRoomMembersOpen}
                      trigger={
                        <button
                          type="button"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted/60 transition"
                          aria-label="Room members and voting"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      }
                    />
                  </div>
                </div>

                {/* Messages */}
                <div
                  ref={scrollContainerRef}
                  onScroll={handleScroll}
                  className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3 bg-background relative"
                >
                  {isLoadingMore && (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  )}

                  {isLoadingMessages && messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm">Loading secure messages...</p>
                    </div>
                  ) : (
                    messages.map((message: ChatMessage) => {
                      const isMine = message.author === "me";
                      const status = getDeliveryStatus(message);
                      return (
                        <div
                          key={message.id}
                          className={cn(
                            "flex w-full",
                            isMine ? "justify-end" : "justify-start",
                          )}
                        >
                          <div
                            className={cn(
                              "max-w-[70%] rounded-2xl px-4 py-2.5 text-sm flex flex-col gap-1",
                              isMine
                                ? "bg-primary/10 text-foreground rounded-br-md"
                                : "bg-card text-foreground rounded-bl-md border border-border/40",
                            )}
                          >
                            <span className="whitespace-pre-wrap break-words">
                              {message.text}
                            </span>
                            <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground/90">
                              <span>{message.time}</span>
                              {isMine && (
                                <span className="inline-flex items-center gap-1">
                                  {status === "sending" ? (
                                    <Clock className="h-3 w-3 animate-pulse" />
                                  ) : status === "sent" ? (
                                    <Check className="h-3 w-3" />
                                  ) : (
                                    <CheckCheck
                                      className={cn(
                                        "h-3 w-3",
                                        status === "read" && "text-green-400",
                                      )}
                                    />
                                  )}
                                  <span
                                    className={cn(
                                      status === "read" && "text-green-400",
                                    )}
                                  >
                                    {status === "read"
                                      ? "Seen"
                                      : status.charAt(0).toUpperCase() +
                                      status.slice(1)}
                                  </span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Typing indicator */}
                <TypingIndicatorComponent typingUsers={displayTypingUsers} />

                {/* Composer */}
                <div className="px-4 sm:px-6 py-3 border-t border-border/60 bg-card flex items-center gap-2">
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyPress}
                    onBlur={onStopTypingImmediate}
                    placeholder="Type a message"
                    className="flex-1 rounded-full border border-border/60 bg-card px-4 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/60 placeholder:text-muted-foreground/70"
                  />
                  <button
                    onClick={handleSendMessage}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 transition"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </main>

      <Footer />
    </div>
  )
}
