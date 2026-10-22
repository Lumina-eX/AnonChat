# Group Join Requests

Join requests let users ask to join a **private** group. Group owners and moderators review each request, approve or reject it, and the requester is notified. Every step is recorded in an audit trail.

## Setup

Apply the migration in the Supabase SQL Editor before using the endpoints:

```
scripts/0NN_group_join_requests.sql
```

It creates:

| Object | Purpose |
| --- | --- |
| `group_join_requests` | Request, status, reviewer and timestamps |
| `group_join_request_events` | Audit log of every lifecycle event |
| `join_request_notifications` | Status-change notifications for requesters |
| `create_join_request()` | Creates a request (validates, audits) |
| `review_join_request()` | Approves or rejects a request atomically |
| `is_group_reviewer()` | Checks whether a user is an owner or moderator |

The functions are executable by the `service_role` only, so all access goes through the API.

## Statuses

| Status | Meaning |
| --- | --- |
| `pending` | Waiting for review |
| `approved` | Accepted; the requester was added as a member |
| `rejected` | Declined; no membership or access was granted |
| `cancelled` | Reserved in the schema; no cancel endpoint yet |

A user can have at most **one pending request per group** (enforced by a partial unique index).

## Endpoints

All endpoints require an authenticated user.

### Submit a request

```
POST /api/groups/:groupId/join-requests
```

Body (optional):

```json
{ "message": "Hi, I'd like to join." }
```

`message` is limited to 500 characters.

Response `201`:

```json
{ "request": { "id": "…", "room_id": "…", "requester_id": "…", "status": "pending" } }
```

Rules:

- The group must be private (`group_not_private` otherwise).
- Existing members cannot request (`already_member`).
- A second pending request for the same group is rejected (`duplicate_pending_request`).

### List requests (owners and moderators)

```
GET /api/groups/:groupId/join-requests?status=pending
```

`status` is one of `pending` (default), `approved`, `rejected`, `cancelled`. Results are ordered oldest first, up to 200 rows.

Response `200`:

```json
{ "requests": [ { "id": "…", "requester_id": "…", "status": "pending", "created_at": "…" } ] }
```

Non-reviewers receive `403`.

### Get one request

```
GET /api/join-requests/:requestId
```

Visible to the requester and to the group's owners and moderators. Anyone else receives `404`, so the existence of a request is not leaked.

### Approve

```
POST /api/join-requests/:requestId/approve
```

### Reject

```
POST /api/join-requests/:requestId/reject
```

Both return `200` with the updated request:

```json
{ "request": { "id": "…", "status": "approved", "reviewed_by": "…", "reviewed_at": "…" } }
```

Only owners and moderators of the group can review.

## What approval does

Approval runs as a single database transaction:

1. Locks the request row (`FOR UPDATE`).
2. Checks that the reviewer is an owner or moderator.
3. Checks that the request is still `pending`.
4. Creates the group membership (approval only).
5. Sets the status, `reviewed_by` and `reviewed_at`.
6. Writes an audit event and a notification for the requester.

If any step fails, everything is rolled back. Because of the row lock, two concurrent approvals cannot create duplicate memberships: the second one fails with `already_reviewed`.

Rejection runs steps 1 to 3 and 5 to 6. It never creates a membership, so a rejected user gets no access to the group or its messages.

## Errors

Errors return JSON in the form `{ "error": "<key>" }`.

| HTTP | Key | When |
| --- | --- | --- |
| 400 | `invalid_group_id`, `invalid_request_id` | Malformed UUID in the URL |
| 400 | `invalid_status` | Unknown `status` filter |
| 400 | `group_not_private` | Requesting to join a non-private group |
| 400 | `invalid_decision` | Unknown review decision |
| 401 | `unauthorized` | Not signed in |
| 403 | `forbidden` | Caller is not an owner or moderator of the group |
| 404 | `not_found` | Request or group does not exist (or is not visible to the caller) |
| 409 | `duplicate_pending_request` | The user already has a pending request for this group |
| 409 | `already_member` | The user is already a member |
| 409 | `already_reviewed` | The request was already approved, rejected or cancelled |
| 500 | `internal_error` | Unexpected server error |

## Audit trail

`group_join_request_events` records one row per lifecycle event:

| Column | Description |
| --- | --- |
| `request_id` | The request |
| `room_id` | The group |
| `actor_id` | Requester (for `created`) or reviewer (for `approved`/`rejected`) |
| `event` | `created`, `approved`, `rejected` or `cancelled` |
| `created_at` | When it happened |

Example query:

```sql
select event, actor_id, created_at
from group_join_request_events
where request_id = '<request_id>'
order by created_at;
```

## Notifications

When a request is approved or rejected, a row is inserted into `join_request_notifications` for the requester, with the new `status`. Clients can read their own rows (row-level security allows `user_id = auth.uid()`) or subscribe to the table with Supabase Realtime to show the update immediately.

## Testing

```bash
pnpm test
```

The route tests cover request creation, duplicate and existing-member prevention, approval, rejection, unauthorized review attempts, concurrent approvals and invalid IDs. Database behavior (row locking, rollback, audit events, notifications) can be checked in the Supabase SQL Editor by calling `review_join_request()` twice for the same request: the second call must fail with `already_reviewed`.