"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ChatEmptyState } from "@/components/chat-empty-state";
import { EditGroupDialog } from "@/components/edit-group-dialog";
import { PresenceIndicator, type PresenceStatus } from "@/components/presence-indicator";
import { RoomMembersDialog } from "@/components/room-members-dialog";
import ConnectWallet from "@/components/wallet-connector";
import { getPublicKey, onDisconnect } from "@/app/stellar-wallet-kit";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Loader2,
  Menu,
  MessageSquare,
  Paperclip,
  PanelLeft,
  Search,
  SendHorizontal,
  Smile,
  Users,
} from "lucide-react";

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
};

interface DBRoom {
  id: string;
  name: string;
  description?: string | null;
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
  const [query, setQuery] = useState("");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState("");
  const [roomMembersOpen, setRoomMembersOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<"chats" | "conversation">(
    "conversation",
  );

  const [currentUser, setCurrentUser] = useState<{ id: string } | null>(null);
  const [currentPublicKey, setCurrentPublicKey] = useState<string | null>(null);
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const [dbRooms, setDbRooms] = useState<DBRoom[]>([]);
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, ChatMessage[]>>({});
  const [memberCountByRoom, setMemberCountByRoom] = useState<Record<string, number>>({});

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
      status: "read",
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
      setDbRooms(rawRooms);

      const previews = await Promise.all(
        rawRooms.map(async (room) => {
          const preview = await fetchRoomLastMessagePreview(room.id);
          const fallbackAddress = room.owner_wallet
            ? `${room.owner_wallet.slice(0, 4)}...${room.owner_wallet.slice(-4)}`
            : room.address || room.id;

          return {
            id: room.id,
            name: room.name,
            address: fallbackAddress,
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
      setDbRooms([]);
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

        const parsed = (data.messages || []).map(transformToChatMessage).reverse();

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

  useEffect(() => {
    const syncWallet = async () => {
      const address = await getPublicKey();
      setCurrentPublicKey(address || null);
    };

    void syncWallet();
    const unsubscribe = onDisconnect(() => {
      setCurrentPublicKey(null);
    });
    const interval = setInterval(() => {
      void syncWallet();
    }, 3000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
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
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void handleSendMessage();
      }
    },
    [handleSendMessage],
  );

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

  const selectedRoom = useMemo(
    () => dbRooms.find((room) => room.id === selectedChatId) || null,
    [dbRooms, selectedChatId],
  );

  const canEditSelectedRoom =
    !!selectedRoom?.owner_wallet &&
    !!currentPublicKey &&
    selectedRoom.owner_wallet.toUpperCase() === currentPublicKey.toUpperCase();

  const isMobileSidebarVisible = mobileSidebarOpen || activeMobileTab === "chats";
  const messages = selectedChat ? (messagesByChat[selectedChat.id] || []) : [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 px-3 pt-24 pb-24 sm:px-6 md:pb-8">
        <div className="mx-auto h-[min(84vh,820px)] w-full max-w-7xl overflow-hidden rounded-3xl border border-border/70 bg-card/90 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)] backdrop-blur-sm">
          <div className="relative flex h-full">
            <aside
              className={cn(
                "absolute inset-y-0 left-0 z-20 w-full border-r border-border/70 bg-card md:static md:w-[340px] md:max-w-none",
                "transition-transform duration-300 ease-out md:translate-x-0",
                isMobileSidebarVisible ? "translate-x-0" : "-translate-x-full",
              )}
              aria-label="Group sidebar"
            >
              <div className="flex h-full flex-col">
                <div className="space-y-3 border-b border-border/70 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">Groups</h2>
                    <div className="shrink-0">
                      <ConnectWallet />
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search groups or messages"
                      className="w-full rounded-xl border border-border/80 bg-background/70 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                  {isLoadingRooms && (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  )}

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
                            "mb-1 w-full rounded-xl border border-transparent p-3 text-left transition",
                            "hover:bg-muted/40",
                            isActive && "border-primary/25 bg-primary/10",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <PresenceIndicator status={chat.status} />
                                <p className="truncate text-sm font-medium">{chat.name}</p>
                              </div>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                {chat.lastMessage}
                              </p>
                            </div>

                            <div className="shrink-0 text-right">
                              <p className="text-[11px] text-muted-foreground">{chat.lastSeen}</p>
                              {chat.unreadCount > 0 && (
                                <span className="mt-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
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
                className="absolute inset-0 z-10 bg-black/30 md:hidden"
                onClick={() => setMobileSidebarOpen(false)}
              />
            )}

            <section
              className={cn(
                "flex flex-1 flex-col bg-background/30 transition-opacity duration-300",
                activeMobileTab === "chats" && "hidden md:flex",
              )}
            >
              {!selectedChat && <ChatEmptyState />}

              {selectedChat && (
                <>
                  <header className="border-b border-border/70 bg-card/70 px-4 py-3 backdrop-blur-sm sm:px-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/80 md:hidden"
                          onClick={() => setMobileSidebarOpen(true)}
                          aria-label="Open groups"
                        >
                          <Menu className="h-4 w-4" />
                        </button>

                        <button
                          type="button"
                          className="hidden h-9 w-9 items-center justify-center rounded-lg border border-border/80 md:inline-flex"
                          onClick={() => setSelectedChatId(null)}
                          aria-label="Back to empty state"
                        >
                          <ArrowLeft className="h-4 w-4" />
                        </button>

                        <div className="min-w-0">
                          <p className="truncate font-semibold">{selectedChat.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {memberCountByRoom[selectedChat.id] !== undefined
                              ? `${memberCountByRoom[selectedChat.id]} members`
                              : "Member count unavailable"}
                            {` • ${selectedChat.address.slice(0, 8)}...`}
                          </p>
                          {selectedRoom?.description && (
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {selectedRoom.description}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setRoomMembersOpen(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                        >
                          <Users className="h-3.5 w-3.5" />
                          Members
                        </button>

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
                                    ? {
                                        ...chat,
                                        name: updatedRoom.name,
                                        address: updatedRoom.owner_wallet
                                          ? `${updatedRoom.owner_wallet.slice(0, 4)}...${updatedRoom.owner_wallet.slice(-4)}`
                                          : chat.address,
                                      }
                                    : chat,
                                ),
                              );
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </header>

                  <div
                    ref={scrollContainerRef}
                    className="flex-1 overflow-y-auto bg-gradient-to-b from-background/40 to-background p-4 sm:p-5"
                  >
                    <div className="space-y-3">
                      {isLoadingMessages && (
                        <div className="flex h-full items-center justify-center text-muted-foreground">
                          <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                      )}

                      {!isLoadingMessages && messages.length === 0 && (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                          No messages yet. Start the conversation.
                        </div>
                      )}

                      {!isLoadingMessages &&
                        messages.map((message) => (
                          <div
                            key={message.id}
                            className={cn(
                              "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm sm:max-w-[72%]",
                              message.author === "me"
                                ? "ml-auto rounded-br-sm bg-primary text-primary-foreground"
                                : "mr-auto rounded-bl-sm border border-border/70 bg-card",
                            )}
                          >
                            <p className="whitespace-pre-wrap break-words leading-relaxed">
                              {message.text}
                            </p>
                            <div
                              className={cn(
                                "mt-1 flex items-center justify-end gap-1 text-[10px]",
                                message.author === "me"
                                  ? "text-primary-foreground/80"
                                  : "text-muted-foreground",
                              )}
                            >
                              <span>{message.time}</span>
                              {message.author === "me" && (
                                <span aria-label={`Delivery status: ${message.status}`}>
                                  {message.status === "sending" ? "..." : "OK"}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="border-t border-border/70 bg-card/80 p-3 backdrop-blur-sm sm:p-4">
                    <div className="flex items-end gap-2 sm:gap-3">
                      <button
                        type="button"
                        aria-label="Insert emoji"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/80 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                      >
                        <Smile className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        aria-label="Attach file"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/80 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                      >
                        <Paperclip className="h-4 w-4" />
                      </button>

                      <textarea
                        value={inputMessage}
                        onChange={(event) => setInputMessage(event.target.value)}
                        onKeyDown={handleComposerKeyDown}
                        rows={1}
                        placeholder="Type a message"
                        className="min-h-10 max-h-32 flex-1 resize-none rounded-2xl border border-border/80 bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                      />

                      <button
                        type="button"
                        onClick={() => void handleSendMessage()}
                        disabled={!inputMessage.trim() || isSending}
                        aria-label="Send message"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
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
          className="fixed inset-x-3 bottom-3 z-30 rounded-2xl border border-border/70 bg-card/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85 md:hidden"
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
                "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors",
                activeMobileTab === "chats"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
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
                "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors",
                activeMobileTab === "conversation"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
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
