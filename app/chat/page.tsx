"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ChatEmptyState } from "@/components/chat-empty-state";
import { PresenceIndicator, type PresenceStatus } from "@/components/presence-indicator";
import { RoomMembersDialog } from "@/components/room-members-dialog";
import ConnectWallet from "@/components/wallet-connector";
import { cn } from "@/lib/utils";
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
  Timer,
  Users,
} from "lucide-react";
import { MessageSkeleton, RoomListSkeleton } from "@/components/chat-skeleton";

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
  status: "sending" | "sent" | "delivered" | "read";
  isEphemeral?: boolean;
  expiresAt?: string | null;
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
  status?: "sent" | "delivered" | "read";
  is_ephemeral?: boolean;
  expires_at?: string | null;
}

export default function ChatPage() {
  const [query, setQuery] = useState("");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState("");
  const [roomMembersOpen, setRoomMembersOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<"chats" | "conversation">(
    "conversation",
  );

  const [currentUser, setCurrentUser] = useState<{ id: string } | null>(null);
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, ChatMessage[]>>({});
  const [memberCountByRoom, setMemberCountByRoom] = useState<Record<string, number>>({});

  // Ephemeral message composer state
  const [isEphemeralMode, setIsEphemeralMode] = useState(false);
  // Countdown ticker — forces re-render every second so expiry labels stay fresh
  const [, setTick] = useState(0);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const transformToChatMessage = useCallback(
    (message: DBMessage): ChatMessage => ({
      id: message.id,
      author: message.user_id === currentUser?.id ? "me" : "them",
      text: message.content,
      time: new Date(message.created_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
      status: message.status || "sent",
      isEphemeral: message.is_ephemeral ?? false,
      expiresAt: message.expires_at ?? null,
    }),
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
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || "Failed to fetch rooms");
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
      setSelectedChatId((currentSelected) => currentSelected || previews[0]?.id || null);
    } catch (error) {
      console.error("Failed to fetch rooms", error);
      setChats([]);
    } finally {
      setIsLoadingRooms(false);
    }
  }, [fetchRoomLastMessagePreview]);

  const fetchMessagesForRoom = useCallback(
    async (roomId: string) => {
      setIsLoadingMessages(true);
      try {
        const response = await fetch(
          `/api/messages?room_id=${encodeURIComponent(roomId)}&limit=100&offset=0`,
        );
        const data = await response.json();
        if (!response.ok || data.error) {
          throw new Error(data.error || "Failed to fetch messages");
        }

        const parsed = (data.messages || [])
          .map(transformToChatMessage)
          .reverse();

        setMessagesByChat((prev) => ({
          ...prev,
          [roomId]: parsed,
        }));
      } catch (error) {
        console.error("Failed to fetch messages", error);
        setMessagesByChat((prev) => ({
          ...prev,
          [roomId]: [],
        }));
      } finally {
        setIsLoadingMessages(false);
      }
    },
    [transformToChatMessage],
  );

  const fetchMemberCount = useCallback(async (roomId: string) => {
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/members`);
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
      // Member count is optional metadata in the UI.
    }
  }, []);

  useEffect(() => {
    fetchCurrentUser();
    fetchRooms();
  }, [fetchCurrentUser, fetchRooms]);

  // Tick every second so ephemeral countdown labels stay current
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selectedChatId) {
      return;
    }

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

  useEffect(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [selectedChatId, messagesByChat]);

  const handleSelectChat = useCallback((chatId: string) => {
    setSelectedChatId(chatId);
    setMobileSidebarOpen(false);
    setActiveMobileTab("conversation");
  }, []);

  const isMobileSidebarVisible = mobileSidebarOpen || activeMobileTab === "chats";

  const handleSendMessage = useCallback(async () => {
    const trimmedMessage = inputMessage.trim();
    if (!trimmedMessage || !selectedChatId) {
      return;
    }

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
      isEphemeral: isEphemeralMode,
      expiresAt: null,
    };

    setMessagesByChat((prev) => ({
      ...prev,
      [selectedChatId]: [...(prev[selectedChatId] || []), optimisticMessage],
    }));
    setInputMessage("");
    setIsSending(true);

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          room_id: selectedChatId,
          content: trimmedMessage,
          is_ephemeral: isEphemeralMode,
        }),
      });
      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || "Failed to send message");
      }

      const savedMessage: ChatMessage = data.message
        ? transformToChatMessage(data.message)
        : {
            ...optimisticMessage,
            status: "sent",
          };

      setMessagesByChat((prev) => ({
        ...prev,
        [selectedChatId]: (prev[selectedChatId] || []).map((message) =>
          message.id === tempId ? savedMessage : message,
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
    } catch (error) {
      console.error("Failed to send message", error);
      setMessagesByChat((prev) => ({
        ...prev,
        [selectedChatId]: (prev[selectedChatId] || []).filter(
          (message) => message.id !== tempId,
        ),
      }));
    } finally {
      setIsSending(false);
    }
  }, [inputMessage, selectedChatId, transformToChatMessage]);

  const handleComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle Enter key for sending message (only when not combined with Shift)
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        // Only send if there's actual content to send
        if (inputMessage.trim()) {
          void handleSendMessage();
        }
      }
      // Allow Shift+Enter to create new lines (default behavior)
      // Also allow other keyboard shortcuts like Ctrl+C, Ctrl+V, etc.
    },
    [handleSendMessage, inputMessage],
  );

  /**
   * Returns a human-readable countdown string for an ephemeral message.
   * e.g. "23h 59m", "4m 30s", "< 1s"
   */
  const formatExpiry = useCallback((expiresAt: string | null | undefined): string => {
    if (!expiresAt) return "";
    const remainingMs = new Date(expiresAt).getTime() - Date.now();
    if (remainingMs <= 0) return "expired";
    const totalSec = Math.floor(remainingMs / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    if (minutes < 60) return `${minutes}m ${seconds}s`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours < 24) return `${hours}h ${mins}m`;
    const days = Math.floor(hours / 24);
    const hrs = hours % 24;
    return `${days}d ${hrs}h`;
  }, []);

  const filteredChats = useMemo(() => {
    if (!query.trim()) {
      return chats;
    }

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

  const messages = selectedChat ? (messagesByChat[selectedChat.id] || []) : [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 pt-24 pb-24 md:pb-8 px-3 sm:px-6">
        <div className="mx-auto w-full max-w-7xl h-[min(84vh,820px)] rounded-3xl border border-border/70 bg-card/90 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)] backdrop-blur-sm overflow-hidden">
          <div className="h-full flex relative">
            <aside
              className={cn(
                "absolute inset-y-0 left-0 z-20 w-full border-r border-border/70 bg-card md:static md:w-[340px] md:max-w-none",
                "transition-transform duration-300 ease-out md:translate-x-0",
                isMobileSidebarVisible ? "translate-x-0" : "-translate-x-full",
              )}
              aria-label="Group sidebar"
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
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search groups or messages"
                      className="w-full rounded-xl border border-border/80 bg-background/70 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                                   {isLoadingRooms && <RoomListSkeleton />}

                  {!isLoadingRooms && filteredChats.length === 0 && (
                    <div className="p-4 text-sm text-muted-foreground">No groups found.</div>
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
                            "w-full text-left p-3 rounded-xl transition mb-1",
                            "border border-transparent hover:bg-muted/40",
                            isActive && "bg-primary/10 border-primary/25",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <PresenceIndicator status={chat.status} />
                                <p className="font-medium text-sm truncate">{chat.name}</p>
                              </div>
                              <p className="text-xs text-muted-foreground truncate mt-1">
                                {chat.lastMessage}
                              </p>
                            </div>

                            <div className="shrink-0 text-right">
                              <p className="text-[11px] text-muted-foreground">{chat.lastSeen}</p>
                              {chat.unreadCount > 0 && (
                                <span className="inline-flex items-center justify-center min-w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold mt-1 px-1.5">
                                  {chat.unreadCount}
                                </span>
                              )}
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
                aria-label="Close group sidebar"
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
              {!selectedChat && <ChatEmptyState />}

              {selectedChat && (
                <>
                  <header className="px-4 sm:px-5 py-3 border-b border-border/70 bg-card/70 backdrop-blur-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-lg border border-border/80"
                          onClick={() => setMobileSidebarOpen(true)}
                          aria-label="Open groups"
                        >
                          <Menu className="h-4 w-4" />
                        </button>

                        <button
                          type="button"
                          className="hidden md:inline-flex items-center justify-center h-9 w-9 rounded-lg border border-border/80"
                          onClick={() => setSelectedChatId(null)}
                          aria-label="Back to empty state"
                        >
                          <ArrowLeft className="h-4 w-4" />
                        </button>

                        <div className="min-w-0">
                          <p className="font-semibold truncate">{selectedChat.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {memberCountByRoom[selectedChat.id] !== undefined
                              ? `${memberCountByRoom[selectedChat.id]} members`
                              : "Member count unavailable"}
                            {` • ${selectedChat.address.slice(0, 8)}...`}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setRoomMembersOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      >
                        <Users className="h-3.5 w-3.5" />
                        Members
                      </button>
                    </div>
                  </header>

                  <div
                    ref={scrollContainerRef}
                    className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 bg-gradient-to-b from-background/40 to-background"
                  >
                    {isLoadingMessages && (
                      <div className="h-full flex items-center justify-center text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                    )}

                    {!isLoadingMessages && messages.length === 0 && (
                      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                        No messages yet. Start the conversation.
                      </div>
                    )}

                    {!isLoadingMessages &&
                      messages.map((message) => (
                        <div
                          key={message.id}
                          className={cn(
                            "max-w-[85%] sm:max-w-[72%] rounded-2xl px-4 py-2.5",
                            "text-sm shadow-sm",
                            message.author === "me"
                              ? "ml-auto bg-primary text-primary-foreground rounded-br-sm"
                              : "mr-auto bg-card border border-border/70 rounded-bl-sm",
                            // Ephemeral messages get a subtle amber tint
                            message.isEphemeral && message.author === "me" && "bg-amber-500/90 text-white",
                            message.isEphemeral && message.author === "them" && "border-amber-400/50 bg-amber-50/10",
                          )}
                        >
                          <p className="whitespace-pre-wrap break-words leading-relaxed">{message.text}</p>
                          <div
                            className={cn(
                              "mt-1 flex items-center justify-end gap-1 text-[10px]",
                              message.author === "me"
                                ? "text-primary-foreground/80"
                                : "text-muted-foreground",
                              message.isEphemeral && "text-amber-200/90",
                            )}
                          >
                            {/* Ephemeral countdown badge */}
                            {message.isEphemeral && message.expiresAt && (
                              <span
                                className="inline-flex items-center gap-0.5"
                                title={`Expires at ${new Date(message.expiresAt).toLocaleString()}`}
                                aria-label={`Ephemeral message, expires in ${formatExpiry(message.expiresAt)}`}
                              >
                                <Timer className="h-2.5 w-2.5" aria-hidden="true" />
                                {formatExpiry(message.expiresAt)}
                              </span>
                            )}
                            {/* Ephemeral badge without expiry (optimistic send) */}
                            {message.isEphemeral && !message.expiresAt && (
                              <span
                                className="inline-flex items-center gap-0.5"
                                aria-label="Ephemeral message"
                              >
                                <Timer className="h-2.5 w-2.5" aria-hidden="true" />
                                ephemeral
                              </span>
                            )}
                            <span>{message.time}</span>
                            {message.author === "me" && (
                              <span aria-label={`Delivery status: ${message.status}`}>
                                {message.status === "sending" ? "..." : 
                                 message.status === "sent" ? "✓" : "✓✓"}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>

                  <div className="p-3 sm:p-4 border-t border-border/70 bg-card/80 backdrop-blur-sm">
                    {/* Ephemeral mode banner */}
                    {isEphemeralMode && (
                      <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-400/30 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                        <Timer className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>Ephemeral mode — this message will auto-delete after 24 h</span>
                      </div>
                    )}

                    <div className="flex items-end gap-2 sm:gap-3">
                      <button
                        type="button"
                        aria-label="Insert emoji"
                        className="h-10 w-10 shrink-0 rounded-full border border-border/80 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      >
                        <Smile className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        aria-label="Attach file"
                        className="h-10 w-10 shrink-0 rounded-full border border-border/80 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      >
                        <Paperclip className="h-4 w-4" />
                      </button>

                      {/* Ephemeral toggle */}
                      <button
                        type="button"
                        onClick={() => setIsEphemeralMode((v) => !v)}
                        aria-label={isEphemeralMode ? "Disable ephemeral mode" : "Enable ephemeral mode"}
                        aria-pressed={isEphemeralMode}
                        title={isEphemeralMode ? "Ephemeral mode on — click to disable" : "Send as ephemeral (auto-deletes)"}
                        className={cn(
                          "h-10 w-10 shrink-0 rounded-full border flex items-center justify-center transition-colors",
                          isEphemeralMode
                            ? "border-amber-400/60 bg-amber-500/15 text-amber-500 hover:bg-amber-500/25"
                            : "border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/40",
                        )}
                      >
                        <Timer className="h-4 w-4" />
                      </button>

                      <textarea
                        value={inputMessage}
                        onChange={(event) => setInputMessage(event.target.value)}
                        onKeyDown={handleComposerKeyDown}
                        rows={1}
                        placeholder={
                          isEphemeralMode
                            ? "Ephemeral message (auto-deletes after 24 h)…"
                            : "Type a message (Enter to send, Shift+Enter for new line)"
                        }
                        className={cn(
                          "flex-1 min-h-10 max-h-32 resize-none rounded-2xl border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2",
                          isEphemeralMode
                            ? "border-amber-400/50 focus:ring-amber-400/30"
                            : "border-border/80 focus:ring-primary/30",
                        )}
                      />

                      <button
                        type="button"
                        onClick={() => void handleSendMessage()}
                        disabled={!inputMessage.trim() || isSending}
                        aria-label="Send message"
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
                </>
              )}
            </section>
          </div>
        </div>

        <nav
          aria-label="Mobile navigation"
          className="md:hidden fixed inset-x-3 bottom-3 z-30 rounded-2xl border border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 shadow-lg"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          <div className="grid grid-cols-2 gap-1 p-1.5">
            <button
              type="button"
              aria-label="Show groups"
              aria-pressed={activeMobileTab === "chats"}
              onClick={() => {
                setActiveMobileTab("chats");
                setMobileSidebarOpen(false);
              }}
              className={cn(
                "min-h-12 rounded-xl inline-flex items-center justify-center gap-2 text-sm font-medium transition-colors",
                activeMobileTab === "chats"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              <PanelLeft className="h-4 w-4" />
              Groups
            </button>
            <button
              type="button"
              aria-label="Show conversation"
              aria-pressed={activeMobileTab === "conversation"}
              onClick={() => {
                setActiveMobileTab("conversation");
                setMobileSidebarOpen(false);
              }}
              className={cn(
                "min-h-12 rounded-xl inline-flex items-center justify-center gap-2 text-sm font-medium transition-colors",
                activeMobileTab === "conversation"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              <MessageSquare className="h-4 w-4" />
              Chat
            </button>
          </div>
        </nav>
      </main>

      <Footer />
    </div>
  );
}
