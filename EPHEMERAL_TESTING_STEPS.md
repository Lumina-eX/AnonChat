# Step-by-Step Testing Guide for Ephemeral Messages Implementation

## Overview
This guide provides a complete, step-by-step process to test and verify that the ephemeral messages cleanup job has been successfully implemented.

**Estimated time**: 30-45 minutes

---

## Prerequisites ✅

Before starting tests, ensure:

- [ ] Node.js >= 20.9.0 installed
- [ ] Access to Supabase project
- [ ] Git repository with latest changes
- [ ] Local development environment set up
- [ ] Auth token for API testing (from app login or test account)

```bash
# Verify prerequisites
node --version  # Should be >= 20.9.0
npm --version
git status
```

---

## Phase 1: Environment Setup (5 minutes)

### Step 1.1: Install Dependencies
```bash
cd /workspaces/AnonChat
npm install node-cron
```
**Expected**: ✅ node-cron added to node_modules

### Step 1.2: Set Environment Variables
Create or update `.env.local`:
```bash
cat > .env.local << 'EOF'
# Supabase
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-service-key

# Ephemeral cleanup
EPHEMERAL_CLEANUP_SECRET=test-secret-12345
CLEANUP_INTERVAL=5
EOF
```

### Step 1.3: Apply Database Migration
```bash
# Using Supabase CLI
supabase db push

# Or import SQL manually in Supabase Dashboard:
# SQL Editor → New Query → Paste scripts/014_add_ephemeral_messages.sql → Run
```
**Expected**: ✅ No errors, migration applied successfully

---

## Phase 2: Database Schema Verification (5 minutes)

### Step 2.1: Verify New Columns Added
```bash
# Connect to Supabase and run:
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name='messages' 
AND (column_name='is_ephemeral' OR column_name='expires_at')
ORDER BY column_name;
```
**Expected Output**:
```
column_name   | data_type
--------------+--------------------
expires_at    | timestamp with time zone
is_ephemeral  | boolean
```
**Status**: ✅ Pass if both columns present

---

### Step 2.2: Verify Configuration Tables Created
```sql
SELECT tablename FROM pg_tables 
WHERE schemaname='public' 
AND (tablename LIKE 'ephemeral%' OR tablename='global_ephemeral_config')
ORDER BY tablename;
```
**Expected Output**:
```
tablename
-------------------------------------
ephemeral_message_cleanup_logs
ephemeral_message_config
global_ephemeral_config
```
**Status**: ✅ Pass if all 3 tables exist

---

### Step 2.3: Verify Indexes Created
```sql
SELECT indexname, tablename 
FROM pg_indexes 
WHERE tablename IN ('messages', 'ephemeral_message_cleanup_logs')
AND schemaname='public'
ORDER BY tablename, indexname;
```
**Expected Indexes**:
- `messages`: `messages_expires_at_idx`, `messages_room_expires_at_idx`
- `ephemeral_message_cleanup_logs`: `ephemeral_cleanup_logs_deleted_at_idx`, `ephemeral_cleanup_logs_room_id_idx`

**Status**: ✅ Pass if all 4 indexes present

---

## Phase 3: API Configuration Testing (5 minutes)

### Step 3.1: Start Development Server
```bash
# Terminal 1
npm run dev

# Wait for: "ready - started server on 0.0.0.0:3000"
```

### Step 3.2: Test Global Configuration Retrieval
```bash
curl http://localhost:3000/api/ephemeral/config
```
**Expected Response**:
```json
{
  "global": {
    "ttl_seconds": 86400,
    "id": "...",
    "updated_at": "2024-06-01T..."
  },
  "constants": {
    "DEFAULT_TTL_SECONDS": 86400,
    "MIN_TTL_SECONDS": 300,
    "MAX_TTL_SECONDS": 2592000
  }
}
```
**Status**: ✅ Pass if returns 200 with default TTL of 86400 (24 hours)

---

### Step 3.3: Test Room Configuration Creation
```bash
# Get an auth token first (login to your app)
export AUTH_TOKEN="your-token-here"

# Create room config with 1-hour TTL
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "room_id": "test_room_123",
    "ttl_seconds": 3600,
    "enabled": true
  }'
```
**Expected Response**: ✅ 200 OK with created config object

---

### Step 3.4: Test Invalid TTL Rejection
```bash
# Try to set TTL below minimum (5 min = 300 sec)
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "room_id": "test_room_123",
    "ttl_seconds": 100
  }'
```
**Expected Response**: ✅ 400 Bad Request with error message about TTL limits

---

## Phase 4: Message Creation Testing (5 minutes)

### Step 4.1: Create Regular Message
```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
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
    "id": "msg-uuid-1",
    "is_ephemeral": false,
    "expires_at": null,
    "content": "Regular message",
    "status": "sent"
  },
  "success": true
}
```
**Status**: ✅ Pass if `is_ephemeral=false` and `expires_at=null`

---

### Step 4.2: Create Ephemeral Message
```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "room_id": "test_room_123",
    "content": "Ephemeral message - will expire",
    "is_ephemeral": true
  }'

# Save the response, note the message ID and expires_at
```
**Expected Response**:
```json
{
  "message": {
    "id": "msg-uuid-2",
    "is_ephemeral": true,
    "expires_at": "2024-06-02T14:30:00Z",
    "content": "Ephemeral message - will expire",
    "status": "sent"
  },
  "success": true
}
```
**Status**: ✅ Pass if:
- `is_ephemeral=true`
- `expires_at` is set to future timestamp
- `expires_at ≈ created_at + 3600 seconds` (based on room TTL)

---

### Step 4.3: Verify Message Respects TTL
```bash
# Compare created_at and expires_at
# Calculate difference: expires_at - created_at should equal room TTL (3600 seconds)

# From API responses:
# created_at ≈ 2024-06-01T13:30:00Z
# expires_at = 2024-06-02T14:30:00Z (approximately, depends on server time)
# Difference = 3600 seconds ✅
```
**Status**: ✅ Pass if expiry matches configured TTL

---

## Phase 5: Cleanup Job Testing (10 minutes)

### Step 5.1: Create Multiple Test Messages
```bash
# Create 10 ephemeral messages quickly
for i in {1..10}; do
  curl -s -X POST http://localhost:3000/api/messages \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d "{
      \"room_id\": \"test_room_cleanup\",
      \"content\": \"Test message $i\",
      \"is_ephemeral\": true
    }" &
done
wait
```
**Status**: ✅ Pass if all 10 messages created

---

### Step 5.2: Set Short TTL for Testing
```bash
# Set TTL to 10 seconds to speed up testing
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "room_id": "test_room_cleanup",
    "ttl_seconds": 10,
    "enabled": true
  }'
```
**Status**: ✅ Pass if config saved

---

### Step 5.3: Wait for Messages to Expire
```bash
echo "Waiting for messages to expire (15 seconds)..."
sleep 15
echo "Messages should now be expired!"
```

---

### Step 5.4: Get Pre-Cleanup Statistics
```bash
curl http://localhost:3000/api/ephemeral/cleanup
```
**Expected Response**:
```json
{
  "stats": {
    "totalEphemeralMessages": 10,
    "expiredMessages": 10,
    "deletedToday": 0,
    "deletedThisMonth": 0
  }
}
```
**Status**: ✅ Pass if `expiredMessages=10` (all messages now expired)

---

### Step 5.5: Trigger Manual Cleanup
```bash
curl -X POST http://localhost:3000/api/ephemeral/cleanup \
  -H "X-Cleanup-Secret: test-secret-12345"
```
**Expected Response**:
```json
{
  "success": true,
  "result": {
    "totalDeleted": 10,
    "deletedByRoom": {
      "test_room_cleanup": 10
    },
    "errors": [],
    "duration_ms": 250
  },
  "message": "Cleanup completed. 10 messages deleted."
}
```
**Status**: ✅ Pass if:
- `success=true`
- `totalDeleted=10`
- `duration_ms < 1000`
- No errors

---

### Step 5.6: Verify Messages Deleted
```bash
# Try to retrieve messages from the room
curl "http://localhost:3000/api/messages?room_id=test_room_cleanup&limit=50" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```
**Expected Response**:
```json
{
  "messages": []
}
```
**Status**: ✅ Pass if messages array is empty

---

## Phase 6: Audit Logging Verification (3 minutes)

### Step 6.1: Retrieve Cleanup Logs
```bash
curl "http://localhost:3000/api/ephemeral/cleanup?action=logs&limit=20&room_id=test_room_cleanup"
```
**Expected Response**:
```json
{
  "logs": [
    {
      "id": "log-uuid-1",
      "deleted_message_id": "msg-uuid-1",
      "room_id": "test_room_cleanup",
      "deleted_at": "2024-06-01T14:30:00Z",
      "reason": "expired"
    },
    ...
  ]
}
```
**Status**: ✅ Pass if:
- 10 log entries returned
- All have `reason="expired"`
- `deleted_at` timestamps are recent
- All `deleted_message_id` values are valid UUIDs

---

## Phase 7: Message Preservation Testing (5 minutes)

### Step 7.1: Create Mixed Messages
```bash
# Create 5 ephemeral + 5 regular messages
for i in {1..5}; do
  # Ephemeral
  curl -s -X POST http://localhost:3000/api/messages \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d "{
      \"room_id\": \"test_room_mixed\",
      \"content\": \"Ephemeral $i\",
      \"is_ephemeral\": true
    }" &

  # Regular
  curl -s -X POST http://localhost:3000/api/messages \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d "{
      \"room_id\": \"test_room_mixed\",
      \"content\": \"Regular $i\",
      \"is_ephemeral\": false
    }" &
done
wait
```

---

### Step 7.2: Set Short TTL and Wait
```bash
# Set TTL to 10 seconds
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "room_id": "test_room_mixed",
    "ttl_seconds": 10,
    "enabled": true
  }'

# Wait 15 seconds
sleep 15
```

---

### Step 7.3: Trigger Cleanup
```bash
curl -X POST http://localhost:3000/api/ephemeral/cleanup \
  -H "X-Cleanup-Secret: test-secret-12345"
```

---

### Step 7.4: Verify Regular Messages Survived
```bash
curl "http://localhost:3000/api/messages?room_id=test_room_mixed&limit=50" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```
**Expected Response**:
```json
{
  "messages": [
    {
      "content": "Regular 5",
      "is_ephemeral": false,
      "expires_at": null
    },
    {
      "content": "Regular 4",
      "is_ephemeral": false,
      "expires_at": null
    },
    ...
  ]
}
```
**Status**: ✅ Pass if:
- 5 regular messages remain
- 0 ephemeral messages remain
- All regular messages have `is_ephemeral=false` and `expires_at=null`

---

## Phase 8: Background Worker Testing (5 minutes)

### Step 8.1: Start Cleanup Worker
```bash
# Terminal 2 (new terminal)
CLEANUP_INTERVAL=1 npm run cleanup:worker

# Expected output:
# ✅ Cleanup worker is running. Press Ctrl+C to stop.
```

---

### Step 8.2: Create Expiring Messages
```bash
# In Terminal 1, create messages with 5-second TTL
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "room_id": "test_room_worker",
    "ttl_seconds": 5,
    "enabled": true
  }'

# Create messages
for i in {1..5}; do
  curl -s -X POST http://localhost:3000/api/messages \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d "{
      \"room_id\": \"test_room_worker\",
      \"content\": \"Worker test $i\",
      \"is_ephemeral\": true
    }" &
done
wait
```

---

### Step 8.3: Observe Automatic Cleanup
```bash
# In Terminal 2, watch the logs
# Expected after ~10 seconds (1 minute interval + 5 sec TTL + 5 sec buffer):
# ⏰ Running scheduled cleanup job
# ✅ Cleanup job completed
# [5 messages deleted]

# Wait up to 1.5 minutes for cleanup to run
sleep 90
```

---

### Step 8.4: Verify Messages Deleted
```bash
# Terminal 1: Check if messages deleted
curl "http://localhost:3000/api/messages?room_id=test_room_worker" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```
**Status**: ✅ Pass if messages array is empty after ~1-2 minutes

---

## Phase 9: Error Handling Testing (3 minutes)

### Step 9.1: Test Unauthorized Cleanup
```bash
curl -X POST http://localhost:3000/api/ephemeral/cleanup \
  -H "X-Cleanup-Secret: wrong-secret"
```
**Expected Response**: ✅ 401 Unauthorized

---

### Step 9.2: Test Invalid Configuration
```bash
# Try to set TTL exceeding maximum
curl -X POST http://localhost:3000/api/ephemeral/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "room_id": "test_room_123",
    "ttl_seconds": 99999999,
    "enabled": true
  }'
```
**Expected Response**: ✅ 400 Bad Request with error message

---

## Phase 10: Summary & Verification (2 minutes)

### Step 10.1: Final Statistics Check
```bash
curl http://localhost:3000/api/ephemeral/cleanup
```
**Expected Output**: Statistics showing successful cleanup operations

---

### Step 10.2: Verify Database State
```sql
-- Check message counts
SELECT 
  COUNT(*) as total_messages,
  COUNT(CASE WHEN is_ephemeral THEN 1 END) as ephemeral_messages,
  COUNT(CASE WHEN is_ephemeral THEN 1 END AND expires_at < NOW() THEN 1 END) as expired_messages
FROM public.messages;

-- Check configuration
SELECT room_id, ttl_seconds, enabled FROM public.ephemeral_message_config;

-- Check audit logs
SELECT COUNT(*), reason FROM public.ephemeral_message_cleanup_logs GROUP BY reason;
```

---

## Testing Results Summary

Create a summary table:

| Test Phase | Component | Status | Notes |
|-----------|-----------|--------|-------|
| 1 | Environment Setup | ✅ PASS | Dependencies installed |
| 2 | Database Schema | ✅ PASS | All tables and indexes created |
| 3 | Config API | ✅ PASS | All endpoints working |
| 4 | Message Creation | ✅ PASS | Ephemeral + regular messages |
| 5 | Manual Cleanup | ✅ PASS | Batch deletion working |
| 6 | Audit Logging | ✅ PASS | All deletions logged |
| 7 | Message Preservation | ✅ PASS | Regular messages untouched |
| 8 | Background Worker | ✅ PASS | Auto cleanup running |
| 9 | Error Handling | ✅ PASS | Proper auth/validation |
| 10 | Final Verification | ✅ PASS | System stable |

---

## Success Criteria Checklist

- [ ] All 10 test phases completed
- [ ] Database migration applied successfully
- [ ] All API endpoints responding correctly
- [ ] Ephemeral messages created with TTL
- [ ] Cleanup job deletes expired messages
- [ ] Regular messages not affected
- [ ] Audit trail created for all deletions
- [ ] Error handling working properly
- [ ] Background worker auto-cleanup functional
- [ ] Performance acceptable (< 1s for cleanup)
- [ ] No data corruption observed
- [ ] Authorization properly enforced

---

## Deployment Checklist

- [ ] Run `npm install node-cron`
- [ ] Set environment variables in production
- [ ] Apply database migration to production
- [ ] Test cron endpoint: `GET /api/ephemeral/cron`
- [ ] Configure Vercel cron (if using Vercel)
- [ ] Set up monitoring/alerting
- [ ] Document in team wiki
- [ ] Update API documentation

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Migration fails | Check Supabase permissions, try manual SQL import |
| API returns 401 | Verify auth token is valid, check Authorization header |
| Messages not expiring | Verify TTL config, check cleanup job running |
| Worker not running | Check environment variables, verify Node.js version |
| High CPU usage | Reduce CLEANUP_INTERVAL, check DB indexes |

---

## Contact & Support

If tests fail:
1. Check application logs
2. Verify environment variables
3. Ensure database migration complete
4. Review error messages carefully
5. Consult EPHEMERAL_MESSAGES_README.md for detailed docs

---

**Congratulations!** 🎉 If all tests pass, the ephemeral messages cleanup job is successfully implemented and ready for production use!

