# Migration files and instructions

This repo includes SQL migration scripts in the `scripts/` folder. If you open a PR that adds or modifies these SQL files, please ask the repository maintainers (or CI) to apply them to the database in order.

Included migrations (apply in numeric order):

| File | Description |
|------|-------------|
| `001_create_profiles.sql` | Creates the `profiles` table |
| `002_create_profile_trigger.sql` | Trigger to auto-create a profile on user sign-up |
| `003_create_invites.sql` | Invite codes table |
| `003_add_blockchain_fields.sql` | Adds Stellar blockchain fields to rooms |
| `003_room_members_and_removal_votes.sql` | Room members and vote-to-remove tables |
| `004_create_room_members.sql` | Room membership table |
| `005_add_last_read_to_room_members.sql` | Adds `last_read_at` for unread-count tracking |
| `006_unread_view.sql` | Creates `user_room_unreads` view |
| `007_create_group_membership.sql` | Wallet-based group membership tracking |
| `007_secure_messages_rls.sql` | RLS policies for the messages table |
| `008_create_groups.sql` | Groups table |
| `009_encrypted_file_references.sql` | Encrypted file reference table |
| `010_message_status.sql` | Adds `status` column to messages |
| `011_stellar_memo_group_id.sql` | Stellar memo ↔ group ID mapping table |
| `012_ephemeral_messages.sql` | **TTL columns** (`is_ephemeral`, `expires_at`) on messages; `default_ttl_seconds` on rooms; partial index; helper function |

## How to apply (psql)

If you have direct DB access (preferred), run each file in numeric order:

```bash
export DATABASE_URL="postgresql://<user>:<password>@<host>:5432/<database>"

psql "$DATABASE_URL" -f scripts/001_create_profiles.sql
psql "$DATABASE_URL" -f scripts/002_create_profile_trigger.sql
psql "$DATABASE_URL" -f scripts/003_create_invites.sql
psql "$DATABASE_URL" -f scripts/003_add_blockchain_fields.sql
psql "$DATABASE_URL" -f scripts/003_room_members_and_removal_votes.sql
psql "$DATABASE_URL" -f scripts/004_create_room_members.sql
psql "$DATABASE_URL" -f scripts/005_add_last_read_to_room_members.sql
psql "$DATABASE_URL" -f scripts/006_unread_view.sql
psql "$DATABASE_URL" -f scripts/007_create_group_membership.sql
psql "$DATABASE_URL" -f scripts/007_secure_messages_rls.sql
psql "$DATABASE_URL" -f scripts/008_create_groups.sql
psql "$DATABASE_URL" -f scripts/009_encrypted_file_references.sql
psql "$DATABASE_URL" -f scripts/010_message_status.sql
psql "$DATABASE_URL" -f scripts/011_stellar_memo_group_id.sql
psql "$DATABASE_URL" -f scripts/012_ephemeral_messages.sql
```

## How to apply (Supabase)

Use the Supabase dashboard SQL editor or the `psql` command with your project's connection string (available from **Project Settings → Database**). Run each file in the order listed above.

## Ephemeral message cleanup worker

Migration `012` enables the TTL system. After applying it you must also run the cleanup worker so expired messages are actually deleted.

### Development

```bash
# Run Next.js + WebSocket server + cleanup worker concurrently
npm run dev:all

# Or start only the cleanup worker
npm run dev:cleanup
```

### Production (self-hosted / Docker)

Run the cleanup worker as a separate long-lived process alongside your Next.js server:

```bash
node scripts/start-cleanup-worker.js
```

Environment variables for the worker:

| Variable | Default | Description |
|----------|---------|-------------|
| `EPHEMERAL_TTL_SECONDS` | `86400` | System-wide default TTL in seconds (24 h) |
| `EPHEMERAL_CLEANUP_INTERVAL_MS` | `300000` | How often the worker runs (5 min) |
| `EPHEMERAL_CLEANUP_BATCH_SIZE` | `200` | Messages deleted per DB round-trip |
| `NEXT_PUBLIC_SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Service-role key (bypasses RLS for deletion) |

### Production (Vercel / serverless)

The repo ships a Vercel Cron endpoint at `/api/cron/ephemeral-cleanup` and a `vercel.json` that schedules it every 5 minutes. Set the `CRON_SECRET` environment variable in your Vercel project to secure the endpoint.

### Admin API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/ephemeral-cleanup` | Fetch current TTL config |
| `POST` | `/api/admin/ephemeral-cleanup` | Trigger an immediate cleanup run |
| `PATCH` | `/api/admin/ephemeral-cleanup` | Update system-wide default TTL at runtime |

All admin endpoints require `Authorization: Bearer <ADMIN_SECRET>`.

### Per-room TTL API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/rooms/:roomId/ttl` | Fetch a room's TTL config (members only) |
| `PATCH` | `/api/rooms/:roomId/ttl` | Update a room's TTL (creator only) |

## Notes for maintainers

- `005_add_last_read_to_room_members.sql` adds `last_read_at` used by the unread-count view.
- `006_unread_view.sql` creates `public.user_room_unreads` view and grants `SELECT` to `public`; adjust privileges as needed.
- `007_create_group_membership.sql` creates `public.group_membership` for wallet-based membership tracking.
- `012_ephemeral_messages.sql` uses `ALTER TABLE … ADD COLUMN IF NOT EXISTS` so it is safe to re-run. The partial index and helper function are also idempotent (`CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`).
- The cleanup worker uses the **service role key** to bypass RLS. Never expose this key client-side.
- A development-only endpoint (`/api/rooms/seed-test`) seeds a room for an authenticated user. Do not enable unauthenticated access in production.

## Including migrations in PRs

When creating your PR:

- Keep SQL files in `scripts/` and name them with a numeric prefix as above.
- Add a short description in the PR body listing the migrations and any manual steps required (e.g., reindexing, backfills).
- Include the `psql` commands or reference this file so maintainers can apply them during merging or in CI.
