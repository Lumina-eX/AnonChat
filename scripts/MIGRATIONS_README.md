# Database Migrations

SQL migration scripts live in `scripts/`. Apply them in the order listed below — the numeric prefix determines the order. Some prefixes have multiple files; apply all of them before moving to the next number.

## Migration order

| File | Description |
|---|---|
| `001_create_profiles.sql` | User profiles table |
| `002_create_profile_trigger.sql` | Auto-create profile on auth.users insert |
| `003_create_invites.sql` | Group invite system |
| `003_add_blockchain_fields.sql` | Blockchain metadata fields on rooms |
| `003_room_members_and_removal_votes.sql` | Room membership and vote-to-remove tables |
| `004_create_room_members.sql` | Room members table (RLS policies) |
| `005_add_last_read_to_room_members.sql` | `last_read_at` column for unread counts |
| `006_unread_view.sql` | `user_room_unreads` view |
| `007_create_group_membership.sql` | Wallet-based group membership tracking |
| `007_secure_messages_rls.sql` | Row-Level Security policies for messages |
| `008_create_groups.sql` | Groups table with blockchain anchoring fields |
| `009_encrypted_file_references.sql` | Encrypted file reference metadata |
| `010_message_status.sql` | Message delivery status tracking |
| `011_group_tx_memo_map.sql` | Group ID → Stellar transaction memo mapping |
| `012_escrow_tables.sql` | Escrow records and escrow events audit log |

## How to apply

### Option A — Supabase SQL Editor

Open your Supabase project → **SQL Editor → New query**, then paste and run each file in the order above.

### Option B — psql

```bash
export DATABASE_URL="postgresql://postgres:<password>@<host>:5432/postgres"

for f in \
  scripts/001_create_profiles.sql \
  scripts/002_create_profile_trigger.sql \
  scripts/003_create_invites.sql \
  scripts/003_add_blockchain_fields.sql \
  scripts/003_room_members_and_removal_votes.sql \
  scripts/004_create_room_members.sql \
  scripts/005_add_last_read_to_room_members.sql \
  scripts/006_unread_view.sql \
  scripts/007_create_group_membership.sql \
  scripts/007_secure_messages_rls.sql \
  scripts/008_create_groups.sql \
  scripts/009_encrypted_file_references.sql \
  scripts/010_message_status.sql \
  scripts/011_group_tx_memo_map.sql \
  scripts/012_escrow_tables.sql; do
  echo "Applying $f..."
  psql "$DATABASE_URL" -f "$f"
done
```

The Supabase connection string is in your project: **Settings → Database → Connection string**.

## Notes for maintainers

- All tables have Row-Level Security (RLS) enabled. Review RLS policies in each script before applying to production.
- `005_add_last_read_to_room_members.sql` adds `last_read_at`, which is required by the unread-count view in `006`.
- `006_unread_view.sql` creates `public.user_room_unreads` and grants `SELECT` to `public` — adjust privileges as needed.
- `007_secure_messages_rls.sql` tightens message access; apply it after `007_create_group_membership.sql`.
- `012_escrow_tables.sql` creates `escrows` and `escrow_events` tables used by the full escrow lifecycle.

## Adding new migrations

- Name files with a numeric prefix: `013_your_migration.sql`
- Add a row to the table above in your PR
- Include the `psql` command in the PR description so maintainers can apply it during merge
