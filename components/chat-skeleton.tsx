"use client";

import { cn } from "@/lib/utils";

function SkeletonBubble({ isOwn, short }: { isOwn: boolean; short?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl px-4 py-3 animate-pulse",
        isOwn
          ? "ml-auto bg-muted/40 rounded-br-sm"
          : "mr-auto bg-muted/30 rounded-bl-sm",
        short
          ? isOwn
            ? "max-w-[55%] sm:max-w-[45%]"
            : "max-w-[60%] sm:max-w-[50%]"
          : "max-w-[85%] sm:max-w-[72%]"
      )}
    >
      <div className="space-y-2">
        <div className="h-3 rounded-full bg-muted-foreground/15 w-48" />
        <div className="h-3 rounded-full bg-muted-foreground/10 w-32" />
      </div>
      <div className="mt-2 flex justify-end">
        <div className="h-2 w-8 rounded-full bg-muted-foreground/10" />
      </div>
    </div>
  );
}

function SkeletonRoomItem() {
  return (
    <div className="w-full p-3 rounded-xl border border-transparent mb-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/20" />
            <div className="h-4 w-24 rounded-full bg-muted-foreground/15 animate-pulse" />
          </div>
          <div className="h-3 w-full rounded-full bg-muted-foreground/10 animate-pulse" />
        </div>
        <div className="h-3 w-8 rounded-full bg-muted-foreground/10 animate-pulse shrink-0" />
      </div>
    </div>
  );
}

export function MessageSkeleton() {
  return (
    <div className="space-y-3 animate-in fade-in-0 duration-300">
      <SkeletonBubble isOwn={false} />
      <SkeletonBubble isOwn={true} />
      <SkeletonBubble isOwn={false} short />
      <SkeletonBubble isOwn={true} short />
      <SkeletonBubble isOwn={false} />
      <SkeletonBubble isOwn={true} />
      <SkeletonBubble isOwn={false} short />
    </div>
  );
}

export function RoomListSkeleton() {
  return (
    <div className="space-y-0 animate-in fade-in-0 duration-300">
      {Array.from({ length: 8 }).map((_, i) => (
        <SkeletonRoomItem key={i} />
      ))}
    </div>
  );
}