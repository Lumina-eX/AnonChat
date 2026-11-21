# Ephemeral Messages Cleanup Job - Implementation Guide

## Overview

This implementation provides a background process to automatically delete ephemeral messages after a configurable time-to-live (TTL). It ensures privacy and reduces unnecessary storage usage in the AnonChat platform.

## Architecture

### Components

1. **Database Schema** (`scripts/014_add_ephemeral_messages.sql`)
   - `messages.is_ephemeral`: Boolean flag for ephemeral messages
   - `messages.expires_at`: Timestamp when message should expire
   - `ephemeral_message_config`: Per-room TTL configuration
   - `global_ephemeral_config`: System-wide default TTL
   - `ephemeral_message_cleanup_logs`: Audit trail of deleted messages

2. **Configuration** (`lib/ephemeral-config.ts`)
   - Constants for min/max TTL, batch size, cleanup interval
   - TypeScript types for all ephemeral message structures

3. **Cleanup Service** (`lib/ephemeral-cleanup.ts`)
   - `cleanupExpiredMessages()`: Main cleanup job
   - `getRoomTTL()`: Get effective TTL for a room
   - `getGlobalTTL()`: Get system-wide TTL
   - `invalidateRoomMessageCache()`: Clear related caches
   - `getCleanupLogs()`: Fetch audit logs
   - `getCleanupStats()`: Get statistics

4. **API Endpoints**
   - `POST /api/ephemeral/config`: Create/update TTL configuration
   - `GET /api/ephemeral/config`: Retrieve configuration
   - `POST /api/ephemeral/cleanup`: Manually trigger cleanup
   - `GET /api/ephemeral/cleanup`: Get stats and logs
   - `GET /api/ephemeral/cron`: Vercel cron endpoint

5. **Background Jobs**
   - Vercel Cron (`app/api/ephemeral/cron/route.ts`)
   - Node.js Cron Worker (`scripts/ephemeral-cleanup-worker.js`)

## Configuration

### Default Settings

- **Default TTL**: 24 hours (86,400 seconds)
- **Minimum TTL**: 5 minutes (300 seconds)
- **Maximum TTL**: 30 days (2,592,000 seconds)
- **Cleanup Interval**: Every 5 minutes
- **Batch Size**: 100 messages per cleanup cycle
- **Log Retention**: 90 days

### Environment Variables

```bash
# For cleanup authorization
EPHEMERAL_CLEANUP_SECRET=your-secret-key

# For Vercel cron
VERCEL_CRON_SECRET=your-vercel-cron-secret

# For custom cleanup interval (minutes)
CLEANUP_INTERVAL=5
```

### Database Setup

1. Run the migration to create tables and indexes:
```bash
# Using Supabase CLI
supabase db push

# Or manually via Supabase dashboard SQL editor
# Copy contents of scripts/014_add_ephemeral_messages.sql
```

## Usage

### Creating Ephemeral Messages

```javascript
// Send ephemeral message from client
const response = await fetch('/api/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    room_id: 'room_123',
    content: 'This message will expire',
    is_ephemeral: true  // Mark as ephemeral
  })
});
```

### Configuring TTL

#### Global Configuration (System-wide)
```bash
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "is_global": true,
    "ttl_seconds": 43200
  }'
```

#### Room-Specific Configuration
```bash
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "room_id": "room_123",
    "ttl_seconds": 3600,
    "enabled": true
  }'
```

#### Get Configuration
```bash
# Get all configs
curl http://localhost:3000/api/ephemeral/config

# Get specific room config
curl "http://localhost:3000/api/ephemeral/config?room_id=room_123"

# Get only global config
curl "http://localhost:3000/api/ephemeral/config?type=global"
```

### Running Cleanup

#### Option 1: Vercel Cron (Production)

Configure in `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/ephemeral/cron",
    "schedule": "0 */6 * * *"
  }]
}
```

Environment variable: `VERCEL_CRON_SECRET=your-secret`

#### Option 2: Node.js Worker (Development/Self-hosted)

```bash
# Start the cleanup worker
npm run cleanup:worker

# Or with custom interval
CLEANUP_INTERVAL=10 npm run cleanup:worker
```

#### Option 3: Manual Trigger

```bash
# Trigger cleanup manually
EPHEMERAL_CLEANUP_SECRET=your-secret npm run cleanup:trigger

# Or via API
curl -X POST http://localhost:3000/api/ephemeral/cleanup \
  -H "X-Cleanup-Secret: your-secret"
```

### Monitoring & Auditing

#### Get Cleanup Statistics
```bash
curl http://localhost:3000/api/ephemeral/cleanup
```

Response:
```json
{
  "stats": {
    "totalEphemeralMessages": 1500,
    "expiredMessages": 50,
    "deletedToday": 120,
    "deletedThisMonth": 2500
  }
}
```

#### Get Cleanup Logs
```bash
# All logs
curl "http://localhost:3000/api/ephemeral/cleanup?action=logs&limit=50"

# Logs for specific room
curl "http://localhost:3000/api/ephemeral/cleanup?action=logs&room_id=room_123&limit=50"
```

## Testing

### Step-by-Step Testing Process

#### 1. Database Migration
```bash
# Run the migration
supabase db push

# Verify tables created
supabase db inspect -- -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'ephemeral%'"
```

#### 2. Configuration API
```bash
# Test global config
curl http://localhost:3000/api/ephemeral/config

# Should return default configuration with 24h TTL
```

#### 3. Create Ephemeral Message
```bash
# Create a test ephemeral message
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "room_id": "test_room",
    "content": "Test ephemeral message",
    "is_ephemeral": true
  }'

# Verify message has expires_at set
```

#### 4. Test TTL Configuration
```bash
# Set room TTL to 30 seconds for testing
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "room_id": "test_room",
    "ttl_seconds": 30,
    "enabled": true
  }'
```

#### 5. Create Test Messages
```bash
# Create 5 test ephemeral messages
for i in {1..5}; do
  curl -X POST http://localhost:3000/api/messages \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d "{
      \"room_id\": \"test_room\",
      \"content\": \"Test message $i\",
      \"is_ephemeral\": true
    }"
done
```

#### 6. Verify Cleanup Job
```bash
# Get initial stats
curl http://localhost:3000/api/ephemeral/cleanup

# Wait 35 seconds (5 seconds past TTL)
sleep 35

# Trigger cleanup
EPHEMERAL_CLEANUP_SECRET=test-secret npm run cleanup:trigger

# Get stats again - should show deleted messages
curl http://localhost:3000/api/ephemeral/cleanup

# Check cleanup logs
curl "http://localhost:3000/api/ephemeral/cleanup?action=logs&limit=10&room_id=test_room"
```

#### 7. Test Edge Cases
```bash
# Try creating message in non-existent room
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "room_id": "nonexistent_room",
    "content": "Test",
    "is_ephemeral": true
  }'

# Test with very short TTL (5 minutes minimum)
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "room_id": "test_room",
    "ttl_seconds": 300,
    "enabled": true
  }'

# Test with invalid TTL (should fail)
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "room_id": "test_room",
    "ttl_seconds": 60,
    "enabled": true
  }'  # Should return 400 error
```

#### 8. Test Non-Ephemeral Messages
```bash
# Create normal message (not ephemeral)
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "room_id": "test_room",
    "content": "Regular message",
    "is_ephemeral": false
  }'

# After cleanup, this message should still exist
# Verify by fetching messages
curl "http://localhost:3000/api/messages?room_id=test_room"
```

#### 9. Test Cache Invalidation
```bash
# This is implicit in the cleanup process
# Verify by checking Redis doesn't have stale room data
# (Implementation detail - Redis cache cleared on cleanup)
```

#### 10. Test Batch Deletion
```bash
# Create 150+ ephemeral messages
for i in {1..200}; do
  curl -X POST http://localhost:3000/api/messages \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d "{
      \"room_id\": \"test_batch_room\",
      \"content\": \"Batch message $i\",
      \"is_ephemeral\": true
    }" &
done
wait

# Verify cleanup handles batch deletion (max 100 per cycle)
EPHEMERAL_CLEANUP_SECRET=test-secret npm run cleanup:trigger

# Should delete in batches
```

### Automated Test Script

```bash
# Run the test script
npm run test:ephemeral

# This will:
# 1. Fetch global config
# 2. Fetch cleanup statistics
# 3. Fetch cleanup logs
# 4. Trigger cleanup (if secret is set)
```

## Logging

The cleanup job logs important events:

```
[INFO] Starting ephemeral message cleanup job
[INFO] Found 50 expired ephemeral messages
[INFO] Deleted 30 ephemeral messages from room room_123
[INFO] Cleaned up old ephemeral message cleanup logs
[INFO] Ephemeral message cleanup job completed { totalDeleted: 30, ... }
```

Check logs in your application's logging service (e.g., Vercel Logs, CloudWatch).

## Performance Considerations

1. **Batch Processing**: Messages are deleted in batches of 100 to prevent large transactions
2. **Indexes**: Composite indexes on (room_id, expires_at) optimize queries
3. **Cache Invalidation**: Room message caches are cleared after cleanup
4. **Log Retention**: Cleanup logs are automatically pruned after 90 days

## Security

- **Authentication**: Room-specific config requires room creator auth
- **Rate Limiting**: Message creation respects existing rate limits
- **Audit Trail**: All deletions are logged with timestamp and reason
- **Data Isolation**: Only expired ephemeral messages are affected

## Troubleshooting

### Messages Not Expiring

1. Check if ephemeral config is enabled for the room
2. Verify cleanup job is running (check Vercel logs or worker status)
3. Check the `EPHEMERAL_CLEANUP_SECRET` matches between trigger and cleanup job
4. Query database: `SELECT * FROM messages WHERE expires_at < NOW() AND is_ephemeral = true`

### High CPU Usage

1. Reduce cleanup frequency by adjusting `CLEANUP_INTERVAL`
2. Reduce batch size in `EPHEMERAL_CONFIG.BATCH_SIZE`
3. Add indexes if not present

### Missing Cleanup Logs

1. Ensure `ephemeral_message_cleanup_logs` table exists
2. Logs are retained for 90 days - older logs are auto-deleted
3. Check app permissions to write to logs table

## Future Enhancements

- [ ] Encrypted ephemeral message support
- [ ] Per-user ephemeral settings
- [ ] Expiry notification (count-down visible to users)
- [ ] Admin dashboard for ephemeral config
- [ ] Metrics/analytics on ephemeral message usage
- [ ] Integration with file uploads (auto-delete after TTL)

## References

- Acceptance Criteria met:
  - ✅ Configurable TTL (default 24h, adjustable per group or system-wide)
  - ✅ Scheduled cleanup job (cron or task scheduler)
  - ✅ Messages securely removed from DB
  - ✅ Cleanup doesn't affect non-ephemeral messages
  - ✅ Clear logging of deleted message IDs
  - ✅ Graceful handling of edge cases

