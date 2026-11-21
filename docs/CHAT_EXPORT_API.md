# Chat Export API

The Chat Export API allows users to securely and efficiently export their group chat history in either structured JSON format or plain text format.

---

## Endpoint Details

- **Path**: `/api/groups/[id]/export`
- **Method**: `GET`
- **Authentication**: Requires a valid Supabase user session.
- **Authorization**: User must be an active member of the specified group (not removed).

---

## Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format`  | `string` | No | Export format. Options: `json` (default) or `txt`. |

---

## Response Headers

To facilitate proper downloading and support infinite scalability, responses are streamed directly from the database using standard HTTP Chunked Transfer Encoding.

- `Content-Type`: `application/json` (for JSON) or `text/plain` (for TXT)
- `Content-Disposition`: `attachment; filename="[group-name]-export.[format]"`
- `Transfer-Encoding`: `chunked`

---

## Formats & Examples

### 1. JSON Export (`format=json` or default)

The output is streamed as a structured JSON Array.

**URL**: `/api/groups/room-1/export?format=json`

**Response Body**:
```json
[
  {
    "id": "msg-1",
    "content": "Hello world",
    "created_at": "2026-07-27T10:00:00.000Z",
    "sender": "Alice",
    "is_encrypted": false,
    "edited_at": null
  },
  {
    "id": "msg-2",
    "content": "Hi Alice!",
    "created_at": "2026-07-27T10:01:00.000Z",
    "sender": "Bob",
    "is_encrypted": false,
    "edited_at": null
  }
]
```

### 2. Plain Text Export (`format=txt`)

The output is streamed as a chronological text file with one message per line.

**URL**: `/api/groups/room-1/export?format=txt`

**Response Body**:
```text
[2026-07-27 10:00:00] Alice: Hello world
[2026-07-27 10:01:00] Bob: Hi Alice!
```

---

## Technical Design & Performance

### Streaming and Chunking
Rather than fetching all messages into server memory (which fails for groups with tens of thousands of messages), the export endpoint queries messages in sorted batches of **1,000** and writes them directly to the `ReadableStream` connection. This allows:
- Constant memory consumption on the server.
- Immediate byte transmission to the client, improving time-to-first-byte (TTFB).
- Clean handling of extremely large chat histories.

### Authorization Checks
1. Fetches current session user. If no session is present, returns `401 Unauthorized`.
2. Resolves group membership from `room_members` table. If the user is not found or has a non-null `removed_at` timestamp, returns `403 Forbidden`.
