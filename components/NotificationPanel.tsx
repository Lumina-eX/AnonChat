"use client";

import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { useNotifications } from "@/lib/notifications/use-notifications";
import { cn } from "@/lib/utils";
import type { NotificationRecord } from "@/types/notifications";

function NotificationItem({
  notification,
  onRead,
}: {
  notification: NotificationRecord;
  onRead: (id: string) => Promise<void>;
}) {
  const isUnread = !notification.read_at;

  return (
    <button
      type="button"
      onClick={() => {
        if (isUnread) {
          void onRead(notification.id);
        }
      }}
      className={cn(
        "w-full text-left px-3 py-3 border-b border-border/60 transition-colors hover:bg-muted/50",
        isUnread && "bg-primary/5",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{notification.title}</p>
        {isUnread ? (
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
        {notification.body}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {formatDistanceToNow(new Date(notification.created_at), {
          addSuffix: true,
        })}
      </p>
    </button>
  );
}

export function NotificationPanel() {
  const [userId, setUserId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const supabase = createClient();

  const {
    notifications,
    unreadCount,
    loading,
    error,
    hasMore,
    refresh,
    loadMore,
    markAsRead,
    markAllAsRead,
  } = useNotifications(Boolean(userId));

  useEffect(() => {
    let mounted = true;

    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (mounted) {
        setUserId(user?.id ?? null);
      }
    }

    void loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase.auth]);

  if (!userId) {
    return null;
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          void refresh();
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/80 hover:bg-muted/50 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[min(100vw-2rem,24rem)] rounded-xl border border-border/80 bg-card shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/70">
            <div>
              <h3 className="text-sm font-semibold">Notifications</h3>
              <p className="text-xs text-muted-foreground">
                {unreadCount > 0
                  ? `${unreadCount} unread`
                  : "You're all caught up"}
              </p>
            </div>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markAllAsRead()}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-[min(60vh,24rem)] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : null}

            {error ? (
              <div className="px-4 py-6 text-sm text-destructive text-center">
                {error}
              </div>
            ) : null}

            {!loading && !error && notifications.length === 0 ? (
              <div className="px-4 py-8 text-sm text-muted-foreground text-center">
                No notifications yet.
              </div>
            ) : null}

            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onRead={markAsRead}
              />
            ))}

            {hasMore ? (
              <div className="p-3">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  className="w-full rounded-lg border border-border/80 px-3 py-2 text-xs font-medium hover:bg-muted/40"
                >
                  Load more
                </button>
              </div>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
