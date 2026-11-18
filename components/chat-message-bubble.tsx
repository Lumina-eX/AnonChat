import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { highlightText } from "@/lib/highlight-text";
import { Pin, Reply } from "lucide-react";

export type Reaction = {
  emoji: string;
  userIds: string[];
};

export type ReplyToInfo = {
  id: string;
  text: string;
  sender?: string;
  isDeleted?: boolean;
};

export type ChatMessage = {
  id: string;
  author: "me" | "them";
  text: string;
  time: string;
  status: "sending" | "sent" | "delivered" | "read";
  isPinned?: boolean;
  reactions?: Reaction[];
  replyTo?: ReplyToInfo | null;
  senderName?: string;
};

interface ChatMessageBubbleProps {
  message: ChatMessage;
  searchQuery?: string;
  isPinned?: boolean;
  isAdmin?: boolean;
  onTogglePin?: (messageId: string) => void;
  isHighlighted?: boolean;
  currentUserId?: string;
  onReact?: (messageId: string, emoji: string) => void;
  onReply?: (message: ChatMessage) => void;
  onJumpToMessage?: (messageId: string) => void;
}

// A lightweight set of emojis for quick reactions
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

/** Human-readable names so screen readers don't have to guess emoji meaning. */
const EMOJI_LABELS: Record<string, string> = {
  "👍": "thumbs up",
  "❤️": "heart",
  "😂": "laughing",
  "😮": "surprised",
  "😢": "sad",
  "🎉": "celebrate",
};

const STATUS_LABELS: Record<ChatMessage["status"], string> = {
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
};

export function ChatMessageBubble({
  message,
  searchQuery = "",
  isPinned = false,
  isAdmin = false,
  onTogglePin,
  isHighlighted = false,
  currentUserId = "me",
  onReact,
  onReply,
  onJumpToMessage,
}: ChatMessageBubbleProps) {
  const isMe = message.author === "me";
  const [showPicker, setShowPicker] = useState(false);
  const senderLabel = isMe ? "You" : message.senderName || "Group member";

  const handleEmojiClick = (emoji: string) => {
    onReact?.(message.id, emoji);
    setShowPicker(false);
  };

  return (
    <div
      id={`msg-${message.id}`}
      data-message-id={message.id}
      data-message-item="true"
      // Programmatically focusable so the message list can move focus
      // between messages with the arrow keys; Tab then reaches its actions.
      tabIndex={-1}
      role="article"
      aria-labelledby={`msg-${message.id}-sender msg-${message.id}-text`}
      className={cn(
        "group relative flex flex-col max-w-[85%] sm:max-w-[72%] rounded-2xl transition-all duration-300",
        isMe ? "items-end ml-auto" : "items-start mr-auto"
      )}
    >
      {/* Message Actions (Hover / Focus effect) */}
      <div
        role="toolbar"
        aria-label={`Actions for message from ${senderLabel}`}
        className={cn(
          "absolute -top-10 z-10 flex items-center gap-1 p-1 bg-popover border border-border rounded-full shadow-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200",
          isMe ? "right-2" : "left-2"
        )}
      >
        {QUICK_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => handleEmojiClick(emoji)}
            className="p-1 hover:bg-muted rounded-full text-sm transition-transform hover:scale-125"
            aria-label={`React with ${EMOJI_LABELS[emoji] ?? emoji}`}
          >
            <span aria-hidden="true">{emoji}</span>
          </button>
        ))}

        {onReply && (
          <>
            <div className="h-4 w-px bg-border/80 mx-0.5" aria-hidden="true" />
            <button
              type="button"
              onClick={() => onReply(message)}
              className="p-1 px-1.5 hover:bg-muted rounded-full text-xs text-muted-foreground hover:text-foreground transition-all flex items-center gap-1"
              title="Reply to message"
              aria-label="Reply to message"
            >
              <Reply className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="text-[11px] font-medium hidden sm:inline" aria-hidden="true">Reply</span>
            </button>
          </>
        )}
      </div>

      {/* Message Bubble */}
      <div
        className={cn(
          "rounded-2xl px-4 py-2.5 shadow-sm text-sm relative transition-all duration-300",
          isMe
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-card border border-border/70 rounded-bl-sm",
          isHighlighted && "ring-2 ring-primary bg-primary/20 scale-[1.02]",
          isPinned && "border-primary/50 shadow-md"
        )}
      >
        <span id={`msg-${message.id}-sender`} className="sr-only">
          {isMe ? "You said" : `${senderLabel} said`}
        </span>

        {isPinned && (
          <div
            className={cn(
              "flex items-center gap-1 text-[10px] font-semibold mb-1",
              isMe ? "text-primary-foreground" : "text-primary"
            )}
          >
            <Pin className="h-3 w-3 rotate-45" aria-hidden="true" />
            <span>Pinned</span>
          </div>
        )}

        {/* Quoted Message in Reply */}
        {message.replyTo && (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onJumpToMessage?.(message.replyTo!.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onJumpToMessage?.(message.replyTo!.id);
              }
            }}
            className={cn(
              "mb-2 rounded-lg border-l-2 py-1.5 px-2.5 text-xs cursor-pointer transition-all duration-150 select-none text-left",
              isMe
                ? "bg-primary-foreground/15 border-primary-foreground/70 hover:bg-primary-foreground/25 text-primary-foreground"
                : "bg-muted/80 border-primary hover:bg-muted text-foreground"
            )}
            title="Click to jump to original message"
            aria-label={`Replying to ${message.replyTo.sender || "message"}: ${message.replyTo.text}`}
          >
            <div className="flex items-center gap-1 font-semibold text-[11px] opacity-90 mb-0.5">
              <Reply className="h-3 w-3 inline-block shrink-0" aria-hidden="true" />
              <span className="truncate max-w-[200px]">
                {message.replyTo.sender || "Replying to message"}
              </span>
            </div>
            <p
              className={cn(
                "line-clamp-2 text-[11px] break-words",
                message.replyTo.isDeleted ? "italic opacity-60" : "opacity-85"
              )}
            >
              {message.replyTo.isDeleted
                ? "Original message was deleted"
                : message.replyTo.text || "Original message"}
            </p>
          </div>
        )}

        <p
          id={`msg-${message.id}-text`}
          className="whitespace-pre-wrap break-words leading-relaxed"
        >
          {highlightText(message.text, searchQuery)}
        </p>

        {isAdmin && onTogglePin && (
          <button
            type="button"
            onClick={() => onTogglePin(message.id)}
            title={isPinned ? "Unpin message" : "Pin message"}
            aria-label={isPinned ? "Unpin message" : "Pin message"}
            aria-pressed={isPinned}
            className={cn(
              "absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity p-1 rounded-full border border-border bg-card text-foreground shadow-md hover:bg-muted focus:opacity-100 z-10",
              isPinned && "opacity-100 bg-primary/10 border-primary text-primary"
            )}
          >
            <Pin className="h-3 w-3 rotate-45" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Reactions Display */}
      {message.reactions && message.reactions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1" role="group" aria-label="Reactions">
          {message.reactions.map((reaction) => {
            const hasReacted = reaction.userIds.includes(currentUserId);
            return (
              <button
                key={reaction.emoji}
                type="button"
                onClick={() => handleEmojiClick(reaction.emoji)}
                aria-pressed={hasReacted}
                aria-label={`${EMOJI_LABELS[reaction.emoji] ?? reaction.emoji}: ${reaction.userIds.length} ${
                  reaction.userIds.length === 1 ? "reaction" : "reactions"
                }${hasReacted ? ", including yours" : ""}`}
                className={cn(
                  "flex items-center gap-1 text-xs rounded-full px-2 py-0.5 border transition-colors",
                  hasReacted
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-card border-border hover:bg-muted"
                )}
              >
                <span aria-hidden="true">{reaction.emoji}</span>
                <span className="font-medium" aria-hidden="true">{reaction.userIds.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Timestamp & Status */}
      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
        <time>{message.time}</time>
        {isMe && (
          <>
            <span aria-hidden="true">{message.status === "sending" ? "..." : "✓✓"}</span>
            {/* Status is conveyed as text, not only by the tick symbol. */}
            <span className="sr-only">{STATUS_LABELS[message.status]}</span>
          </>
        )}
      </div>
    </div>
  );
}