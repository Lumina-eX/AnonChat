"use client";

import React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { PresenceIndicator, type PresenceStatus } from "@/components/presence-indicator";
import { RoomListSkeleton } from "@/components/chat-skeleton";
import ConnectWallet from "@/components/wallet-connector";

/**
 * Group interface representing the data structure for the sidebar items.
 */
export interface Group {
  id: string;
  name: string;
  address: string;
  lastMessage: string;
  lastSeen: string;
  unreadCount: number;
  status: PresenceStatus;
}

interface GroupSidebarProps {
  groups: Group[];
  selectedGroupId: string | null;
  onSelectGroup: (id: string) => void;
  isLoading?: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  className?: string;
}

export function GroupSidebar({
  groups,
  selectedGroupId,
  onSelectGroup,
  isLoading,
  searchQuery,
  onSearchChange,
  className,
}: GroupSidebarProps) {
  return (
    <aside
      className={cn("h-full flex flex-col bg-card", className)}
      aria-label="Group sidebar"
    >
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
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search groups or messages"
            className="w-full rounded-xl border border-border/80 bg-background/70 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        {isLoading && <RoomListSkeleton />}

        {!isLoading && groups.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No groups found.</div>
        )}

        {!isLoading &&
          groups.map((group) => {
            const isActive = group.id === selectedGroupId;

            return (
              <button
                key={group.id}
                type="button"
                onClick={() => onSelectGroup(group.id)}
                className={cn(
                  "w-full text-left p-3 rounded-xl transition mb-1 group relative",
                  "border border-transparent hover:bg-muted/40",
                  isActive && "bg-primary/10 border-primary/25 shadow-sm",
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                )}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <PresenceIndicator status={group.status} />
                      <p className={cn(
                        "font-medium text-sm truncate",
                        isActive ? "text-primary" : "text-foreground"
                      )}>
                        {group.name}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-1 line-clamp-1">
                      {group.lastMessage}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-[11px] text-muted-foreground">{group.lastSeen}</p>
                    {group.unreadCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold mt-1 px-1.5">
                        {group.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
      </div>
    </aside>
  );
}