# Ephemeral Messages - Setup Guide

## Quick Start

### 1. Database Setup

Apply the migration to your Supabase project:

```bash
# Using Supabase CLI
supabase db push

# Or manually:
# Copy the SQL from scripts/014_add_ephemeral_messages.sql
# Paste into Supabase SQL Editor and run
```

### 2. Environment Variables

Add these to your `.env.local` or deployment platform:

```bash
# For local development with cleanup worker
CLEANUP_INTERVAL=5  # minutes

# For manual cleanup triggers (testing)
EPHEMERAL_CLEANUP_SECRET=your-development-secret-here

# For production Vercel cron
VERCEL_CRON_SECRET=your-production-vercel-secret

# Your existing Supabase variables
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Install Dependencies

```bash
npm install node-cron
# or
pnpm add node-cron
```

### 4. Choose Your Deployment Strategy

#### Option A: Vercel Cron (Recommended for Vercel deployment)

1. Cron job is already configured in `vercel.json`
2. Deploys automatically with `git push`
3. Runs every 6 hours via `/api/ephemeral/cron`
4. No additional infrastructure needed

**Configuration**: Set `VERCEL_CRON_SECRET` in Vercel deployment settings

#### Option B: Node.js Worker (For self-hosted/Docker)

1. Run the worker process separately:
```bash
npm run cleanup:worker
```

2. Or in Docker:
```dockerfile
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
CMD ["npm", "run", "cleanup:worker"]
```

3. Set `CLEANUP_INTERVAL` environment variable (default: 5 minutes)

#### Option C: External Cron Service (e.g., AWS Lambda, Google Cloud Scheduler)

1. Call `/api/ephemeral/cleanup` endpoint
2. Pass `X-Cleanup-Secret` header
3. Schedule via external service

---

## Development Testing

### Local Development with Worker

```bash
# Terminal 1: Run Next.js dev server
npm run dev

# Terminal 2: Run cleanup worker
npm run cleanup:worker

# Terminal 3: Test the setup
npm run test:ephemeral
```

### Manual Cleanup Testing

```bash
# Trigger cleanup manually
EPHEMERAL_CLEANUP_SECRET=test-secret npm run cleanup:trigger

# Check statistics
curl http://localhost:3000/api/ephemeral/cleanup

# Create test messages
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $YOUR_TOKEN" \
  -d '{
    "room_id": "test",
    "content": "Ephemeral message",
    "is_ephemeral": true
  }'
```

---

## Production Deployment

### Vercel

1. **Set environment variables** in Vercel Dashboard:
   - `VERCEL_CRON_SECRET` = strong random string
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `EPHEMERAL_CLEANUP_SECRET` (optional, for manual triggers)

2. **Verify cron setup**:
   ```bash
   # Check vercel.json has crons configured
   cat vercel.json
   ```

3. **Deploy**:
   ```bash
   git push
   # Vercel automatically deploys and schedules cron
   ```

4. **Monitor**:
   - Vercel Dashboard → Cron Jobs
   - Check execution logs after first run

### Docker / Self-Hosted

1. **Update docker-compose.yml or Dockerfile**:
```yaml
services:
  cleanup-worker:
    image: node:20
    volumes:
      - ./:/app
    working_dir: /app
    command: npm run cleanup:worker
    environment:
      - CLEANUP_INTERVAL=5
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - NODE_ENV=production
    restart: always
```

2. **Deploy**:
```bash
docker-compose up -d cleanup-worker
```

3. **Verify**:
```bash
docker logs cleanup-worker
# Should show: "✅ Cleanup worker is running"
```

---

## Configuration Reference

### TTL Limits

- **Default**: 24 hours
- **Minimum**: 5 minutes
- **Maximum**: 30 days

### Cleanup Frequency

- **Vercel**: Every 6 hours (configurable in `vercel.json`)
- **Node Worker**: Every 5 minutes (configurable via `CLEANUP_INTERVAL`)

### Batch Size

- **Maximum**: 100 messages per cleanup cycle
- (adjustable in `lib/ephemeral-config.ts` if needed)

### Log Retention

- **Duration**: 90 days
- Logs older than 90 days are automatically deleted

---

## Troubleshooting

### Cleanup Not Running

**Vercel**:
- Check Vercel Dashboard → Cron Jobs → View Logs
- Ensure `VERCEL_CRON_SECRET` is set
- Check `/api/ephemeral/cron` endpoint is accessible

**Node Worker**:
- Verify process is running: `ps aux | grep cleanup`
- Check logs: `docker logs cleanup-worker`
- Ensure environment variables are set
- Check database connection

### Authorization Errors

```bash
# Verify cleanup secret matches
echo $EPHEMERAL_CLEANUP_SECRET

# Manually trigger with correct secret
EPHEMERAL_CLEANUP_SECRET=$CORRECT_SECRET npm run cleanup:trigger
```

### Database Migration Failed

```bash
# Verify migration applied
supabase db pull  # fetches current schema
supabase db list  # shows migration status

# Re-apply if needed
supabase db push --force-push  # caution: can cause data loss
```

---

## Monitoring & Alerts

### Logging

Cleanup logs appear in:
- **Vercel**: Vercel Logs dashboard
- **Node Worker**: `stdout` / `stderr`
- **Database**: `ephemeral_message_cleanup_logs` table

### Key Metrics to Monitor

```bash
# Total ephemeral messages in system
curl http://localhost:3000/api/ephemeral/cleanup | jq '.stats.totalEphemeralMessages'

# Messages deleted today
curl http://localhost:3000/api/ephemeral/cleanup | jq '.stats.deletedToday'

# Cleanup logs (recent failures)
curl "http://localhost:3000/api/ephemeral/cleanup?action=logs&limit=10"
```

### Setting Up Alerts (Optional)

Use your monitoring platform to alert if:
- `expiredMessages` count stays high (cleanup not running)
- Cleanup endpoint returns 500+ errors
- No logs created in 24 hours

---

## Security Best Practices

1. **Secret Management**
   - Use strong, random `EPHEMERAL_CLEANUP_SECRET`
   - Store in secure vault (not git)
   - Rotate secrets periodically

2. **Authorization**
   - Only room creators can modify room TTL config
   - Service role key only used server-side
   - RLS policies enforce data isolation

3. **Audit Trail**
   - All deletions logged in `ephemeral_message_cleanup_logs`
   - Logs retained for 90 days
   - Includes timestamp, user, message ID, reason

4. **Database**
   - Indexes optimize cleanup queries
   - Batch operations prevent long transactions
   - Transaction safety maintained

---

## Support & Debugging

### Enable Debug Logging

In `lib/logger.ts`, enable debug level:
```typescript
export const logger = {
  debug: (msg, data) => console.log('[DEBUG]', msg, data),
  // ... other levels
};
```

### Manual Cleanup Execution

```bash
# Run cleanup once immediately
EPHEMERAL_CLEANUP_SECRET=test node -e \
  "import('./lib/ephemeral-cleanup.ts').then(m => m.cleanupExpiredMessages())"
```

### Database Inspection

```sql
-- Count ephemeral messages
SELECT is_ephemeral, COUNT(*) FROM messages GROUP BY is_ephemeral;

-- Check expired messages
SELECT COUNT(*) FROM messages 
WHERE is_ephemeral = true AND expires_at < NOW();

-- View cleanup logs
SELECT COUNT(*), reason FROM ephemeral_message_cleanup_logs 
GROUP BY reason ORDER BY count DESC;

-- Check room configs
SELECT room_id, ttl_seconds, enabled 
FROM ephemeral_message_config 
ORDER BY updated_at DESC;
```

---

## Next Steps

1. ✅ Apply database migration
2. ✅ Set environment variables
3. ✅ Install dependencies
4. ✅ Test locally (`npm run test:ephemeral`)
5. ✅ Deploy to production
6. ✅ Monitor cleanup job execution
7. ✅ Configure alerts
8. ✅ Document in team wiki

For detailed testing procedures, see [EPHEMERAL_TESTING_GUIDE.md](./EPHEMERAL_TESTING_GUIDE.md)
