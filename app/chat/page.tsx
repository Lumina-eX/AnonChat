"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChatWelcomeState } from "@/components/chat-welcome-state";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ChatEmptyState } from "@/components/chat-empty-state";
import { GroupAuditDialog } from "@/components/group-audit-dialog";
import { InviteMembersDialog } from "@/components/invite-members-dialog";
import {
  PresenceIndicator,
  type PresenceStatus,
} from "@/components/presence-indicator";
import { RoomMembersDialog } from "@/components/room-members-dialog";
import {
  ForwardMessageDialog,
  type ForwardedMessage,
} from "@/components/forward-message-dialog";
import * as ContextMenu from "@radix-ui/react-context-menu";
import toast from "react-hot-toast";
import ConnectWallet from "@/components/wallet-connector";
import { RoomActivityPanel } from "@/components/room-activity-panel";
import MemberPanel from "@/components/MemberPanel";
import { MessageSearchBar } from "@/components/message-search-bar";
import { GroupVerificationBadge } from "@/components/GroupVerificationBadge";
import { ChatMessageBubble, type ChatMessage } from "@/components/chat-message-bubble";
import { cn } from "@/lib/utils";
import { highlightText } from "@/lib/highlight-text";
import { handleAppError } from "@/lib/error-handler"; // Integrated Error Handler
import {
  clearDraft,
  getDraft,
  setDraft,
  subscribeDraft,
} from "@/lib/drafts/draft-store";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Forward,
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
import { handleRovingKeyDown, useFocusTrap, useMediaQuery } from "@/lib/a11y";
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

/** Reason a URL-specified group could not be opened. */
type DeepLinkError =
  | "not_found"     // Group does not exist or was deleted
  | "unauthorized"; // Group exists but user is not a member

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
  is_forwarded?: boolean | null;
  forwarded_original_created_at?: string | null;
}

/** Debounce before a composer edit is written to the draft store. */
const DRAFT_SAVE_DEBOUNCE_MS = 400;

/** Mirrors the server-side default in lib/middleware/message-validation.ts. */
const MAX_MESSAGE_LENGTH = 2000;
/** Show the character counter once the user gets close to the limit. */
const MESSAGE_LENGTH_WARNING_THRESHOLD = MAX_MESSAGE_LENGTH - 200;

/**
 * Inner page component — must be wrapped in <Suspense> because it calls
 * useSearchParams(), which requires a Suspense boundary in Next.js App Router.
 */
function ChatPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Track deep-link resolution so we apply the URL param exactly once after
  // rooms have finished loading.
  const deepLinkApplied = useRef(false);
  const [deepLinkError, setDeepLinkError] = useState<DeepLinkError | null>(null);

  const [query, setQuery] = useState("");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState("");
  const [isDraftSaved, setIsDraftSaved] = useState(false);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const [roomMembersOpen, setRoomMembersOpen] = useState(false);
  const [forwardMessageId, setForwardMessageId] = useState<string | null>(
    null,
  );
  const [memberPanelMobileOpen, setMemberPanelMobileOpen] = useState(false);
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

  // --- Accessibility state ---------------------------------------------
  const sidebarRef = useRef<HTMLElement>(null);
  const conversationListRef = useRef<HTMLUListElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const messageSearchButtonRef = useRef<HTMLButtonElement>(null);
  const conversationHeadingRef = useRef<HTMLHeadingElement>(null);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [sendError, setSendError] = useState<string | null>(null);
  // Text pushed to the visually-hidden live region for screen readers.
  const [announcement, setAnnouncement] = useState("");
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Announce a message to assistive technologies. The region is cleared
   * first so repeating the same text (e.g. "Message sent") is re-announced.
   */
  const announce = useCallback((text: string) => {
    setAnnouncement("");
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    announceTimerRef.current = setTimeout(() => setAnnouncement(text), 100);
  }, []);

  useEffect(() => {
    return () => {
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    };
  }, []);

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

  // Restore the saved draft whenever the active group changes. Drafts live in
  // localStorage only, so nothing is ever sent to the backend.
  useEffect(() => {
    const restored = selectedChatId ? getDraft(selectedChatId) : "";
    setInputMessage(restored);
    setIsDraftSaved(restored.length > 0);
  }, [selectedChatId]);

  // Keep the "Draft saved" indicator truthful if the draft changes elsewhere.
  useEffect(() => {
    if (!selectedChatId) return;
    return subscribeDraft(selectedChatId, (draft) => {
      setIsDraftSaved(draft.length > 0);
    });
  }, [selectedChatId]);

  const cancelPendingDraftSave = useCallback(() => {
    if (draftSaveTimerRef.current !== null) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
  }, []);

  // Drop any pending debounce when the page unmounts.
  useEffect(() => {
    return () => cancelPendingDraftSave();
  }, [cancelPendingDraftSave]);

  const handleComposerChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setInputMessage(value);
      setSendError(null);

      if (!selectedChatId) return;

      // Persist after a short pause so we do not write on every keystroke.
      cancelPendingDraftSave();
      draftSaveTimerRef.current = setTimeout(() => {
        draftSaveTimerRef.current = null;
        if (value.trim()) {
          setIsDraftSaved(setDraft(selectedChatId, value));
        } else {
          clearDraft(selectedChatId);
          setIsDraftSaved(false);
        }
      }, DRAFT_SAVE_DEBOUNCE_MS);
    },
    [cancelPendingDraftSave, selectedChatId],
  );

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
        isForwarded: Boolean(message.is_forwarded),
        forwardedOriginalAt: message.forwarded_original_created_at ?? null,
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

      // --- Deep-link resolution (runs only once) ---
      // Read the ?group= param from the URL at the time rooms finish loading.
      // We do this inside the callback so we always see the freshly-loaded room
      // list rather than a stale closure value.
      if (!deepLinkApplied.current) {
        deepLinkApplied.current = true;

        const urlGroupId = searchParams.get("group");

        if (urlGroupId) {
          const matchedRoom = previews.find((r) => r.id === urlGroupId);

          if (matchedRoom) {
            // Valid group the user has access to — select it.
            setSelectedChatId(urlGroupId);
            setDeepLinkError(null);
          } else if (previews.length === 0) {
            // User has no rooms at all — we can't tell whether this group
            // ever existed, treat as not-found.
            setDeepLinkError("not_found");
            setSelectedChatId(null);
            // Remove the stale param from the URL.
            const params = new URLSearchParams(searchParams.toString());
            params.delete("group");
            const qs = params.toString();
            router.replace(qs ? `/chat?${qs}` : "/chat", { scroll: false });
          } else {
            // Rooms loaded but the requested group is not in the list — the
            // user either lacks access or the group was deleted.  Show the
            // unauthorised banner; the API doesn't disambiguate these two
            // cases from the client, so we show "unauthorized" as the default
            // (the most common real-world scenario — sharing a private group).
            setDeepLinkError("unauthorized");
            setSelectedChatId(previews[0]?.id || null);
            // Remove the inaccessible group from the URL, fall back to first.
            const params = new URLSearchParams(searchParams.toString());
            if (previews[0]) {
              params.set("group", previews[0].id);
            } else {
              params.delete("group");
            }
            const qs = params.toString();
            router.replace(qs ? `/chat?${qs}` : "/chat", { scroll: false });
          }
        } else {
          // No group param — default to first room as before.
          setSelectedChatId(
            (currentSelected) => currentSelected || previews[0]?.id || null,
          );
        }
      } else {
        // Subsequent re-fetches (e.g. new room created) preserve current selection.
        setSelectedChatId(
          (currentSelected) => currentSelected || previews[0]?.id || null,
        );
      }
    } catch {
      setChats([]);
      setSelectedChatId(null);
    } finally {
      setIsLoadingRooms(false);
    }
  }, [fetchRoomLastMessagePreview, searchParams, router]);

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

  // Sync selected group with browser back / forward navigation.
  // When the user presses Back or Forward, the URL's ?group= param changes and
  // searchParams updates (Next.js router), so we read from it reactively.
  useEffect(() => {
    const urlGroupId = searchParams.get("group");

    // Skip during the initial room load — fetchRooms handles that case.
    if (!deepLinkApplied.current) return;

    setSelectedChatId((prev) => {
      if (!urlGroupId) {
        // URL no longer has a group param — deselect.
        return null;
      }
      if (urlGroupId === prev) {
        // Already selected — no change needed.
        return prev;
      }
      // Switch to the group referenced by the URL.
      setDeepLinkError(null);
      return urlGroupId;
    });
  }, [searchParams]);

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
    setDeepLinkError(null);
    setReplyingToMessage(null);
    setSendError(null);
    setMobileSidebarOpen(false);
    setActiveMobileTab("conversation");

    // On small screens the group list is hidden once a group is chosen, so
    // move focus to the conversation heading instead of losing it.
    if (!isDesktop) {
      requestAnimationFrame(() => conversationHeadingRef.current?.focus());
    }

    // Reflect the selected group in the URL without a full page reload so
    // users can share/bookmark the link and browser back/forward works.
    const params = new URLSearchParams(searchParams.toString());
    params.set("group", chatId);
    router.push(`/chat?${params.toString()}`, { scroll: false });
  }, [router, searchParams, isDesktop]);

  const handleReplyToMessage = useCallback((message: ChatMessage) => {
    setReplyingToMessage(message);
    composerInputRef.current?.focus();
  }, []);

  const handleCancelReply = useCallback(() => {
    setReplyingToMessage(null);
    composerInputRef.current?.focus();
  }, []);

  const isMobileSidebarVisible =
    mobileSidebarOpen || activeMobileTab === "chats";

  // The mobile slide-over sidebar is modal: trap focus inside it, close it
  // on Escape and return focus to the menu button that opened it.
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
  useFocusTrap(sidebarRef, mobileSidebarOpen && !isDesktop, {
    onEscape: closeMobileSidebar,
    returnFocusRef: mobileMenuButtonRef,
  });

  const isMessageTooLong = inputMessage.length > MAX_MESSAGE_LENGTH;

  const handleSendMessage = useCallback(async () => {
    const trimmedMessage = inputMessage.trim();
    if (!trimmedMessage || !selectedChatId) return;

    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      setSendError(
        `Message is too long. Messages can be at most ${MAX_MESSAGE_LENGTH} characters.`,
      );
      composerInputRef.current?.focus();
      return;
    }

    if (!window.navigator.onLine) {
      handleAppError(new Error("network"), "NETWORK");
      setSendError("You appear to be offline. Your message was not sent.");
      return;
    }

    setSendError(null);

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
    cancelPendingDraftSave();
    setInputMessage("");
    setReplyingToMessage(null);
    setIsDraftSaved(false);
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

      // The message reached the backend, so the draft is no longer needed.
      clearDraft(selectedChatId);
      setIsDraftSaved(false);

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
      announce("Message sent");

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
      setSendError(
        "Message could not be sent. Your text has been kept so you can try again.",
      );

      // Sending failed: restore the text and its draft so nothing is lost.
      setInputMessage(trimmedMessage);
      setIsDraftSaved(setDraft(selectedChatId, trimmedMessage));

      setMessagesByChat((prev) => ({
        ...prev,
        [selectedChatId]: (prev[selectedChatId] || []).filter(
          (msg) => msg.id !== tempId,
        ),
      }));
    } finally {
      setIsSending(false);
    }
  }, [inputMessage, selectedChatId, replyingToMessage, transformToChatMessage, chats, cancelPendingDraftSave, announce]);

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
        // The forward dialog (Radix) handles its own Escape.
        if (forwardMessageId) return;
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
  }, [forwardMessageId, roomMembersOpen, mobileSidebarOpen, replyingToMessage]);

  const handleForwardMessage = useCallback((message: ChatMessage) => {
    setForwardMessageId(message.id);
  }, []);

  const handleMessageForwarded = useCallback(
    (destination: { id: string; name: string }, message: ForwardedMessage) => {
      const forwarded = transformToChatMessage(message);
      // Only append if the destination's history is already loaded; otherwise
      // it is fetched (including this message) when that group is opened.
      setMessagesByChat((prev) =>
        prev[destination.id]
          ? { ...prev, [destination.id]: [...prev[destination.id], forwarded] }
          : prev,
      );
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === destination.id
            ? {
                ...chat,
                lastMessage: message.content,
                lastSeen: forwarded.time,
              }
            : chat,
        ),
      );
    },
    [transformToChatMessage],
  );

  const handleCopyMessage = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Message copied");
    } catch {
      toast.error("Couldn't copy message");
    }
  }, []);

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
    // Return focus to the control that opened the search bar.
    requestAnimationFrame(() => messageSearchButtonRef.current?.focus());
  }, []);

  // --- Screen-reader announcements for new messages ---------------------
  // Only messages appended to the end of the currently open conversation are
  // announced; initial loads, room switches and "load older" are not, so the
  // user is not flooded with the whole history.
  const lastAnnouncedRef = useRef<{ chatId: string | null; lastId: string | null }>({
    chatId: null,
    lastId: null,
  });
  useEffect(() => {
    const last = messages[messages.length - 1];
    const previous = lastAnnouncedRef.current;
    lastAnnouncedRef.current = { chatId: selectedChatId, lastId: last?.id ?? null };

    if (!last || previous.chatId !== selectedChatId || previous.lastId === null) return;
    if (previous.lastId === last.id) return;
    if (last.author === "them") {
      announce(`New message from ${last.senderName || "a group member"}: ${last.text}`);
    }
  }, [messages, selectedChatId, announce]);

  // Announce when a conversation finishes loading.
  const wasLoadingMessagesRef = useRef(false);
  const isLoadingSelectedMessages = selectedChatId
    ? Boolean(isLoadingMessagesByRoom[selectedChatId])
    : false;
  useEffect(() => {
    if (wasLoadingMessagesRef.current && !isLoadingSelectedMessages && selectedChat) {
      const count = messagesByChat[selectedChat.id]?.length ?? 0;
      announce(
        count === 0
          ? `${selectedChat.name} opened. No messages yet.`
          : `${selectedChat.name} opened. ${count} ${count === 1 ? "message" : "messages"} loaded.`,
      );
    }
    wasLoadingMessagesRef.current = isLoadingSelectedMessages;
  }, [isLoadingSelectedMessages, selectedChat, messagesByChat, announce]);

  // Reset search when switching rooms
  useEffect(() => {
    setMessageSearchQuery("");
    setMessageSearchOpen(false);
  }, [selectedChatId]);

  const composerDescribedBy = [
    "composer-hint",
    replyingToMessage ? "composer-reply-context" : null,
    inputMessage.length > MESSAGE_LENGTH_WARNING_THRESHOLD ? "composer-char-count" : null,
    sendError || isMessageTooLong ? "composer-error" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Skip links let keyboard users bypass the site header. */}
      {selectedChat && (
        <a href="#message-composer" className="skip-link">
          Skip to message composer
        </a>
      )}
      <a href="#chat-group-search" className="skip-link">
        Skip to groups
      </a>

      {/* Polite live region for new messages and status updates. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <Header />

      <StellarNetworkStatus variant="banner" />
      <WalletNetworkWarning variant="banner" />

      {/* Deep-link error banner — shown when URL contains an inaccessible group */}
      {deepLinkError && (
        <div
          role="alert"
          className="flex items-center gap-3 px-4 py-2.5 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            {deepLinkError === "unauthorized"
              ? "You don't have access to the requested group. Showing your first available group instead."
              : "The requested group no longer exists or could not be found."}
          </span>
          <button
            type="button"
            onClick={() => setDeepLinkError(null)}
            className="shrink-0 p-1 rounded hover:bg-destructive/20 transition-colors"
            aria-label="Dismiss notice"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <main id="main-content" className="flex-1 pt-24 pb-24 md:pb-8 px-3 sm:px-6">
        <div className="mx-auto w-full max-w-7xl h-[min(84vh,820px)] rounded-3xl border border-border/70 bg-card/90 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)] backdrop-blur-sm overflow-hidden">
          <div className="h-full flex relative">
            <aside
              id="chat-sidebar"
              ref={sidebarRef}
              aria-label="Groups"
              role={mobileSidebarOpen && !isDesktop ? "dialog" : undefined}
              aria-modal={mobileSidebarOpen && !isDesktop ? true : undefined}
              // Off-screen on mobile: remove from tab order / a11y tree.
              inert={!isDesktop && !isMobileSidebarVisible}
              className={cn(
                "absolute inset-y-0 left-0 z-20 w-full border-r border-border/70 bg-card md:static md:w-[340px] md:max-w-none",
                "transition-transform duration-300 ease-out md:translate-x-0",
                isMobileSidebarVisible ? "translate-x-0" : "-translate-x-full",
              )}
            >
              <div className="h-full flex flex-col">
                <div className="p-4 border-b border-border/70 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="chat-groups-heading" className="text-base font-semibold">Groups</h2>
                    <div className="shrink-0">
                      <ConnectWallet />
                    </div>
                  </div>

                  <div className="relative" role="search">
                    <label htmlFor="chat-group-search" className="sr-only">
                      Search groups
                    </label>
                    <Search
                      aria-hidden="true"
                      className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <input
                      id="chat-group-search"
                      ref={searchInputRef}
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search groups or messages (Ctrl+K)"
                      title="Search (Ctrl+K)"
                      aria-keyshortcuts="Control+K Meta+K"
                      aria-controls="chat-conversation-list"
                      className="w-full rounded-xl border border-muted-foreground/50 bg-background/70 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    {query.trim() && (
                      <p role="status" className="sr-only">
                        {filteredChats.length === 0
                          ? "No groups found"
                          : `${filteredChats.length} ${filteredChats.length === 1 ? "group" : "groups"} found`}
                      </p>
                    )}
                  </div>
                </div>

                <nav
                  aria-labelledby="chat-groups-heading"
                  className="flex-1 overflow-y-auto p-2"
                  aria-busy={isLoadingRooms}
                >
                  {isLoadingRooms && (
                    <div
                      role="status"
                      className="flex items-center justify-center h-full text-muted-foreground"
                    >
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                      <span className="sr-only">Loading groups…</span>
                    </div>
                  )}

                  {!isLoadingRooms && filteredChats.length === 0 && (
                    <div className="p-4 text-sm text-muted-foreground">
                      No groups found.
                    </div>
                  )}

                  {!isLoadingRooms && filteredChats.length > 0 && (
                    <ul
                      id="chat-conversation-list"
                      ref={conversationListRef}
                      aria-label="Your groups. Use the up and down arrow keys to move between groups."
                      onKeyDown={(event) =>
                        handleRovingKeyDown(
                          event,
                          conversationListRef.current,
                          '[data-conversation-item="true"]',
                        )
                      }
                    >
                  {filteredChats.map((chat) => {
                      const isActive = chat.id === selectedChatId;
                      return (
                        <li key={chat.id}>
                        <button
                          type="button"
                          data-conversation-item="true"
                          aria-current={isActive ? "true" : undefined}
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
                              aria-hidden="true"
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
                                    {chat.lastSeen && (
                                      <span className="sr-only">Last message at </span>
                                    )}
                                    {chat.lastSeen}
                                  </p>
                                  {chat.unreadCount > 0 && (
                                    <span className="inline-flex items-center justify-center min-w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold px-1.5">
                                      {chat.unreadCount}
                                      <span className="sr-only">
                                        {chat.unreadCount === 1 ? " unread message" : " unread messages"}
                                      </span>
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
                        </li>
                      );
                    })}
                    </ul>
                  )}
                </nav>
              </div>
            </aside>

            {mobileSidebarOpen && (
              // Pointer-only backdrop; keyboard users close with Escape.
              <div
                aria-hidden="true"
                className="md:hidden absolute inset-0 z-10 bg-black/30"
                onClick={() => setMobileSidebarOpen(false)}
              />
            )}

            <section
              aria-labelledby={selectedChat ? "conversation-heading" : undefined}
              aria-label={selectedChat ? undefined : "Conversation"}
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
                          ref={mobileMenuButtonRef}
                          type="button"
                          className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-lg border border-border/80"
                          onClick={() => setMobileSidebarOpen(true)}
                          aria-label="Open groups list"
                          aria-expanded={mobileSidebarOpen}
                          aria-controls="chat-sidebar"
                        >
                          <Menu className="h-4 w-4" aria-hidden="true" />
                        </button>

                        <button
                          type="button"
                          className="hidden md:inline-flex items-center justify-center h-9 w-9 rounded-lg border border-border/80"
                          onClick={() => {
                            setSelectedChatId(null);
                            // Remove the group param from the URL so the
                            // address bar reflects the deselected state and
                            // the back-button can restore it.
                            const params = new URLSearchParams(searchParams.toString());
                            params.delete("group");
                            const qs = params.toString();
                            router.push(qs ? `/chat?${qs}` : "/chat", { scroll: false });
                            // Keep keyboard focus on a sensible element after
                            // the conversation (and this button) disappears.
                            requestAnimationFrame(() => searchInputRef.current?.focus());
                          }}
                          aria-label="Close conversation"
                        >
                          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        </button>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <h2
                              id="conversation-heading"
                              ref={conversationHeadingRef}
                              tabIndex={-1}
                              className="font-semibold truncate text-base rounded"
                            >
                              {selectedChat.name}
                            </h2>
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
                          aria-label={
                            isAdmin
                              ? "Admin mode on. Turn off to stop pinning messages"
                              : "Member mode. Turn on admin mode to pin messages"
                          }
                        >
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          {isAdmin ? "Admin" : "Member"}
                        </button>

                        <button
                          ref={messageSearchButtonRef}
                          type="button"
                          onClick={() =>
                            messageSearchOpen ? handleCloseSearch() : setMessageSearchOpen(true)
                          }
                          aria-label="Search messages"
                          aria-expanded={messageSearchOpen}
                          aria-controls="message-search-input"
                          className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        >
                          <Search className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setAuditTrailOpen(true)}
                          aria-haspopup="dialog"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        >
                          <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
                          Audit
                        </button>
                        <button
                          type="button"
                          onClick={() => setMemberPanelMobileOpen(true)}
                          aria-expanded={memberPanelMobileOpen}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        >
                          <Users className="h-3.5 w-3.5" aria-hidden="true" />
                          Members
                        </button>
                        <InviteMembersDialog
                          groupName={selectedChat.name}
                          inviteCode={`ANON-${selectedChat.id
                            .replace(/[^a-z0-9]/gi, "")
                            .slice(-6)
                            .toUpperCase()}`}
                        />
                        <button
                          type="button"
                          onClick={() => setRoomMembersOpen(true)}
                          aria-haspopup="dialog"
                          aria-label="Manage members"
                          className="hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-border/80 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        >
                          Manage
                        </button>
                      </div>
                    </div>
                  </header>

                  {/* Pinned Messages Banner */}
                  {selectedChat && pinnedIds.length > 0 && (
                    <section
                      aria-label="Pinned messages"
                      className="px-4 py-2 bg-card/90 border-b border-border/70 flex items-center justify-between gap-3 text-xs shadow-sm backdrop-blur-sm"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          activePinnedMessage &&
                          handleScrollToMessage(activePinnedMessage.id)
                        }
                        disabled={!activePinnedMessage}
                        className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-md cursor-pointer hover:opacity-85 transition"
                        title="Jump to original message"
                      >
                        <span className="p-1.5 rounded-full bg-primary/15 text-primary shrink-0" aria-hidden="true">
                          <Pin className="h-3.5 w-3.5 rotate-45" />
                        </span>
                        <span className="min-w-0 flex-1 block">
                          <span className="block font-semibold text-primary text-[11px] uppercase tracking-wide">
                            Pinned Message{" "}
                            {pinnedMessages.length > 1
                              ? `(${activePinnedIndex + 1}/${pinnedMessages.length})`
                              : ""}
                          </span>
                          <span className="block text-foreground/90 truncate font-medium text-xs mt-0.5">
                            {activePinnedMessage
                              ? activePinnedMessage.text
                              : "Pinned message"}
                          </span>
                          <span className="sr-only">. Jump to message</span>
                        </span>
                      </button>

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
                              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleNextPinned(selectedChat.id, pinnedMessages.length)
                              }
                              className="p-1 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition"
                              aria-label="Next pinned message"
                            >
                              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
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
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </section>
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
                     role="region"
                     aria-label={`Messages in ${selectedChat.name}. Use the up and down arrow keys to move between messages.`}
                     aria-busy={isLoadingSelectedMessages}
                     // Focusable so keyboard users can scroll it and enter
                     // message navigation with the arrow keys.
                     tabIndex={0}
                     onKeyDown={(event) => {
                       const target = event.target as HTMLElement;
                       // Only handle arrows on the container or a message
                       // itself, not inside its action buttons.
                       if (
                         target !== event.currentTarget &&
                         !target.matches('[data-message-item="true"]')
                       ) {
                         return;
                       }
                       handleRovingKeyDown(
                         event,
                         event.currentTarget,
                         '[data-message-item="true"]',
                       );
                     }}
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
                       <div role="status" className="flex justify-center py-2">
                         <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
                         <span className="sr-only">Loading older messages…</span>
                       </div>
                     )}

                     {/* Keyboard / screen-reader alternative to scroll-to-load */}
                     {!messageSearchQuery.trim() &&
                       hasMoreMessages[selectedChatId || ''] &&
                       !isLoadingMoreMessages[selectedChatId || ''] &&
                       messages.length > 0 && (
                         <div className="flex justify-center">
                           <button
                             type="button"
                             onClick={() => selectedChatId && void loadMoreMessages(selectedChatId)}
                             className="rounded-full border border-border/80 px-3 py-1 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                           >
                             Load older messages
                           </button>
                         </div>
                       )}

                     {/* Beginning of conversation indicator — only when not searching */}
                     {!messageSearchQuery.trim() && !hasMoreMessages[selectedChatId || ''] && messages.length > 0 && (
                       <p className="text-center text-muted-foreground text-xs py-2">
                         Beginning of conversation
                       </p>
                     )}

                     {isLoadingMessagesByRoom[selectedChatId || ''] && (
                       <div role="status" className="h-full flex items-center justify-center text-muted-foreground">
                         <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                         <span className="sr-only">Loading messages…</span>
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
                           <Search className="h-8 w-8 opacity-30" aria-hidden="true" />
                           <p className="text-sm">No messages match &ldquo;{messageSearchQuery}&rdquo;</p>
                         </div>
                       )}

                     {!isLoadingMessagesByRoom[selectedChatId || ''] &&
                        filteredMessages.map((message) => (
                          <ContextMenu.Root key={message.id}>
                            <ContextMenu.Trigger
                              asChild
                              disabled={message.status === "sending"}
                            >
                              <div>
                                <ChatMessageBubble
                                  message={message}
                                  searchQuery={messageSearchQuery}
                                  isPinned={pinnedIds.includes(message.id)}
                                  isAdmin={isAdmin}
                                  onTogglePin={(msgId) => togglePinMessage(selectedChat.id, msgId)}
                                  isHighlighted={highlightedMessageId === message.id}
                                  onReply={handleReplyToMessage}
                                  onJumpToMessage={handleScrollToMessage}
                                  onForward={handleForwardMessage}
                                />
                              </div>
                            </ContextMenu.Trigger>
                            <ContextMenu.Portal>
                              <ContextMenu.Content className="z-50 min-w-40 rounded-xl border border-border/70 bg-card p-1 text-sm shadow-lg">
                                <ContextMenu.Item
                                  onSelect={() => handleReplyToMessage(message)}
                                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 outline-none data-[highlighted]:bg-muted/60"
                                >
                                  <Reply className="h-4 w-4" /> Reply
                                </ContextMenu.Item>
                                <ContextMenu.Item
                                  onSelect={() => handleForwardMessage(message)}
                                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 outline-none data-[highlighted]:bg-muted/60"
                                >
                                  <Forward className="h-4 w-4" /> Forward
                                </ContextMenu.Item>
                                <ContextMenu.Item
                                  onSelect={() => void handleCopyMessage(message.text)}
                                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 outline-none data-[highlighted]:bg-muted/60"
                                >
                                  <Copy className="h-4 w-4" /> Copy text
                                </ContextMenu.Item>
                              </ContextMenu.Content>
                            </ContextMenu.Portal>
                          </ContextMenu.Root>
                       filteredMessages.length > 0 && (
                       <ol aria-label="Messages" className="space-y-3">
                        {filteredMessages.map((message) => (
                          <li key={message.id} className="list-none">
                          <ChatMessageBubble
                            message={message} 
                            searchQuery={messageSearchQuery}
                            isPinned={pinnedIds.includes(message.id)}
                            isAdmin={isAdmin}
                            onTogglePin={(msgId) => togglePinMessage(selectedChat.id, msgId)}
                            isHighlighted={highlightedMessageId === message.id}
                            onReply={handleReplyToMessage}
                            onJumpToMessage={handleScrollToMessage}
                          />
                          </li>
                        ))}
                       </ol>
                     )}
                   </div>

                  <form
                    aria-label="Send a message"
                    className="border-t border-border/70 bg-card/80 backdrop-blur-sm"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSendMessage();
                    }}
                  >
                    {replyingToMessage && (
                      <div className="px-4 py-2 bg-muted/60 border-b border-border/60 flex items-center justify-between gap-3 text-xs animate-in fade-in slide-in-from-bottom-2 duration-200">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className="p-1 rounded-md bg-primary/10 text-primary shrink-0" aria-hidden="true">
                            <Reply className="h-3.5 w-3.5" />
                          </div>
                          <div id="composer-reply-context" className="min-w-0 flex-1">
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
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    )}

                    {isDraftSaved && (
                      <div
                        className="px-4 pt-2 flex items-center justify-end gap-1 text-[11px] text-muted-foreground animate-in fade-in"
                      >
                        <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        Draft saved
                      </div>
                    )}

                    <div className="p-3 sm:p-4 flex items-end gap-2 sm:gap-3">
                      {/* Not implemented yet: exposed as disabled rather than
                          as silent no-op buttons. */}
                      <button
                        type="button"
                        aria-label="Insert emoji (coming soon)"
                        title="Emoji picker coming soon"
                        aria-disabled="true"
                        className="h-10 w-10 shrink-0 rounded-full border border-border/80 flex items-center justify-center text-muted-foreground hover:bg-muted/40 aria-disabled:cursor-not-allowed"
                      >
                        <Smile className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="Attach file (coming soon)"
                        title="Attachments coming soon"
                        aria-disabled="true"
                        className="h-10 w-10 shrink-0 rounded-full border border-border/80 flex items-center justify-center text-muted-foreground hover:bg-muted/40 aria-disabled:cursor-not-allowed"
                      >
                        <Paperclip className="h-4 w-4" aria-hidden="true" />
                      </button>

                      <label htmlFor="message-composer" className="sr-only">
                        Message {selectedChat.name}
                      </label>
                      <textarea
                        id="message-composer"
                        ref={composerInputRef}
                        value={inputMessage}
                        onChange={handleComposerChange}
                        onKeyDown={handleComposerKeyDown}
                        rows={1}
                        placeholder="Type a message (Enter to send)"
                        title="Type a message (Enter to send, Shift+Enter for a new line)"
                        aria-describedby={composerDescribedBy}
                        aria-invalid={isMessageTooLong || Boolean(sendError) || undefined}
                        aria-keyshortcuts="Enter"
                        className={cn(
                          "flex-1 min-h-10 max-h-32 resize-none rounded-2xl border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30",
                          isMessageTooLong || sendError
                            ? "border-destructive"
                            : "border-muted-foreground/50",
                        )}
                      />

                      <button
                        type="submit"
                        disabled={!inputMessage.trim() || isSending || isMessageTooLong}
                        aria-label={isSending ? "Sending message" : "Send message"}
                        className="h-10 w-10 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50"
                      >
                        {isSending ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <SendHorizontal className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>

                    <div className="px-4 pb-2 -mt-2 flex items-start justify-between gap-3 text-[11px]">
                      <p id="composer-hint" className="sr-only">
                        Press Enter to send. Press Shift and Enter for a new line.
                        {replyingToMessage ? " Press Escape to cancel the reply." : ""}
                      </p>
                      {/* Errors are announced assertively and also shown
                          with an icon + text, not colour alone. */}
                      <p
                        id="composer-error"
                        role="alert"
                        className="flex items-center gap-1 text-destructive font-medium empty:hidden"
                      >
                        {(sendError || isMessageTooLong) && (
                          <>
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            {sendError ??
                              `Message is too long by ${inputMessage.length - MAX_MESSAGE_LENGTH} characters. Messages can be at most ${MAX_MESSAGE_LENGTH} characters.`}
                          </>
                        )}
                      </p>
                      {inputMessage.length > MESSAGE_LENGTH_WARNING_THRESHOLD && (
                        <p
                          id="composer-char-count"
                          className={cn(
                            "ml-auto tabular-nums",
                            isMessageTooLong ? "text-destructive font-medium" : "text-muted-foreground",
                          )}
                        >
                          {inputMessage.length} / {MAX_MESSAGE_LENGTH}
                          <span className="sr-only"> characters</span>
                        </p>
                      )}
                    </div>
                  </form>

                  <RoomMembersDialog
                    roomId={selectedChat.id}
                    open={roomMembersOpen}
                    onOpenChange={setRoomMembersOpen}
                  />
                  <ForwardMessageDialog
                    messageId={forwardMessageId}
                    onOpenChange={(open) => {
                      if (!open) setForwardMessageId(null);
                    }}
                    onForwarded={handleMessageForwarded}
                  />
                  <GroupAuditDialog
                    groupId={selectedChat.id}
                    open={auditTrailOpen}
                    onOpenChange={setAuditTrailOpen}
                  />
                </>
              )}
            </section>
            {selectedChat && (
              <MemberPanel
                roomId={selectedChat.id}
                mobileOpen={memberPanelMobileOpen}
                onMobileOpenChange={setMemberPanelMobileOpen}
                className="h-full"
              />
            )}
          </div>
        </div>

        <nav
          aria-label="Chat views"
          className="md:hidden fixed inset-x-3 bottom-3 z-30 rounded-2xl border border-border/70 bg-card/95 backdrop-blur shadow-lg pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-2 gap-1 p-1.5">
            <button
              type="button"
              onClick={() => {
                setActiveMobileTab("chats");
                setMobileSidebarOpen(false);
              }}
              aria-current={activeMobileTab === "chats" ? "page" : undefined}
              aria-controls="chat-sidebar"
              className={cn(
                "min-h-12 rounded-xl inline-flex items-center justify-center gap-2 text-sm font-medium transition-colors",
                activeMobileTab === "chats"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/40",
              )}
            >
              <PanelLeft className="h-4 w-4" aria-hidden="true" /> Groups
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveMobileTab("conversation");
                setMobileSidebarOpen(false);
              }}
              aria-current={activeMobileTab === "conversation" ? "page" : undefined}
              className={cn(
                "min-h-12 rounded-xl inline-flex items-center justify-center gap-2 text-sm font-medium transition-colors",
                activeMobileTab === "conversation"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/40",
              )}
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" /> Chat
            </button>
          </div>
        </nav>
      </main>
      <Footer />
    </div>
  );
}

/**
 * Wraps ChatPageInner in a Suspense boundary, which is required by Next.js
 * whenever a client component calls useSearchParams().
 */
export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div role="status" className="min-h-screen flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading chat…</span>
        </div>
      }
    >
      <ChatPageInner />
    </Suspense>
  );
}