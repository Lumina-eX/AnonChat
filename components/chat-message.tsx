"use client";

import { cn } from "@/lib/utils";

interface ChatMessageProps {
  message: {
    id: string;
    text: string;
    time: string;
    author: "me" | "them";
    status?: "sending" | "sent" | "delivered" | "read";
  };
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isMe = message.author === "me";

  return (
    <div
      className={cn(
        "flex w-full mb-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-300",
        isMe ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "flex flex-col max-w-[85%] sm:max-w-[72%] group",
          isMe ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "relative px-4 py-2.5 rounded-2xl text-sm transition-all shadow-sm",
            isMe
              ? "bg-primary text-primary-foreground rounded-br-none"
              : "bg-card border border-border/70 text-foreground rounded-bl-none",
          )}
        >
          <p className="leading-relaxed break-words whitespace-pre-wrap">
            {message.text}
          </p>
        </div>

        {/* Timestamp: Visible on hover or small screens */}
        <div
          className={cn(
            "flex items-center gap-1.5 mt-1 px-1 text-[10px] transition-opacity duration-200",
            "opacity-0 group-hover:opacity-100 sm:opacity-0 md:group-hover:opacity-100", // Hidden until hover on desktop
            "max-md:opacity-70", // Always visible but subtle on mobile
            isMe ? "text-primary/70" : "text-muted-foreground",
          )}
        >
          <span>{message.time}</span>
          {isMe && (
            <span className="font-bold">
              {message.status === "sending" ? "..." : "✓✓"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
