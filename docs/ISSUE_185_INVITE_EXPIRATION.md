# Issue #185 — Implement Invite Code Expiration System

## Summary
Implement expiration support for group invitation codes so invites can be limited by time and usage, invalid/expired codes are rejected cleanly, and expired invites are deactivated automatically.

## What changed
- Added invite expiration and usage-limit fields to the invites schema.
- Validated invite codes before group join requests and returned clear client-facing errors for expired or inactive codes.
- Auto-deactivated invites when they expire or reach their usage limit.
- Allowed invite generation to accept optional expiration and usage configuration from the owner.
- Added regression tests covering invite expiry and usage-limit validation.

## Acceptance highlights
- Expired or inactive invites cannot be used to join groups.
- Invalid, expired, and over-used invites return clear error messages.
- Invite state is persisted so expired codes can be recognized and cleaned up later.
