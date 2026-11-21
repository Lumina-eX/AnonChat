# Notifications API

In-app notifications for group membership and ownership events. Notifications are persisted in Supabase and pushed in real time over WebSocket when the user is connected.

## Authentication

All endpoints require a valid Supabase session (wallet login cookie).

## Endpoints

### `GET /api/notifications`

Fetch paginated notification history for the authenticated user.

**Query parameters**

| Parameter     | Type    | Default | Description                          |
|---------------|---------|---------|--------------------------------------|
| `limit`       | number  | `20`    | Page size (1–100)                    |
| `offset`      | number  | `0`     | Pagination offset                    |
| `unread_only` | boolean | `false` | When `true`, return only unread rows |

**Response `200`**

```json
{
  "notifications": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "type": "group_added",
      "title": "Added to group",
      "body": "You were added to \"Shadow Explorers\".",
      "group_id": "room_123",
      "metadata": { "groupName": "Shadow Explorers" },
      "read_at": null,
      "delivery_status": "delivered",
      "delivery_error": null,
      "created_at": "2026-06-23T12:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 1,
    "hasMore": false
  },
  "unreadCount": 1
}
```

**Errors**

- `401` — not authenticated
- `500` — database error

---

### `PATCH /api/notifications/:id/read`

Mark a single notification as read.

**Response `200`**

```json
{
  "success": true,
  "notification": { "...": "updated row" }
}
```

**Errors**

- `401` — not authenticated
- `404` — notification not found for this user
- `500` — update failed

---

### `POST /api/notifications/mark-all-read`

Mark every unread notification as read for the authenticated user.

**Response `200`**

```json
{
  "success": true,
  "updatedCount": 3
}
```

## Real-time delivery

When a notification is created server-side:

1. A row is inserted into `public.notifications`.
2. The API calls the WebSocket HTTP bridge at `POST /notify`.
3. Connected clients receive a WebSocket message:

```json
{
  "type": "notification",
  "payload": { "...notification row..." },
  "timestamp": 1719158400000
}
```

### WebSocket bridge configuration

| Variable           | Default                      | Purpose                              |
|--------------------|------------------------------|--------------------------------------|
| `WS_NOTIFY_URL`    | `http://localhost:3001/notify` | HTTP endpoint on the WS server     |
| `WS_NOTIFY_SECRET` | `dev-notify-secret`          | Bearer token for the bridge          |
| `WS_PORT`          | `3001`                       | Used when `WS_NOTIFY_URL` is unset   |

If realtime delivery fails, the notification remains in the database with `delivery_status: "failed"` and `delivery_error` set. The UI can still load history via `GET /api/notifications`.

## Notification types

| `type`                   | Trigger                                      |
|--------------------------|----------------------------------------------|
| `group_added`            | User joins a group (`/api/groups/join`, `/api/rooms/join`) |
| `ownership_transferred`  | Group ownership transfer completes           |

## Frontend integration

- Use `NotificationPanel` (header bell icon) or `useNotifications(enabled)` for custom UIs.
- Subscribe to WebSocket event `notification` via `useWebSocketContext().on("notification", handler)`.
- Call `PATCH /api/notifications/:id/read` when the user opens a notification.

## Database migration

Apply `scripts/016_notifications.sql` before using these endpoints in production.
