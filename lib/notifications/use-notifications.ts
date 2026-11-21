"use client";

import { useCallback, useEffect, useState } from "react";
import { useWebSocketContext } from "@/lib/websocket/context";
import type {
  NotificationListResponse,
  NotificationRecord,
} from "@/types/notifications";
import { toast } from "react-hot-toast";

export function useNotifications(enabled: boolean) {
  const { on } = useWebSocketContext();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const fetchNotifications = useCallback(
    async (nextOffset = 0, append = false) => {
      if (!enabled) return;

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          limit: "20",
          offset: String(nextOffset),
        });
        const response = await fetch(`/api/notifications?${params.toString()}`);
        const data: NotificationListResponse & { error?: string } =
          await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to load notifications");
        }

        setNotifications((prev) =>
          append
            ? [...prev, ...data.notifications]
            : data.notifications,
        );
        setUnreadCount(data.unreadCount);
        setHasMore(data.pagination.hasMore);
        setOffset(nextOffset + data.notifications.length);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load notifications",
        );
      } finally {
        setLoading(false);
      }
    },
    [enabled],
  );

  const markAsRead = useCallback(async (notificationId: string) => {
    const response = await fetch(
      `/api/notifications/${encodeURIComponent(notificationId)}/read`,
      { method: "PATCH" },
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to mark notification as read");
    }

    setNotifications((prev) =>
      prev.map((item) =>
        item.id === notificationId
          ? { ...item, read_at: new Date().toISOString() }
          : item,
      ),
    );
    setUnreadCount((count) => Math.max(0, count - 1));
  }, []);

  const markAllAsRead = useCallback(async () => {
    const response = await fetch("/api/notifications/mark-all-read", {
      method: "POST",
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to mark all notifications as read");
    }

    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((item) => ({ ...item, read_at: item.read_at ?? now })),
    );
    setUnreadCount(0);
  }, []);

  useEffect(() => {
    if (enabled) {
      void fetchNotifications(0, false);
    }
  }, [enabled, fetchNotifications]);

  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = on("notification", (message) => {
      const payload = message.payload as NotificationRecord;
      if (!payload?.id) return;

      setNotifications((prev) => {
        if (prev.some((item) => item.id === payload.id)) {
          return prev;
        }
        return [payload, ...prev];
      });
      setUnreadCount((count) => count + 1);
      toast(payload.title, { icon: "🔔" });
    });

    return unsubscribe;
  }, [enabled, on]);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    hasMore,
    offset,
    refresh: () => fetchNotifications(0, false),
    loadMore: () => fetchNotifications(offset, true),
    markAsRead,
    markAllAsRead,
  };
}
