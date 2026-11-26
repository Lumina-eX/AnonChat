# Group message retention

Group owners can read and update retention settings through:

- `GET /api/groups/{groupId}/retention`
- `PUT /api/groups/{groupId}/retention`

The update endpoint requires an authenticated session and a valid one-time wallet signature. Its JSON body is:

```json
{
  "enabled": true,
  "retention_seconds": 604800,
  "walletAddress": "…",
  "signature": "…"
}
```

`retention_seconds` must be an integer from 300 seconds (5 minutes) to 2,592,000 seconds (30 days). Invalid values return HTTP 400. Disabling retention does not restore messages that have already expired or been deleted. A policy applies to messages created while that policy is enabled; their expiry timestamp is stored when each message is created. Updating or disabling the policy does not extend an existing message's expiry.

The `/api/ephemeral/cron` scheduled job also processes expired group-retention messages every 15 minutes. Deletions are atomic and idempotent, message read receipts are removed by their database foreign key, reply references are nulled, failures are recorded for the next cleanup attempt, and affected room caches are invalidated on a best-effort basis. Policy changes and deletion metadata are retained separately from message content.

Retention removes message records managed by this application. It cannot guarantee removal from:

- Database or infrastructure backups before those backups expire under their own schedules.
- Application, CDN, browser, or intermediary caches that could not be invalidated.
- Search indexes or other derived systems not directly managed by this cleanup worker.
- External storage systems or services that maintain their own copies.
- Client-side copies previously downloaded, exported, forwarded, screenshotted, or otherwise saved by participants.

Retention must not be presented as erasing copies outside the platform's control. Applying migration `024_message_retention.sql` is required before enabling this feature. The cleanup functions are restricted to the Supabase `service_role`; configure `SUPABASE_SERVICE_ROLE_KEY` only in trusted server environments.
