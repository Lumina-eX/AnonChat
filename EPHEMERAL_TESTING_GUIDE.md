# Ephemeral Messages Cleanup - Comprehensive Testing Guide

## Pre-requisites
- [ ] Supabase project set up
- [ ] Environment variables configured:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `EPHEMERAL_CLEANUP_SECRET` (for manual testing)
  - `VERCEL_CRON_SECRET` (for production)
- [ ] Dependencies installed: `npm install`
- [ ] Database migration applied: `supabase db push`

## Test Suite 1: Database Schema Verification

### Test 1.1: Verify Ephemeral Message Columns
**Objective**: Confirm messages table has ephemeral support columns
**Steps**:
1. Connect to Supabase database
2. Query: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='messages'`
3. Verify columns exist: `is_ephemeral` (boolean), `expires_at` (timestamp)

**Expected Result**: ✅ Both columns present with correct types

---

### Test 1.2: Verify Configuration Tables
**Objective**: Confirm all ephemeral config tables exist
**Steps**:
1. Query: `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'ephemeral%' OR tablename = 'global_ephemeral_config'`

**Expected Tables**:
- `ephemeral_message_config`
- `global_ephemeral_config`
- `ephemeral_message_cleanup_logs`

**Expected Result**: ✅ All three tables exist

---

### Test 1.3: Verify Indexes
**Objective**: Confirm performance indexes are created
**Steps**:
1. Query: `SELECT indexname FROM pg_indexes WHERE tablename='messages' OR tablename='ephemeral_message_cleanup_logs'`

**Expected Indexes**:
- `messages_expires_at_idx`
- `messages_room_expires_at_idx`
- `ephemeral_cleanup_logs_deleted_at_idx`
- `ephemeral_cleanup_logs_room_id_idx`

**Expected Result**: ✅ All indexes present

---

## Test Suite 2: Configuration API

### Test 2.1: Get Global Configuration
**Objective**: Retrieve system-wide TTL config
```bash
curl http://localhost:3000/api/ephemeral/config
```
**Expected Response**:
```json
{
  "global": {
    "id": "...",
    "ttl_seconds": 86400,
    "updated_at": "...",
    "updated_by": null
  },
  "constants": {
    "DEFAULT_TTL_SECONDS": 86400,
    "MIN_TTL_SECONDS": 300,
    "MAX_TTL_SECONDS": 2592000
  }
}
```
**Expected Result**: ✅ Returns default 24-hour TTL

---

### Test 2.2: Get Room-Specific Configuration (Non-existent)
**Objective**: Verify graceful handling of rooms without config
```bash
curl "http://localhost:3000/api/ephemeral/config?room_id=nonexistent_room"
```
**Expected Response**:
```json
{
  "room": null,
  "global": {...}
}
```
**Expected Result**: ✅ Returns null for room, falls back to global

---

### Test 2.3: Create Room Configuration
**Objective**: Set custom TTL for a room
```bash
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "room_id": "test_room_123",
    "ttl_seconds": 3600,
    "enabled": true
  }'
```
**Expected Response**:
```json
{
  "id": "...",
  "room_id": "test_room_123",
  "ttl_seconds": 3600,
  "enabled": true,
  "created_at": "...",
  "updated_at": "..."
}
```
**Expected Result**: ✅ Room config created with 1-hour TTL

---

### Test 2.4: Update Room Configuration
**Objective**: Modify existing room config
```bash
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "room_id": "test_room_123",
    "ttl_seconds": 7200,
    "enabled": true
  }'
```
**Expected Result**: ✅ Config updated to 2-hour TTL, `updated_at` changes

---

### Test 2.5: Update Global Configuration (Admin)
**Objective**: Change system-wide default
```bash
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "is_global": true,
    "ttl_seconds": 172800
  }'
```
**Expected Result**: ✅ Global TTL updated to 48 hours

---

### Test 2.6: Validate TTL Constraints (Too Low)
**Objective**: Reject TTL below minimum
```bash
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "room_id": "test_room",
    "ttl_seconds": 100
  }'
```
**Expected Response**: `400 Bad Request`
```json
{
  "error": "TTL must be between 300 and 2592000 seconds"
}
```
**Expected Result**: ✅ Request rejected

---

### Test 2.7: Validate TTL Constraints (Too High)
**Objective**: Reject TTL above maximum
```bash
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "room_id": "test_room",
    "ttl_seconds": 3000000
  }'
```
**Expected Result**: ✅ `400 Bad Request` - TTL exceeds maximum

---

## Test Suite 3: Message Creation

### Test 3.1: Create Regular Message
**Objective**: Verify normal messages are unaffected
```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "room_id": "test_room_123",
    "content": "Regular message",
    "is_ephemeral": false
  }'
```
**Expected Response**:
```json
{
  "message": {
    "id": "...",
    "user_id": "...",
    "room_id": "test_room_123",
    "content": "Regular message",
    "is_ephemeral": false,
    "expires_at": null,
    "status": "sent",
    "created_at": "..."
  },
  "success": true
}
```
**Expected Result**: ✅ Message created, `is_ephemeral=false`, `expires_at=null`

---

### Test 3.2: Create Ephemeral Message
**Objective**: Create message with TTL
```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "room_id": "test_room_123",
    "content": "Ephemeral message",
    "is_ephemeral": true
  }'
```
**Expected Response**:
```json
{
  "message": {
    "id": "...",
    "is_ephemeral": true,
    "expires_at": "2024-06-02T12:00:00Z",  // Now + TTL
    "status": "sent",
    "created_at": "2024-06-01T12:00:00Z"
  },
  "success": true
}
```
**Expected Result**: ✅ Message created, `is_ephemeral=true`, `expires_at` set to future timestamp

---

### Test 3.3: Ephemeral Message Respects Room TTL
**Objective**: Verify message uses room-specific TTL
**Steps**:
1. Set room TTL to 1800 seconds (30 minutes)
2. Create ephemeral message
3. Verify `expires_at = created_at + 1800 seconds`

**Expected Result**: ✅ Message expires at correct time

---

### Test 3.4: Ephemeral Message Falls Back to Global TTL
**Objective**: Use global TTL when no room config
**Steps**:
1. Create new room (no config)
2. Set global TTL to 43200 (12 hours)
3. Create ephemeral message in new room
4. Verify expiry = created_at + 43200

**Expected Result**: ✅ Uses global TTL

---

## Test Suite 4: Cleanup Job Execution

### Test 4.1: Manual Cleanup Trigger
**Objective**: Manually trigger cleanup via API
```bash
curl -X POST http://localhost:3000/api/ephemeral/cleanup \
  -H "X-Cleanup-Secret: test-secret"
```
**Expected Response**:
```json
{
  "success": true,
  "result": {
    "totalDeleted": 0,
    "deletedByRoom": {},
    "errors": [],
    "duration_ms": 125
  },
  "message": "Cleanup completed. 0 messages deleted."
}
```
**Expected Result**: ✅ Returns 200, completes quickly if no expired messages

---

### Test 4.2: Cleanup with Expired Messages
**Objective**: Delete expired messages
**Steps**:
1. Set room TTL to 10 seconds
2. Create 5 ephemeral messages
3. Wait 15 seconds
4. Trigger cleanup
5. Verify messages deleted

**Expected Result**: ✅ `totalDeleted: 5`, all messages removed from DB

---

### Test 4.3: Cleanup Authorization
**Objective**: Reject cleanup without valid secret
```bash
curl -X POST http://localhost:3000/api/ephemeral/cleanup \
  -H "X-Cleanup-Secret: wrong-secret"
```
**Expected Response**: `401 Unauthorized`
```json
{
  "error": "Unauthorized - invalid cleanup secret"
}
```
**Expected Result**: ✅ Request rejected

---

### Test 4.4: Batch Deletion
**Objective**: Handle cleanup of many messages efficiently
**Steps**:
1. Create 250 ephemeral messages in one room
2. Set TTL to 10 seconds
3. Wait 15 seconds
4. Trigger cleanup
5. Verify all deleted in batches

**Expected Result**: ✅ All 250 messages deleted (in batches of 100)

---

### Test 4.5: Multi-Room Cleanup
**Objective**: Clean up messages across multiple rooms
**Steps**:
1. Create messages in 5 different rooms
2. Set room-specific TTLs
3. Wait for expiry
4. Trigger cleanup
5. Verify deletedByRoom breakdown

**Expected Result**: ✅ `deletedByRoom` shows deletion per room

---

### Test 4.6: Idempotent Cleanup
**Objective**: Running cleanup multiple times is safe
**Steps**:
1. Create 10 ephemeral messages
2. Wait for expiry
3. Run cleanup twice
4. Verify count doesn't double

**Expected Result**: ✅ Second cleanup returns `totalDeleted: 0`

---

## Test Suite 5: Message Preservation

### Test 5.1: Regular Messages Not Deleted
**Objective**: Non-ephemeral messages survive cleanup
**Steps**:
1. Create 10 ephemeral messages (TTL: 10 seconds)
2. Create 10 regular messages
3. Wait 15 seconds
4. Trigger cleanup
5. Verify ephemeral deleted, regular remain

```bash
curl "http://localhost:3000/api/messages?room_id=test_room"
```

**Expected Result**: ✅ 10 regular messages still present

---

### Test 5.2: Future Expiry Messages Preserved
**Objective**: Messages with future expiry are kept
**Steps**:
1. Create ephemeral message with 24h TTL
2. Immediately trigger cleanup
3. Verify message still in DB

```bash
curl "http://localhost:3000/api/messages?room_id=test_room"
```

**Expected Result**: ✅ Message remains in database

---

## Test Suite 6: Audit Logging

### Test 6.1: Cleanup Logs Created
**Objective**: Verify deletion audit trail
**Steps**:
1. Create 5 ephemeral messages
2. Wait for expiry
3. Trigger cleanup
4. Fetch logs

```bash
curl "http://localhost:3000/api/ephemeral/cleanup?action=logs&limit=10"
```

**Expected Response**:
```json
{
  "logs": [
    {
      "id": "...",
      "deleted_message_id": "...",
      "room_id": "test_room",
      "deleted_at": "2024-06-01T...",
      "reason": "expired"
    },
    ...
  ]
}
```

**Expected Result**: ✅ 5 log entries created with reason "expired"

---

### Test 6.2: Room-Specific Logs
**Objective**: Filter logs by room
```bash
curl "http://localhost:3000/api/ephemeral/cleanup?action=logs&room_id=test_room&limit=50"
```

**Expected Result**: ✅ Returns only logs for specified room

---

### Test 6.3: Log Retention
**Objective**: Old logs are automatically deleted
**Steps**:
1. Manually insert cleanup log with `deleted_at = 100 days ago`
2. Trigger cleanup
3. Verify old log is gone

**Expected Result**: ✅ Logs older than 90 days removed

---

## Test Suite 7: Statistics & Monitoring

### Test 7.1: Get Cleanup Statistics
**Objective**: Monitor ephemeral message status
```bash
curl http://localhost:3000/api/ephemeral/cleanup
```

**Expected Response**:
```json
{
  "stats": {
    "totalEphemeralMessages": 50,
    "expiredMessages": 5,
    "deletedToday": 100,
    "deletedThisMonth": 2500
  }
}
```

**Expected Result**: ✅ Accurate counts returned

---

## Test Suite 8: Edge Cases & Error Handling

### Test 8.1: Cleanup with Database Error
**Objective**: Graceful error handling
**Steps**:
1. Simulate DB error (disconnect, permissions issue)
2. Trigger cleanup
3. Verify error logged but process continues

**Expected Result**: ✅ Error logged, cleanup returns error details

---

### Test 8.2: Missing Cleanup Logs Table
**Objective**: Handle missing audit table gracefully
**Expected Result**: ✅ Cleanup completes, logs warning

---

### Test 8.3: Rate Limiting on Ephemeral Messages
**Objective**: Ephemeral messages respect rate limits
**Steps**:
1. Create normal messages until rate limit hit
2. Try to create ephemeral message
3. Verify rate limit still enforced

**Expected Result**: ✅ `429 Too Many Requests`

---

### Test 8.4: Unauthorized Config Update
**Objective**: Only room creator can update config
```bash
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Authorization: Bearer $OTHER_USER_TOKEN" \
  -d '{"room_id": "someone_elses_room", "ttl_seconds": 100}'
```

**Expected Response**: `403 Forbidden`
**Expected Result**: ✅ Request rejected

---

## Test Suite 9: Performance Tests

### Test 9.1: Large Batch Cleanup
**Objective**: Handle 500+ message cleanup efficiently
**Steps**:
1. Create 500 ephemeral messages
2. Trigger cleanup
3. Measure duration

**Expected Result**: ✅ Completes in < 5 seconds

---

### Test 9.2: Index Performance
**Objective**: Expired message query uses indexes
**Steps**:
1. Create 1000 ephemeral messages
2. Run EXPLAIN PLAN on cleanup query
3. Verify index scan (not sequential)

**Expected Result**: ✅ Query uses indexes

---

## Test Suite 10: Integration Tests

### Test 10.1: End-to-End Workflow
**Objective**: Complete user journey
**Steps**:
1. Create room with custom TTL (1 hour)
2. Send ephemeral message
3. Retrieve messages (should show ephemeral)
4. Simulate time passage (mock if needed)
5. Trigger cleanup
6. Verify message deleted
7. Check audit log

**Expected Result**: ✅ All steps succeed

---

### Test 10.2: Concurrent Operations
**Objective**: Handle concurrent cleanup and message creation
**Steps**:
1. Start background job creating messages every 1 second
2. Trigger cleanup
3. Continue creating messages during cleanup
4. Verify consistency

**Expected Result**: ✅ No data corruption, all operations succeed

---

## Test Summary Checklist

- [ ] All 10 test suites executed
- [ ] Database schema verified
- [ ] Configuration API working
- [ ] Message creation with ephemeral flag
- [ ] Cleanup job functioning
- [ ] Messages properly deleted
- [ ] Audit logs created
- [ ] Statistics accurate
- [ ] Error handling robust
- [ ] Performance acceptable
- [ ] Authorization enforced
- [ ] Rate limiting respected
- [ ] Cache invalidation working
- [ ] Batch processing efficient
- [ ] Multi-room support verified

## Running All Tests

```bash
# Install dependencies
npm install

# Apply migrations
supabase db push

# Run built-in test script
npm run test:ephemeral

# Run manual test suite (10-15 minutes)
# Follow steps in Test Suite 1-10

# Monitor logs during execution
# tail -f /path/to/logs
```

## Success Criteria

✅ All tests pass  
✅ No data corruption  
✅ Proper authorization enforcement  
✅ Accurate audit trail  
✅ Graceful error handling  
✅ Performance within SLA  

