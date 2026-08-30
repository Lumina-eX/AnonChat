"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChatWelcomeState } from "@/components/chat-welcome-state";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ChatEmptyState } from "@/components/chat-empty-state";
import { GroupAuditDialog } from "@/components/group-audit-dialog";
import {
  PresenceIndicator,
  type PresenceStatus,
} from "@/components/presence-indicator";
import { RoomMembersDialog } from "@/components/room-members-dialog";
import ConnectWallet from "@/components/wallet-connector";
import { RoomActivityPanel } from "@/components/room-activity-panel";
import { MessageSearchBar } from "@/components/message-search-bar";
import { GroupVerificationBadge } from "@/components/GroupVerificationBadge";
import { ChatMessageBubble, type ChatMessage } from "@/components/chat-message-bubble";
import { cn } from "@/lib/utils";
import { highlightText } from "@/lib/highlight-text";
import { handleAppError } from "@/lib/error-handler"; // Integrated Error Handler
import {
  ArrowLeft,
  MessageSquare,
  Loader2,
  Menu,
  Paperclip,
  PanelLeft,
  Search,
  SendHorizontal,
  Smile,
  ScrollText,
  Users,
  Pin,
  ChevronLeft,
  ChevronRight,
  X,
  ShieldCheck,
  Reply,
} from "lucide-react";
import { StellarNetworkStatus } from "@/components/stellar-network-status";
import { WalletNetworkWarning } from "@/components/wallet-network-warning";

type ChatPreview = {
  id: string;
  name: string;
  address: string;
  lastMessage: string;
  lastSeen: string;
  unreadCount: number;
  status: PresenceStatus;
};



interface DBRoom {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  address?: string;
  unread_count?: number;
}

interface DBMessage {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  reply_to_id?: string | null;
  reply_to?: {
    id: string;
    content: string;
    user_id?: string;
  } | null;
  profiles?: {
    display_name?: string;
    avatar_url?: string;
  };
}

export default function ChatPage() {
  const [query, setQuery] = useState("");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState("");
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const [roomMembersOpen, setRoomMembersOpen] = useState(false);
  const [auditTrailOpen, setAuditTrailOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<
    "chats" | "conversation"
  >("conversation");

  const [currentUser, setCurrentUser] = useState<{ id: string } | null>(null);
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [isSending, setIsSending] = useState(false);

  // Message search state
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState("");

  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [messagesByChat, setMessagesByChat] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [memberCountByRoom, setMemberCountByRoom] = useState<
    Record<string, number>
  >({});
  
  // Pagination state per room
  const [messageOffsets, setMessageOffsets] = useState<Record<string, number>>({});
  const [hasMoreMessages, setHasMoreMessages] = useState<Record<string, boolean>>({});
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState<Record<string, boolean>>({});
  const [isLoadingMessagesByRoom, setIsLoadingMessagesByRoom] = useState<
    Record<string, boolean>
  >({});
  const loadingRef = useRef<Record<string, boolean>>({});

  // Pinned messages & admin state
  const [pinnedIdsByChat, setPinnedIdsByChat] = useState<Record<string, string[]>>({});
  const [currentPinnedIndexByChat, setCurrentPinnedIndexByChat] = useState<Record<string, number>>({});
  const [isAdmin, setIsAdmin] = useState<boolean>(true);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load pinned message IDs from localStorage per room
  useEffect(() => {
    if (!selectedChatId) return;
    try {
      const stored = localStorage.getItem(`anonchat_pinned_${selectedChatId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setPinnedIdsByChat((prev) => ({
            ...prev,
            [selectedChatId]: parsed,
          }));
        }
      }
    } catch {
      // Ignore localStorage read errors
    }
  }, [selectedChatId]);

  const togglePinMessage = useCallback((chatId: string, msgId: string) => {
    setPinnedIdsByChat((prev) => {
      const currentList = prev[chatId] || [];
      const isAlreadyPinned = currentList.includes(msgId);
      const updated = isAlreadyPinned
        ? currentList.filter((id) => id !== msgId)
        : [...currentList, msgId];

      try {
        localStorage.setItem(`anonchat_pinned_${chatId}`, JSON.stringify(updated));
      } catch {
        // Ignore localStorage write errors
      }

      return {
        ...prev,
        [chatId]: updated,
      };
    });
  }, []);

  const handleScrollToMessage = useCallback((msgId: string) => {
    const targetEl = document.getElementById(`msg-${msgId}`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMessageId(msgId);
      setTimeout(() => {
        setHighlightedMessageId(null);
      }, 2200);
    }
  }, []);

  const pinnedIds = useMemo(() => {
    return selectedChatId ? pinnedIdsByChat[selectedChatId] || [] : [];
  }, [selectedChatId, pinnedIdsByChat]);

  const pinnedMessages = useMemo(() => {
    if (!selectedChatId) return [];
    const roomMsgs = messagesByChat[selectedChatId] || [];
    return pinnedIds
      .map((id) => roomMsgs.find((m) => m.id === id))
      .filter((m): m is ChatMessage => Boolean(m));
  }, [selectedChatId, messagesByChat, pinnedIds]);

  const activePinnedIndex = useMemo(() => {
    if (!selectedChatId) return 0;
    const idx = currentPinnedIndexByChat[selectedChatId] || 0;
    return idx >= pinnedMessages.length ? 0 : idx;
  }, [selectedChatId, currentPinnedIndexByChat, pinnedMessages.length]);

  const activePinnedMessage = pinnedMessages[activePinnedIndex] || null;

  const handleNextPinned = useCallback((chatId: string, total: number) => {
    if (total <= 1) return;
    setCurrentPinnedIndexByChat((prev) => ({
      ...prev,
      [chatId]: ((prev[chatId] || 0) + 1) % total,
    }));
  }, []);

  const handlePrevPinned = useCallback((chatId: string, total: number) => {
    if (total <= 1) return;
    setCurrentPinnedIndexByChat((prev) => ({
      ...prev,
      [chatId]: ((prev[chatId] || 0) - 1 + total) % total,
    }));
  }, []);

  const transformToChatMessage = useCallback(
    (message: DBMessage): ChatMessage => {
      let replyTo: ChatMessage["replyTo"] = null;
      if (message.reply_to) {
        replyTo = {
          id: message.reply_to.id,
          text: message.reply_to.content,
          sender: message.reply_to.user_id === currentUser?.id ? "You" : "Them",
        };
      } else if (message.reply_to_id) {
        replyTo = {
          id: message.reply_to_id,
          text: "Original message",
        };
      }

      return {
        id: message.id,
        author: message.user_id === currentUser?.id ? "me" : "them",
        text: message.content,
        time: new Date(message.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
        status: "read",
        replyTo,
        senderName: message.profiles?.display_name,
      };
    },
    [currentUser?.id],
  );

  const fetchCurrentUser = useCallback(async () => {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setCurrentUser(user ? { id: user.id } : null);
  }, []);

  const fetchRoomLastMessagePreview = useCallback(async (roomId: string) => {
    try {
      const response = await fetch(
        `/api/messages?room_id=${encodeURIComponent(roomId)}&limit=1&offset=0`,
      );
      if (!response.ok) {
        return {
          lastMessage: "No messages yet",
          lastSeen: "",
        };
      }

      const data = await response.json();
      const latest: DBMessage | undefined = data.messages?.[0];
      if (!latest) {
        return {
          lastMessage: "No messages yet",
          lastSeen: "",
        };
      }

      return {
        lastMessage: latest.content,
        lastSeen: new Date(latest.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      };
    } catch {
      return {
        lastMessage: "No messages yet",
        lastSeen: "",
      };
    }
  }, []);

  const fetchRooms = useCallback(async () => {
    setIsLoadingRooms(true);
    try {
      const response = await fetch("/api/rooms");

      if (!response.ok) {
        setChats([]);
        setSelectedChatId(null);
        return;
      }

      const data = await response.json();
      if (data.error) {
        setChats([]);
        setSelectedChatId(null);
        return;
      }

      const rawRooms: DBRoom[] = data.rooms || [];
      const previews = await Promise.all(
        rawRooms.map(async (room) => {
          const preview = await fetchRoomLastMessagePreview(room.id);
          return {
            id: room.id,
            name: room.name,
            address: room.address || room.id,
            unreadCount: room.unread_count || 0,
            status: (room.unread_count || 0) > 0 ? "online" : "recently_active",
            lastMessage: preview.lastMessage,
            lastSeen: preview.lastSeen,
          } satisfies ChatPreview;
        }),
      );

      setChats(previews);
      setSelectedChatId(
        (currentSelected) => currentSelected || previews[0]?.id || null,
      );
    } catch {
      setChats([]);
      setSelectedChatId(null);
    } finally {
      setIsLoadingRooms(false);
    }
  }, [fetchRoomLastMessagePreview]);

  const fetchMessagesForRoom = useCallback(
    async (roomId: string, offset = 0, append = false) => {
      // Prevent concurrent requests for the same room
      if (loadingRef.current[roomId]) return;
      
      loadingRef.current[roomId] = true;
      if (offset === 0) {
        setIsLoadingMessagesByRoom((prev) => ({ ...prev, [roomId]: true }));
      } else {
        setIsLoadingMoreMessages((prev) => ({ ...prev, [roomId]: true }));
      }
      
      try {
        const pageSize = 50;
        const response = await fetch(
          `/api/messages?room_id=${encodeURIComponent(roomId)}&limit=${pageSize}&offset=${offset}`,
        );
        const data = await response.json();
        if (!response.ok || data.error) {
          throw new Error(data.error || "Failed to fetch messages");
        }

        const fetchedMessages = data.messages || [];
        const messageMap = new Map<string, DBMessage>();
        fetchedMessages.forEach((m: DBMessage) => messageMap.set(m.id, m));

        const parsed = fetchedMessages
          .map((m: DBMessage) => {
            const chatMsg = transformToChatMessage(m);
            if (m.reply_to_id && (!chatMsg.replyTo || chatMsg.replyTo.text === "Original message")) {
              const parent = messageMap.get(m.reply_to_id);
              if (parent) {
                chatMsg.replyTo = {
                  id: parent.id,
                  text: parent.content,
                  sender: parent.user_id === currentUser?.id ? "You" : (parent.profiles?.display_name || "Them"),
                };
              }
            }
            return chatMsg;
          })
          .reverse();

        setMessagesByChat((prev) => ({
          ...prev,
          [roomId]: append ? [...parsed, ...(prev[roomId] || [])] : parsed,
        }));

        setMessageOffsets((prev) => ({
          ...prev,
          [roomId]: offset + fetchedMessages.length,
        }));

        setHasMoreMessages((prev) => ({
          ...prev,
          [roomId]: fetchedMessages.length === pageSize,
        }));
      } catch (error) {
        console.error("Failed to fetch messages", error);
        if (!append) {
          setMessagesByChat((prev) => ({
            ...prev,
            [roomId]: [],
          }));
        }
      } finally {
        loadingRef.current[roomId] = false;
        setIsLoadingMessagesByRoom((prev) => ({ ...prev, [roomId]: false }));
        setIsLoadingMoreMessages((prev) => ({ ...prev, [roomId]: false }));
      }
    },
    [transformToChatMessage],
  );

  const loadMoreMessages = useCallback(
    async (roomId: string) => {
      // Guard against concurrent requests and missing data
      if (
        loadingRef.current[roomId] ||
        isLoadingMoreMessages[roomId] ||
        !hasMoreMessages[roomId]
      ) {
        return;
      }
      
      const currentOffset = messageOffsets[roomId] || 0;
      await fetchMessagesForRoom(roomId, currentOffset, true);
    },
    [isLoadingMoreMessages, hasMoreMessages, messageOffsets, fetchMessagesForRoom],
  );

  const fetchMemberCount = useCallback(async (roomId: string) => {
    try {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(roomId)}/members`,
      );
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      const count = Array.isArray(data.members) ? data.members.length : 0;
      setMemberCountByRoom((prev) => ({
        ...prev,
        [roomId]: count,
      }));
    } catch {
      // Member count is optional metadata
    }
  }, []);

  useEffect(() => {
    fetchCurrentUser();
    fetchRooms();
  }, [fetchCurrentUser, fetchRooms]);

  useEffect(() => {
    if (!selectedChatId) return;

    if (!messagesByChat[selectedChatId]) {
      fetchMessagesForRoom(selectedChatId);
    }

    if (memberCountByRoom[selectedChatId] === undefined) {
      fetchMemberCount(selectedChatId);
    }
  }, [
    selectedChatId,
    messagesByChat,
    memberCountByRoom,
    fetchMessagesForRoom,
    fetchMemberCount,
  ]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const messageContainer = document.querySelector('[data-message-container="true"]');
    if (messageContainer && selectedChatId) {
      const isLoadingMore = isLoadingMoreMessages[selectedChatId];
      if (!isLoadingMore) {
        requestAnimationFrame(() => {
          messageContainer.scrollTop = messageContainer.scrollHeight;
        });
      }
    }
  }, [selectedChatId, messagesByChat, isLoadingMoreMessages]);

  const handleSelectChat = useCallback((chatId: string) => {
    setSelectedChatId(chatId);
    setReplyingToMessage(null);
    setMobileSidebarOpen(false);
    setActiveMobileTab("conversation");
  }, []);

  const handleReplyToMessage = useCallback((message: ChatMessage) => {
    setReplyingToMessage(message);
    composerInputRef.current?.focus();
  }, []);

  const handleCancelReply = useCallback(() => {
    setReplyingToMessage(null);
  }, []);

  const isMobileSidebarVisible =
    mobileSidebarOpen || activeMobileTab === "chats";

  const handleSendMessage = useCallback(async () => {
    const trimmedMessage = inputMessage.trim();
    if (!trimmedMessage || !selectedChatId) return;

    if (!window.navigator.onLine) {
      handleAppError(new Error("network"), "NETWORK");
      return;
    }

    const currentReply = replyingToMessage;
    const currentChat = chats.find((chat) => chat.id === selectedChatId);
    const tempId = `temp_${Date.now()}`;
    const optimisticMessage: ChatMessage = {
      id: tempId,
      author: "me",
      text: trimmedMessage,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
      status: "sending",
      replyTo: currentReply
        ? {
            id: currentReply.id,
            text: currentReply.text,
            sender: currentReply.author === "me" ? "You" : (currentReply.senderName || currentChat?.name || "them"),
          }
        : null,
    };

    setMessagesByChat((prev) => ({
      ...prev,
      [selectedChatId]: [...(prev[selectedChatId] || []), optimisticMessage],
    }));
    setInputMessage("");
    setReplyingToMessage(null);
    setIsSending(true);

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: selectedChatId,
          content: trimmedMessage,
          reply_to_id: currentReply?.id || null,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || "Failed to send message");
      }

      const savedMessage: ChatMessage = data.message
        ? {
            ...transformToChatMessage(data.message),
            replyTo: optimisticMessage.replyTo,
          }
        : { ...optimisticMessage, status: "sent" };

      setMessagesByChat((prev) => ({
        ...prev,
        [selectedChatId]: (prev[selectedChatId] || []).map((msg) =>
          msg.id === tempId ? savedMessage : msg,
        ),
      }));

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === selectedChatId
            ? {
              ...chat,
              lastMessage: trimmedMessage,
              lastSeen: savedMessage.time,
              unreadCount: 0,
            }
            : chat,
        ),
      );
    } catch (error: any) {
      handleAppError(error, "SEND_MESSAGE");

      setMessagesByChat((prev) => ({
        ...prev,
        [selectedChatId]: (prev[selectedChatId] || []).filter(
          (msg) => msg.id !== tempId,
        ),
      }));
    } finally {
      setIsSending(false);
    }
  }, [inputMessage, selectedChatId, replyingToMessage, transformToChatMessage, chats]);

  const handleComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape" && replyingToMessage) {
        event.preventDefault();
        setReplyingToMessage(null);
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void handleSendMessage();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void handleSendMessage();
      }
    },
    [handleSendMessage, replyingToMessage],
  );

  // Global Keyboard Shortcut Listener
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd + K -> Focus chat search
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Esc -> Close active modals, dropdowns, reply mode, or sidebars
      if (event.key === "Escape") {
        if (replyingToMessage) {
          setReplyingToMessage(null);
        } else if (roomMembersOpen) {
          setRoomMembersOpen(false);
        } else if (mobileSidebarOpen) {
          setMobileSidebarOpen(false);
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [roomMembersOpen, mobileSidebarOpen, replyingToMessage]);

  const filteredChats = useMemo(() => {
    if (!query.trim()) return chats;
    const lowered = query.toLowerCase();
    return chats.filter(
      (chat) =>
        chat.name.toLowerCase().includes(lowered) ||
        chat.lastMessage.toLowerCase().includes(lowered),
    );
  }, [chats, query]);

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) || null,
    [chats, selectedChatId],
  );

  const messages = selectedChat ? messagesByChat[selectedChat.id] || [] : [];

  // Filter messages by search query (client-side, over loaded messages)
  const filteredMessages = useMemo(() => {
    if (!messageSearchQuery.trim()) return messages;
    const lowered = messageSearchQuery.toLowerCase();
    return messages.filter((msg) =>
      msg.text.toLowerCase().includes(lowered),
    );
  }, [messages, messageSearchQuery]);

  const handleCloseSearch = useCallback(() => {
    setMessageSearchOpen(false);
    setMessageSearchQuery("");
  }, []);

  // Reset search when switching rooms
  useEffect(() => {
    setMessageSearchQuery("");
    setMessageSearchOpen(false);
  }, [selectedChatId]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <StellarNetworkStatus variant="banner" />
      <WalletNetworkWarning variant="banner" />

      <main className="flex-1 pt-24 pb-24 md:pb-8 px-3 sm:px-6">
        <div className="mx-auto w-full max-w-7xl h-[min(84vh,820px)] rounded-3xl border border-border/70 bg-card/90 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)] backdrop-blur-sm overflow-hidden">
          <div className="h-full flex relative">
            <aside
              className={cn(
                "absolute inset-y-0 left-0 z-20 w-full border-r border-border/70 bg-card md:static md:w-[340px] md:max-w-none",
                "transition-transform duration-300 ease-out md:translate-x-0",
                isMobileSidebarVisible ? "translate-x-0" : "-translate-x-full",
              )}
            >
              <div className="h-full flex flex-col">
                <div className="p-4 border-b border-border/70 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">Groups</h2>
                    <div className="shrink-0">
                      <ConnectWallet />
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      ref={searchInputRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search groups or messages (Ctrl+K)"
                      title="Search (Ctrl+K)"
                      className="w-full rounded-xl border border-border/80 bg-background/70 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                  {isLoadingRooms && (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  )}

                  {!isLoadingRooms && filteredChats.length === 0 && (
                    <div className="p-4 text-sm text-muted-foreground">
                      No groups found.
                    </div>
                  )}

                  {!isLoadingRooms &&
                    filteredChats.map((chat) => {
                      const isActive = chat.id === selectedChatId;
                      return (
                        <button
                          key={chat.id}
                          type="button"
                          onClick={() => handleSelectChat(chat.id)}
                          className={cn(
                            "w-full text-left p-3 rounded-xl transition-all duration-150 mb-1",
                            "border hover:bg-muted/40",
                            isActive
                              ? "bg-primary/10 border-primary/30 shadow-[inset_3px_0_0_hsl(var(--primary))]"
                              : "border-transparent",
                          )}
                        >
                          <div className="flex items-start gap-2.5">
                            <div
                              className={cn(
                                "shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold uppercase select-none",
                                isActive
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {chat.name.charAt(0)}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <PresenceIndicator status={chat.status} />
                                  <p
                                    className={cn(
                                      "text-sm truncate",
                                      isActive
                                        ? "font-semibold text-foreground"
                                        : "font-medium",
                                    )}
                                  >
                                    {chat.name}
                                  </p>
                                  <GroupVerificationBadge
                                    groupId={chat.id}
                                    showLabel={false}
                                  />
                                </div>
                                <div className="shrink-0 flex flex-col items-end gap-1">
                                  <p className="text-[11px] text-muted-foreground whitespace-nowrap">
                                    {chat.lastSeen}
                                  </p>
                                  {chat.unreadCount > 0 && (
                                    <span className="inline-flex items-center justify-center min-w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold px-1.5">
                                      {chat.unreadCount}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {chat.lastMessage}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            </aside>

            {mobileSidebarOpen && (
              <button
                type="button"
                className="md:hidden absolute inset-0 z-10 bg-black/30"
                onClick={() => setMobileSidebarOpen(false)}
              />
            )}

            <section
              className={cn(
                "flex-1 flex flex-col bg-background/30 transition-opacity duration-300",
                activeMobileTab === "chats" && "hidden md:flex",
              )}
            >
              {!selectedChat && (
                <ChatWelcomeState
                  onCreateGroup={() => console.log("Open Create Group Overlay Trigger")}
                  onJoinGroup={() => console.log("Open Join Group Code Overlay Trigger")}
                />
              )}

              {selectedChat && (
                <>
                  <header className="px-4 sm:px-5 py-3 border-b border-border/70 bg-card/70 backdrop-blur-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-lg border border-border/80"
                          onClick={() => setMobileSidebarOpen(true)}
                        >
                          <Menu className="h-4 w-4" />
                        </button>

                        <button
                          type="button"
                          className="hidden md:inline-flex items-center justify-center h-9 w-9 rounded-lg border border-border/80"
                          onClick={() => setSelectedChatId(null)}
                        >
                          <ArrowLeft className="h-4 w-4" />
                        </button>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="font-semibold truncate">
                              {selectedChat.name}
                            </p>
                            <GroupVerificationBadge groupId={selectedChat.id} />
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {memberCountByRoom[selectedChat.id] !== undefined
                              ? `${memberCountByRoom[selectedChat.id]} members`
                              : "Member count unavailable"}
                            {` • ${selectedChat.address.slice(0, 8)}...`}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setIsAdmin(!isAdmin)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                            isAdmin
                              ? "border-primary/50 bg-primary/10 text-primary font-medium"
                              : "border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                          )}
                          title={
                            isAdmin
                              ? "Admin mode active (pin/unpin enabled)"
                              : "Enable admin mode to pin messages"
                          }
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          {isAdmin ? "Admin" : "Member"}
                        </button>

                        <button
                          type="button"
                          onClick={() => setAuditTrailOpen(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        >
                          <ScrollText className="h-3.5 w-3.5" />
                          Audit
                        </button>
                        <button
                          type="button"
                          onClick={() => setRoomMembersOpen(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        >
                          <Users className="h-3.5 w-3.5" />
                          Members
                        </button>
                      </div>
                    </div>
                  </header>

                  {/* Pinned Messages Banner */}
                  {selectedChat && pinnedIds.length > 0 && (
                    <div className="px-4 py-2 bg-card/90 border-b border-border/70 flex items-center justify-between gap-3 text-xs shadow-sm backdrop-blur-sm">
                      <div
                        onClick={() =>
                          activePinnedMessage &&
                          handleScrollToMessage(activePinnedMessage.id)
                        }
                        className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer hover:opacity-85 transition"
                        title="Click to jump to original message"
                      >
                        <div className="p-1.5 rounded-full bg-primary/15 text-primary shrink-0">
                          <Pin className="h-3.5 w-3.5 rotate-45" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-primary text-[11px] uppercase tracking-wide">
                              Pinned Message{" "}
                              {pinnedMessages.length > 1
                                ? `(${activePinnedIndex + 1}/${pinnedMessages.length})`
                                : ""}
                            </span>
                          </div>
                          <p className="text-foreground/90 truncate font-medium text-xs mt-0.5">
                            {activePinnedMessage
                              ? activePinnedMessage.text
                              : "Pinned message"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {pinnedMessages.length > 1 && (
                          <div className="flex items-center gap-0.5 mr-1 border-r border-border/60 pr-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                handlePrevPinned(selectedChat.id, pinnedMessages.length)
                              }
                              className="p-1 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition"
                              aria-label="Previous pinned message"
                            >
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleNextPinned(selectedChat.id, pinnedMessages.length)
                              }
                              className="p-1 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition"
                              aria-label="Next pinned message"
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}

                        {isAdmin && activePinnedMessage && (
                          <button
                            type="button"
                            onClick={() =>
                              togglePinMessage(selectedChat.id, activePinnedMessage.id)
                            }
                            className="p-1 text-muted-foreground hover:text-destructive hover:bg-muted/50 rounded-md transition"
                            title="Unpin message"
                            aria-label="Unpin message"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Collapsible message search bar */}
                  <MessageSearchBar
                    isVisible={messageSearchOpen}
                    value={messageSearchQuery}
                    onChange={setMessageSearchQuery}
                    onClose={handleCloseSearch}
                    resultCount={filteredMessages.length}
                  />

                  <div className="px-4 sm:px-5 pt-3">
                    <RoomActivityPanel roomId={selectedChatId} />
                  </div>

                   <div
                     ref={scrollContainerRef}
                     data-message-container="true"
                     className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 bg-gradient-to-b from-background/40 to-background"
                     onScroll={(e) => {
                       const container = e.currentTarget;
                       // Load more when scrolled near top (within 100px)
                       if (container.scrollTop < 100 && selectedChatId && !isLoadingMoreMessages[selectedChatId]) {
                         loadMoreMessages(selectedChatId);
                       }
                     }}
                   >
                     {/* Loading indicator for pagination */}
                     {isLoadingMoreMessages[selectedChatId || ''] && (
                       <div className="flex justify-center py-2">
                         <Loader2 className="h-5 w-5 animate-spin text-primary" />
                       </div>
                     )}

                     {/* Beginning of conversation indicator — only when not searching */}
                     {!messageSearchQuery.trim() && !hasMoreMessages[selectedChatId || ''] && messages.length > 0 && (
                       <p className="text-center text-muted-foreground text-xs py-2">
                         Beginning of conversation
                       </p>
                     )}

                     {isLoadingMessagesByRoom[selectedChatId || ''] && (
                       <div className="h-full flex items-center justify-center text-muted-foreground">
                         <Loader2 className="h-5 w-5 animate-spin" />
                       </div>
                     )}

                     {!isLoadingMessagesByRoom[selectedChatId || ''] && messages.length === 0 && (
                       <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                         No messages yet. Start the conversation.
                       </div>
                     )}

                     {/* Search: no results state */}
                     {!isLoadingMessagesByRoom[selectedChatId || ''] &&
                       messageSearchQuery.trim() &&
                       filteredMessages.length === 0 && (
                         <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                           <Search className="h-8 w-8 opacity-30" />
                           <p className="text-sm">No messages match &ldquo;{messageSearchQuery}&rdquo;</p>
                         </div>
                       )}

                     {!isLoadingMessagesByRoom[selectedChatId || ''] &&
                        filteredMessages.map((message) => (
                          <ChatMessageBubble 
                            key={message.id} 
                            message={message} 
                            searchQuery={messageSearchQuery}
                            isPinned={pinnedIds.includes(message.id)}
                            isAdmin={isAdmin}
                            onTogglePin={(msgId) => togglePinMessage(selectedChat.id, msgId)}
                            isHighlighted={highlightedMessageId === message.id}
                            onReply={handleReplyToMessage}
                            onJumpToMessage={handleScrollToMessage}
                          />
                        ))}
                   </div>

                  <div className="border-t border-border/70 bg-card/80 backdrop-blur-sm">
                    {replyingToMessage && (
                      <div className="px-4 py-2 bg-muted/60 border-b border-border/60 flex items-center justify-between gap-3 text-xs animate-in fade-in slide-in-from-bottom-2 duration-200">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className="p-1 rounded-md bg-primary/10 text-primary shrink-0">
                            <Reply className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-primary text-[11px]">
                                Replying to {replyingToMessage.author === "me" ? "yourself" : (replyingToMessage.senderName || selectedChat.name || "message")}
                              </span>
                            </div>
                            <p className="text-muted-foreground truncate text-xs mt-0.5">
                              {replyingToMessage.text}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleCancelReply}
                          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition"
                          title="Cancel reply (Esc)"
                          aria-label="Cancel reply"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}

                    <div className="p-3 sm:p-4 flex items-end gap-2 sm:gap-3">
                      <button
                        type="button"
                        className="h-10 w-10 shrink-0 rounded-full border border-border/80 flex items-center justify-center text-muted-foreground hover:bg-muted/40"
                      >
                        <Smile className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="h-10 w-10 shrink-0 rounded-full border border-border/80 flex items-center justify-center text-muted-foreground hover:bg-muted/40"
                      >
                        <Paperclip className="h-4 w-4" />
                      </button>

                      <textarea
                        ref={composerInputRef}
                        value={inputMessage}
                        onChange={(event) =>
                          setInputMessage(event.target.value)
                        }
                        onKeyDown={handleComposerKeyDown}
                        rows={1}
                        placeholder="Type a message (Ctrl+Enter to send)"
                        title="Type a message (Ctrl+Enter to send)"
                        className="flex-1 min-h-10 max-h-32 resize-none rounded-2xl border border-border/80 bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                      />

                      <button
                        type="button"
                        onClick={() => void handleSendMessage()}
                        disabled={!inputMessage.trim() || isSending}
                        className="h-10 w-10 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50"
                      >
                        {isSending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <SendHorizontal className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <RoomMembersDialog
                    roomId={selectedChat.id}
                    open={roomMembersOpen}
                    onOpenChange={setRoomMembersOpen}
                  />
                  <GroupAuditDialog
                    groupId={selectedChat.id}
                    open={auditTrailOpen}
                    onOpenChange={setAuditTrailOpen}
                  />
                </>
              )}
            </section>
          </div>
        </div>

        <nav className="md:hidden fixed inset-x-3 bottom-3 z-30 rounded-2xl border border-border/70 bg-card/95 backdrop-blur shadow-lg pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-2 gap-1 p-1.5">
            <button
              type="button"
              onClick={() => {
                setActiveMobileTab("chats");
                setMobileSidebarOpen(false);
              }}
              className={cn(
                "min-h-12 rounded-xl inline-flex items-center justify-center gap-2 text-sm font-medium transition-colors",
                activeMobileTab === "chats"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/40",
              )}
            >
              <PanelLeft className="h-4 w-4" /> Groups
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveMobileTab("conversation");
                setMobileSidebarOpen(false);
              }}
              className={cn(
                "min-h-12 rounded-xl inline-flex items-center justify-center gap-2 text-sm font-medium transition-colors",
                activeMobileTab === "conversation"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/40",
              )}
            >
              <MessageSquare className="h-4 w-4" /> Chat
            </button>
          </div>
        </nav>
      </main>
      <Footer />
    </div>
  );
}