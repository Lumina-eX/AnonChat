# Technical Implementation & Architecture: Group Member Pagination API (#245)

## 1. Overview & Objective

The **Group Member Pagination API** replaces unpaginated bulk member retrieval with a scalable, secure pagination system.

In previous versions, `GET /api/rooms/[roomId]/members` retrieved all members at once without query limits, sorting, or pagination metadata. For large groups, this caused performance degradation and unnecessary network payload overhead. Furthermore, proper membership access verification was missing from member listing.

This implementation provides:
1. **Dual Pagination Support**: Both offset/page-based (`limit`, `offset`, `page`) and cursor-based (`cursor`) pagination.
2. **Multi-Field Sorting**: Configurable sorting by join date (`joinDate` / `joined_at`), role hierarchy (`role`), or member display name (`username` / `display_name`) in ascending or descending order.
3. **Strict Access Control**: Authorization enforcement ensuring only verified active room members, group creators/owners, or participants of public rooms can query membership lists.
4. **Rich Metadata**: Complete pagination envelopes including `totalCount`, `pageSize`, `page`, `totalPages`, `hasMore`, `nextCursor`, and `prevCursor`.
5. **UI Integration**: Enhanced `RoomMembersDialog` with pagination navigation, total member count indicators, sorting toggles, and role badges (`Owner`, `Mod`, `Member`).

---

## 2. Architecture & Data Flow

```mermaid
flowchart TD
    Client["Client / RoomMembersDialog"] -->|GET /api/rooms/[roomId]/members?page=1&limit=15&sortBy=joinDate| API["API Route Handler (GET)"]
    API -->|1. Session Authentication| Auth["Supabase Auth (getUser)"]
    Auth -->|Authenticated?| AuthCheck{Auth OK?}
    AuthCheck -->|No| Unauthorized["401 Unauthorized"]
    AuthCheck -->|Yes| AccessCheck["verifyGroupMemberAccess()"]
    AccessCheck -->|Active Member / Owner / Public?| PermCheck{Permitted?}
    PermCheck -->|No| Forbidden["403 Forbidden / 404 Not Found"]
    PermCheck -->|Yes| PaginationService["paginateGroupMembers()"]
    PaginationService -->|Fetch Members & Count| RoomMembersTable[("room_members (removed_at IS NULL)")]
    PaginationService -->|Batch Hydrate Profiles| ProfilesTable[("profiles")]
    PaginationService -->|Batch Hydrate Roles| GroupMembershipTable[("group_membership & rooms")]
    PaginationService -->|Deterministic Sort & Slice| Sorter["Sort & Cursor Engine"]
    Sorter -->|PaginatedGroupMembersResponse| API
    API -->|JSON 200| Client
```

---

## 3. Implementation Details & File Breakdown

### 3.1 Pagination & Access Control Service (`lib/groups/members-pagination.ts`)

- **`encodeCursor(sortValue, userId)`**: Base64url encodes `${sortValue}:::${userId}` into an opaque string token.
- **`decodeCursor(cursor)`**: Safely unpacks base64url cursor tokens, validating format and delimiter structure.
- **`verifyGroupMemberAccess(supabase, roomId, userId)`**:
  - Verifies room existence (`rooms` table). Returns `not_found` if missing.
  - Grants access if the caller is the room creator (`room.created_by === userId`).
  - Grants access if the room is public (`room.is_private === false`).
  - Grants access if the caller is an active member (`room_members` where `removed_at IS NULL`).
  - Fallback: checks caller's profile wallet against `group_membership`.
  - Rejects unauthorized callers with `{ authorized: false, reason: "unauthorized" }`.
- **`normalizeSortField(field)`**: Normalizes query aliases (`"joinDate"` -> `"joined_at"`, `"display_name"` -> `"username"`, etc.).
- **`sortAndPaginateMembers(members, params)`**:
  - Implements multi-field sorting:
    - `role`: Evaluates priority `owner (3) > moderator (2) > member (1)`.
    - `username`: Case-insensitive alphabetical sorting on display name.
    - `joined_at`: Chronological sorting on join timestamp.
  - Uses `user_id` as a deterministic secondary tie-breaker to prevent duplicate or missing records across page boundaries.
  - Slices array according to offset or cursor position, computes `hasMore`, and generates `nextCursor` / `prevCursor`.
- **`paginateGroupMembers(supabase, params)`**:
  - Clamps `limit` ($1 \le \text{limit} \le 100$, default 20).
  - Fetches room metadata, active memberships, profiles, and roles in batched indexed queries.
  - Returns a standardized `PaginatedGroupMembersResponse`.

### 3.2 API Route Layer (`app/api/rooms/[roomId]/members/route.ts`)

- **`GET /api/rooms/[roomId]/members`**:
  - Validates authentication session.
  - Invokes `verifyGroupMemberAccess` (returns 404 for deleted/non-existent groups, 403 for unauthorized users).
  - Parses pagination parameters (`limit`, `offset`, `page`, `cursor`, `sortBy`, `sortOrder`).
  - Returns HTTP 200 with `{ members, totalCount, pageSize, page, totalPages, hasMore, nextCursor, prevCursor }`.

### 3.3 UI Dialog Component (`components/room-members-dialog.tsx`)

- **Total Count Display**: Shows real-time member count in header (`Room Members (N)`).
- **Pagination Navigation**: Previous/Next page buttons with disabled states and page indicator (`Page X of Y`).
- **Interactive Sorting**: Quick sort toggle by Join Date, Role, or Name with ascending/descending indicators.
- **Role Badges**: Visual badges for `Owner` (gold crown) and `Mod` (blue shield).
- **Vote Removal & Presence**: Seamlessly preserves existing live presence indicators and democratic removal voting.

---

## 4. Complexity & Performance Analysis

### Time Complexity
- **Database Index Lookups**:
  - `room_members` query uses indexed lookup on `(room_id, removed_at)` $\to O(\log N + M)$, where $N$ is total table rows and $M$ is active members in the room.
  - Batched profile and role lookups use `IN (...)` on primary/indexed keys $\to O(K)$, where $K$ is the page size ($K \le 100$).
- **In-Memory Sorting & Pagination**:
  - Sorting $M$ members takes $O(M \log M)$ time.
  - Slicing $K$ items and generating cursors takes $O(K)$ time.
- **Overall Time Complexity**: $O(M \log M)$ where $M$ is room membership size, bounded and optimized for rapid execution.

### Space Complexity
- **Memory Allocation**: $O(M)$ auxiliary space to hold member summaries and $O(K)$ for the paginated slice response.
- **Payload Size**: Reduced from $O(M)$ (all members) to $O(K)$ (strictly $K$ members per page).

---

## 5. Edge Cases & Resilience

| Edge Case | Handling Strategy |
| :--- | :--- |
| **Empty Group** | Returns HTTP 200 with `members: []`, `totalCount: 0`, `totalPages: 0`, `hasMore: false`. |
| **Deleted / Non-Existent Group** | `verifyGroupMemberAccess` detects missing room row and returns HTTP 404 `{ error: "Room not found" }`. |
| **Unauthorized Non-Member** | Returns HTTP 403 `{ error: "Unauthorized: You are not a member of this group" }`. |
| **Corrupted / Invalid Cursor** | `decodeCursor` falls back safely to beginning of list ($offset = 0$). |
| **Out-of-Bounds Page / Offset** | Returns `members: []` with `hasMore: false` and valid page metadata without throwing exceptions. |
| **Duplicate Prevention** | Deterministic secondary sort on unique `user_id` guarantees strictly unique members between consecutive pages. |

---

## 6. Automated Testing & Verification

The test suite covers:
- Cursor encoding and decoding format validation.
- Sorting by join date, role priority, and username.
- Duplicate prevention across page boundaries.
- Cursor progression across consecutive pages.
- Empty room and edge-case handling.

### Running the Test Suite
```bash
npm run test:group-pagination
```
