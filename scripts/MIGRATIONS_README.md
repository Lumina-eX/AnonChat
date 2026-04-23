# Migration files and instructions

This repo includes SQL migration scripts in the `scripts/` folder. If you open a PR that adds or modifies these SQL files, please ask the repository maintainers (or CI) to apply them to the database in order.

Included migrations (apply in numeric order):

- `001_create_profiles.sql`
- `002_create_profile_trigger.sql`
- `003_create_invites.sql` (new)
- `004_create_room_members.sql` (new)
- `005_add_last_read_to_room_members.sql` (new)
- `006_unread_view.sql`          (new)
- `007_create_group_membership.sql`  (new)

## How to apply (psql)

If you have direct DB access (preferred), run:

```bash
# Example using a DATABASE_URL or connection string
export DATABASE_URL="postgresql://<user>:<password>@<host>:5432/<database>"

# Apply each file in order
psql "$DATABASE_URL" -f scripts/001_create_profiles.sql
psql "$DATABASE_URL" -f scripts/002_create_profile_trigger.sql
psql "$DATABASE_URL" -f scripts/003_create_invites.sql
psql "$DATABASE_URL" -f scripts/004_create_room_members.sql
psql "$DATABASE_URL" -f scripts/005_add_last_read_to_room_members.sql
psql "$DATABASE_URL" -f scripts/006_unread_view.sql
psql "$DATABASE_URL" -f scripts/007_create_group_membership.sql
```

## How to apply (Supabase)

If the project uses Supabase, maintainers can run the same `psql` commands against the Supabase database connection string (available from the Supabase project settings), or use the Supabase dashboard SQL editor to run each migration in order.

## Notes for maintainers

- These migrations introduce new tables, columns, and a view. Review the RLS policies in each script before applying in production.
- `scripts/005_add_last_read_to_room_members.sql` adds `last_read_at` used by the unread-count view.
- `scripts/006_unread_view.sql` creates `public.user_room_unreads` view and grants `SELECT` to `public` for convenience; adjust privileges as needed.
- `scripts/007_create_group_membership.sql` creates `public.group_membership` table for wallet-based group membership tracking.
- A development-only endpoint (`/api/rooms/seed-test`) was added that seeds a room for an authenticated user. It requires a valid Supabase session; do not enable any service-role or unauthenticated behavior in production without review.

## Including migrations in PRs

When creating your PR:

- Keep SQL files in `scripts/` and name them with a numeric prefix as above.
- Add a short description in the PR body listing the migrations and any manual steps required (e.g., reindexing, backfills).
- If you expect maintainers to run migrations, include the `psql` commands or reference this file so they can apply them during merging or in CI.

If you'd like, I can also:

- Add a simple Node script that runs the migrations using an env var `DATABASE_URL`.
- Add a GitHub Actions workflow that will apply migrations to a staging database (if secrets are available).
