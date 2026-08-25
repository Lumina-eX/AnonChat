import { cn } from "@/lib/utils";
import { highlightText } from "@/lib/highlight-text";
import { Pin } from "lucide-react";
import { MessageContextMenu } from "@/components/message-context-menu";

export type Reaction = {
  emoji: string;
  userIds: string[];
};

export type ChatMessage = {
  id: string;
  userId?: string;
  author: "me" | "them";
  text: string;
  time: string;
  status: "sending" | "sent" | "delivered" | "read";
  isPinned?: boolean;
  reactions?: Reaction[];
  replyTo?: {
    id: string;
    text: string;
    time: string;
  };
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
  onCopy?: (message: ChatMessage) => void | Promise<void>;
  onDelete?: (message: ChatMessage) => void | Promise<void>;
  onReport?: (message: ChatMessage) => void | Promise<void>;
}

// A lightweight set of emojis for quick reactions
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

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
  onCopy,
  onDelete,
  onReport,
}: ChatMessageBubbleProps) {
  const isMe = message.userId
    ? message.userId === currentUserId
    : message.author === "me";
  const handleEmojiClick = (emoji: string) => {
    onReact?.(message.id, emoji);
  };

  return (
    <div
      id={`msg-${message.id}`}
      data-message-id={message.id}
      className={cn(
        "group relative flex flex-col max-w-[85%] sm:max-w-[72%] transition-all duration-300",
        isMe ? "items-end ml-auto" : "items-start mr-auto"
      )}
    >
      {/* Emoji Picker (Hover effect) */}
      <div
        className={cn(
          "absolute -top-10 z-10 flex items-center gap-0.5 p-1 bg-popover border border-border rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200",
          isMe ? "right-2" : "left-2"
        )}
      >
        {QUICK_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => handleEmojiClick(emoji)}
            className="p-1 hover:bg-muted rounded-full text-sm transition-transform hover:scale-125"
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Message Bubble */}
      <MessageContextMenu
        canDelete={isMe}
        onReply={onReply ? () => onReply(message) : undefined}
        onCopy={onCopy ? () => onCopy(message) : undefined}
        onDelete={onDelete ? () => onDelete(message) : undefined}
        onReact={onReact ? (emoji) => onReact(message.id, emoji) : undefined}
        onReport={onReport ? () => onReport(message) : undefined}
      >
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
        {isPinned && (
          <div className="flex items-center gap-1 text-[10px] font-semibold mb-1 opacity-90 text-primary">
            <Pin className="h-3 w-3 rotate-45" />
            <span>Pinned</span>
          </div>
        )}

        {message.replyTo && (
          <div className="mb-2 border-l-2 border-current/40 pl-2 text-xs opacity-80">
            <p className="font-medium">Replying to a message</p>
            <p className="truncate">{message.replyTo.text}</p>
          </div>
        )}

        <p className="whitespace-pre-wrap break-words leading-relaxed">
          {highlightText(message.text, searchQuery)}
        </p>

        {isAdmin && onTogglePin && (
          <button
            type="button"
            onClick={() => onTogglePin(message.id)}
            title={isPinned ? "Unpin message" : "Pin message"}
            aria-label={isPinned ? "Unpin message" : "Pin message"}
            className={cn(
              "absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full border border-border bg-card text-foreground shadow-md hover:bg-muted focus:opacity-100 z-10",
              isPinned && "opacity-100 bg-primary/10 border-primary text-primary"
            )}
          >
            <Pin className="h-3 w-3 rotate-45" />
          </button>
        )}
        </div>
      </MessageContextMenu>

      {/* Reactions Display */}
      {message.reactions && message.reactions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {message.reactions.map((reaction) => {
            const hasReacted = reaction.userIds.includes(currentUserId);
            return (
              <button
                key={reaction.emoji}
                onClick={() => handleEmojiClick(reaction.emoji)}
                className={cn(
                  "flex items-center gap-1 text-xs rounded-full px-2 py-0.5 border transition-colors",
                  hasReacted
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-card border-border hover:bg-muted"
                )}
              >
                <span>{reaction.emoji}</span>
                <span className="font-medium">{reaction.userIds.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Timestamp & Status */}
      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
        <span>{message.time}</span>
        {isMe && (
          <span>{message.status === "sending" ? "..." : "✓✓"}</span>
        )}
      </div>
    </div>
  );
}