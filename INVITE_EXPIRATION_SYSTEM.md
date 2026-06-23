# Invite Code Expiration System (#185)

This document describes the implementation of the invite code expiration system for AnonChat, including time-based and usage-based expiration, audit logging, and cleanup utilities.

## Overview

The invite code expiration system provides:

- **Time-based expiration**: Invites can expire after a specified duration
- **Usage-based expiration**: Invites can expire after reaching a maximum usage limit
- **Audit logging**: All expiration events are logged for compliance and monitoring
- **Automatic cleanup**: Periodic cleanup of expired invites with full audit trail
- **Manual invalidation**: Group owners can manually invalidate invite codes
- **Comprehensive status checking**: Check expiration status in real-time

## Database Schema

### Tables

#### `invites` (existing, already had expiration support)
- `expires_at` (timestamp) - Time-based expiration deadline
- `max_uses` (integer) - Maximum usage limit
- `use_count` (integer) - Current usage count

#### `invite_expiration_logs` (new)
Tracks all expiration events for audit purposes:
- `id` (uuid) - Log entry ID
- `invite_code` (text) - Reference to the invite code
- `room_id` (text) - Reference to the room
- `expiration_type` (text) - Type: `time_expired`, `usage_limit_reached`, `manually_invalidated`
- `metadata` (jsonb) - Additional context (reason, times, counts, etc.)
- `created_at` (timestamp) - When the expiration was logged
- `expired_at` (timestamp) - When the expiration occurred

### Indexes
- `invites_expires_at_idx` - Optimized for time-based expiration queries
- `invites_max_uses_idx` - Optimized for usage-based expiration queries
- `invite_expiration_logs_*_idx` - Various indexes for audit trail queries

## SQL Functions

### Validation Functions

#### `is_invite_time_expired(expires_at timestamp)`
Returns true if the current time exceeds the expiration deadline.

```sql
select public.is_invite_time_expired(invite.expires_at);
```

#### `is_invite_usage_expired(max_uses integer, use_count integer)`
Returns true if usage has reached the maximum limit.

```sql
select public.is_invite_usage_expired(invite.max_uses, invite.use_count);
```

#### `is_invite_expired(expires_at, max_uses, use_count)`
Returns true if the invite is expired by either time or usage.

```sql
select public.is_invite_expired(invite.expires_at, invite.max_uses, invite.use_count);
```

### Utility Functions

#### `log_invite_expiration(code, room_id, expiration_type, metadata)`
Creates an audit log entry for an expired invite.

```sql
select public.log_invite_expiration(
  'invite-code-123',
  'room-456',
  'time_expired',
  '{"expires_at": "2026-06-23T12:00:00Z", "cleanup_at": "2026-06-23T13:00:00Z"}'::jsonb
);
```

#### `cleanup_expired_invites(room_id, dry_run)`
Identifies and logs all expired invites (both time-based and usage-based).

**Parameters:**
- `room_id` (text, optional) - Limit to specific room
- `dry_run` (boolean, default false) - If true, don't create logs

**Returns:**
```
(cleaned_count, time_expired_count, usage_expired_count, details)
```

**Example:**
```sql
-- Real cleanup
select * from public.cleanup_expired_invites(null, false);

-- Dry run for specific room
select * from public.cleanup_expired_invites('room-123', true);
```

#### `invalidate_invite(code, reason)`
Manually invalidates an invite code with a reason.

```sql
select public.invalidate_invite('invite-code-123', 'Compromised security');
```

#### `get_invite_status(code)`
Retrieves comprehensive status information for an invite.

**Returns:**
- `is_expired` - Overall expiration status
- `is_time_expired` - Whether time-based expiration has occurred
- `is_usage_expired` - Whether usage limit has been reached
- `time_remaining` - Interval until expiration (null if no time-based expiration)
- `uses_remaining` - Uses left before expiration (null if no usage limit)
- Plus metadata fields: `created_at`, `expires_at`, `max_uses`, `use_count`

```sql
select * from public.get_invite_status('invite-code-123');
```

## API Endpoints

### Create Invite with Expiration

**POST** `/api/groups/[id]/invite`

Request body:
```json
{
  "expires_in": 3600,    // seconds until expiration (optional)
  "max_uses": 5          // max usage limit (optional)
}
```

Response:
```json
{
  "success": true,
  "invite": {
    "code": "invite-code-123",
    "group_id": "room-456",
    "created_at": "2026-06-23T12:00:00Z",
    "expires_at": "2026-06-23T13:00:00Z",
    "max_uses": 5
  }
}
```

### Check Invite Status

**GET** `/api/groups/invites/status?code=invite-code-123`

Response:
```json
{
  "success": true,
  "status": {
    "code": "invite-code-123",
    "is_expired": false,
    "is_time_expired": false,
    "is_usage_expired": false,
    "time_remaining": "00:30:00",
    "uses_remaining": 3,
    "expires_at": "2026-06-23T13:00:00Z",
    "max_uses": 5,
    "use_count": 2
  }
}
```

### Join Group with Invite

**POST** `/api/groups/join`

Request body:
```json
{
  "code": "invite-code-123"
}
```

Enhanced to handle expiration scenarios:
- Returns 410 Gone for expired codes
- Logs audit events for expiration attempts
- Distinguishes between `invite_expired` and `invite_limit_reached`

### Manually Invalidate Invite

**POST** `/api/groups/[id]/invites/invalidate`

Request body:
```json
{
  "invite_code": "invite-code-123",
  "reason": "Security concern - code leaked"
}
```

Response:
```json
{
  "success": true,
  "message": "Invite code has been invalidated",
  "invite": {
    "code": "invite-code-123",
    "group_id": "room-456",
    "invalidated_at": "2026-06-23T12:30:00Z",
    "reason": "Security concern - code leaked"
  }
}
```

### Clean Up Expired Invites

**POST** `/api/groups/invites/cleanup`

Request body:
```json
{
  "room_id": "room-456",  // optional
  "dry_run": false        // optional
}
```

Response:
```json
{
  "success": true,
  "cleanup": {
    "cleaned_count": 12,
    "time_expired_count": 8,
    "usage_expired_count": 4,
    "details": "Cleaned 12 expired invites (8 time-based, 4 usage-based)",
    "dry_run": false
  }
}
```

### Get Expiration Logs

**GET** `/api/groups/invites/cleanup?room_id=room-456&limit=50`

Response:
```json
{
  "success": true,
  "logs": [
    {
      "id": "log-uuid-1",
      "invite_code": "invite-code-123",
      "room_id": "room-456",
      "expiration_type": "time_expired",
      "created_at": "2026-06-23T13:00:00Z",
      "metadata": {
        "expires_at": "2026-06-23T13:00:00Z",
        "cleanup_at": "2026-06-23T13:05:00Z"
      }
    }
  ],
  "count": 1
}
```

### Scheduled Cleanup Cron

**GET** `/api/cron/cleanup-expired-invites`

Query parameters:
- `room_id` - (optional) Limit to specific room
- `dry_run` - (optional) Count without logging

Authorization:
- Vercel Cron (checks `x-vercel-cron` header)
- Custom bearer token (checks `CLEANUP_SECRET` env var)

Response:
```json
{
  "success": true,
  "message": "Cleanup completed successfully",
  "results": {
    "cleaned_count": 12,
    "time_expired_count": 8,
    "usage_expired_count": 4,
    "details": "Cleaned 12 expired invites (8 time-based, 4 usage-based)",
    "dry_run": false
  }
}
```

## Audit Logging

### Audit Event Types

Two new audit event types for the blockchain audit trail:

- `invite_expired` - Logged when a time-based expiration occurs
- `invite_limit_reached` - Logged when a usage limit is reached

### Audit Event Example

When a user attempts to join with an expired invite:

```json
{
  "event_type": "invite_expired",
  "group_id": "room-456",
  "actor_user_id": "user-uuid",
  "metadata": {
    "invite_code": "invite-code-123",
    "reason": "time_expired",
    "expires_at": "2026-06-23T13:00:00Z",
    "user_attempted_join": "user-uuid"
  }
}
```

## Usage Examples

### Creating an invite that expires in 1 hour with a 10-use limit

```bash
curl -X POST http://localhost:3000/api/groups/room-123/invite \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "expires_in": 3600,
    "max_uses": 10
  }'
```

### Checking if an invite is still valid

```bash
curl -X GET "http://localhost:3000/api/groups/invites/status?code=invite-code-123" \
  -H "Authorization: Bearer $TOKEN"
```

### Cleaning up all expired invites (dry run)

```bash
curl -X POST http://localhost:3000/api/groups/invites/cleanup \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "room_id": null,
    "dry_run": true
  }'
```

### Permanently invalidating a compromised invite

```bash
curl -X POST http://localhost:3000/api/groups/room-123/invites/invalidate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "invite_code": "invite-code-123",
    "reason": "Code leaked in public channel"
  }'
```

### Running scheduled cleanup via Vercel Cron

Add to `vercel.json`:

```json
{
  "crons": [{
    "path": "/api/cron/cleanup-expired-invites",
    "schedule": "0 * * * *"
  }]
}
```

## Library Utilities

### `lib/groups/invite.ts`

Enhanced with new functions:

```typescript
// Get comprehensive expiration status
const status = await getInviteExpirationStatus(supabase, code);

// Log an expiration event
await logInviteExpiration(supabase, code, roomId, "time_expired", metadata);
```

### `lib/groups/invite-cleanup.ts` (new)

Cleanup utilities:

```typescript
import { cleanupExpiredInvites, getExpirationLogs } from '@/lib/groups/invite-cleanup';

// Run cleanup
const result = await cleanupExpiredInvites(roomId, dryRun);

// Get logs
const logs = await getExpirationLogs(roomId, limit);
```

## Error Handling

### HTTP Status Codes

- `400 Bad Request` - Invalid invite code or parameters
- `401 Unauthorized` - Missing authentication
- `403 Forbidden` - User lacks permission
- `404 Not Found` - Invite or room not found
- `410 Gone` - Invite has expired or reached usage limit
- `500 Internal Server Error` - Database or processing error

### Error Messages

- "Invite code is required" - No code provided
- "Invalid invite code" - Code not found (404)
- "Invite code has expired" - Time-based expiration (410)
- "Invite code has reached its usage limit" - Usage limit exceeded (410)
- "Only group members can generate invite codes" - Permission denied (403)
- "max_uses must be a positive integer" - Invalid parameter (400)
- "expires_in must be a positive integer (seconds)" - Invalid parameter (400)

## Security Considerations

1. **Time-zone Handling**: All expiration times use UTC for consistency
2. **Atomic Operations**: Increment and expiration checks are atomic to prevent race conditions
3. **RLS Policies**: Invite expiration logs are only visible to group members and creators
4. **Audit Trail**: All expiration events are recorded for compliance
5. **Rate Limiting**: Cleanup operations are designed to be efficient
6. **Cron Authentication**: Scheduled cleanup requires authentication

## Performance Optimization

1. **Indexes**: Dedicated indexes on `expires_at`, `max_uses`, and `created_by` for fast lookups
2. **Query Optimization**: Cleanup function efficiently identifies both time and usage-based expirations
3. **Batch Operations**: Cleanup processes multiple invites in a single query
4. **Conditional Indexing**: Indexes only on non-null columns where applicable

## Migration Instructions

Run the migration script `015_invite_expiration_system.sql`:

```bash
psql "$DATABASE_URL" -f scripts/015_invite_expiration_system.sql
```

This will:
1. Create the `invite_expiration_logs` table
2. Add all necessary indexes
3. Create all helper functions and cleanup utilities
4. Set up proper RLS policies

## Monitoring and Maintenance

### Check for expired invites (dry run)

```sql
select * from public.cleanup_expired_invites(null, true);
```

### View recent expiration events

```sql
select * from public.invite_expiration_logs
order by created_at desc
limit 50;
```

### Get expiration statistics by type

```sql
select 
  expiration_type,
  count(*) as count,
  max(created_at) as most_recent
from public.invite_expiration_logs
group by expiration_type
order by count desc;
```

## Future Enhancements

- Email notifications when invites are about to expire
- Configurable cleanup retention period
- Bulk invite creation with different expiration rules
- Dashboard visualization of invite usage and expiration trends
- Invite analytics and reporting
