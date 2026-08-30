import type { NotificationRecord } from "@/types/notifications";

export interface RealtimeDispatchResult {
  delivered: boolean;
  error: string | null;
}

/**
 * Pushes a notification to a connected user via the WebSocket server's HTTP bridge.
 * Fails gracefully when the WS server is unavailable (notification remains in DB).
 */
async function postRealtimeEvent(
  userId: string,
  event: Record<string, unknown>,
): Promise<RealtimeDispatchResult> {
  const notifyUrl =
    process.env.WS_NOTIFY_URL ||
    `http://localhost:${process.env.WS_PORT || "3001"}/notify`;
  const secret = process.env.WS_NOTIFY_SECRET || "dev-notify-secret";

  try {
    const response = await fetch(notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ userId, event }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        delivered: false,
        error: body || `WebSocket dispatch failed with status ${response.status}`,
      };
    }

    return { delivered: true, error: null };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to reach WebSocket notification bridge";
    return { delivered: false, error: message };
  }
}

export function pushNotificationRealtime(
  userId: string,
  notification: NotificationRecord,
): Promise<RealtimeDispatchResult> {
  return postRealtimeEvent(userId, { type: "notification", payload: notification });
}

export function pushMemberRemovalRealtime(
  userId: string,
  groupId: string,
  payload: { targetWallet: string; removedBy: string },
): Promise<RealtimeDispatchResult> {
  return postRealtimeEvent(userId, {
    type: "member_removed",
    payload: {
      groupId,
      ...payload,
    },
  });
}
