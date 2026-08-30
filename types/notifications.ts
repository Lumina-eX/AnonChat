export type NotificationType =
  | "group_added"
  | "ownership_transferred"
  | "member_removed";

export type NotificationDeliveryStatus = "pending" | "delivered" | "failed";

export interface NotificationRecord {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  group_id: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  delivery_status: NotificationDeliveryStatus;
  delivery_error: string | null;
  created_at: string;
}

export interface NotificationListResponse {
  notifications: NotificationRecord[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  unreadCount: number;
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  groupId?: string | null;
  metadata?: Record<string, unknown>;
}
