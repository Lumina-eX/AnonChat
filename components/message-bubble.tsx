"use client";

import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  text: string;
  time: string;
  isOwn: boolean;
  status?: "sending" | "sent" | "delivered" | "read";
}

export function MessageBubble({ text, time, isOwn, status }: MessageBubbleProps) {
  return (
    <div
      className={cn(
        "group max-w-[85%] sm:max-w-[72%] rounded-2xl px-4 py-2.5 shadow-sm text-sm",
        isOwn
          ? "ml-auto bg-primary text-primary-foreground rounded-br-sm"
          : "mr-auto bg-card border border-border/70 rounded-bl-sm",
      )}
    >
      <p className="whitespace-pre-wrap break-words leading-relaxed">{text}</p>
      <div
        className={cn(
          "mt-1 flex items-center justify-end gap-1 text-[10px]",
          // Always visible on mobile (sm and below), hover-only on desktop
          "sm:opacity-0 sm:group-hover:opacity-100 sm:transition-opacity sm:duration-150",
          isOwn ? "text-primary-foreground/80" : "text-muted-foreground",
        )}
      >
        <span>{time}</span>
        {isOwn && (
          <span>{status === "sending" ? "..." : "✓✓"}</span>
        )}
      </div>
    </div>
  );
}
