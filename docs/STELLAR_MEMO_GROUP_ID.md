# Stellar Memo Group ID Feature

## Overview

This feature leverages Stellar's native memo field to store and reference group IDs during on-chain interactions. This enables lightweight group identification without requiring additional custom fields or contracts.

## Architecture

### Memo Format

- **Format**: `grp_<12-char-slug>` (17 bytes total, well within Stellar's 28-byte limit)
- **Derivation**: Deterministic derivation from room ID using the existing format `room_{timestamp}_{random9chars}`
- **Fallback**: SHA-256 hash of room ID (first 24 hex chars) for non-standard room IDs

### Database Schema

#### `rooms` table
- **`memo_group_id`**: Compact group identifier (≤28 bytes) embedded in the Stellar transaction memo field
- **Index**: Unique index on `memo_group_id` for fast lookups

#### `group_tx_memos` table
Lookup table for groupId ↔ transactionId mapping:
- **`group_id`**: References `rooms(id)` with CASCADE delete
- **`memo_group_id`**: The exact text stored in the Stellar transaction memo
- **`tx_hash`**: Stellar transaction hash that contains this memo
- **Indexes**: Fast lookups in both directions (group_id, memo_group_id, tx_hash)
- **RLS**: Public read access, authenticated insert only

## Implementation Details

### Core Components

#### 1. Memo Utilities (`lib/blockchain/memo.ts`)

```typescript
// Derive a deterministic memo from room ID
deriveMemoGroupId(roomId: string): string

// Validate memo format and constraints
validateMemoGroupId(memo: unknown): { valid: true } | { valid: false; reason: string }

// Check if memo matches expected value for a group
memoMatchesGroup(roomId: string, onChainMemo: string): boolean
```

**Validation Rules**:
- Must be a non-empty string
- Must be ≤28 bytes when encoded as UTF-8
- Must start with "grp_" prefix
- Must contain only printable ASCII characters

#### 2. Memo Middleware (`lib/blockchain/memo-middleware.ts`)

```typescript
// Validate memo from request
validateRequestMemo(memo: unknown, groupId?: string): MemoValidationResult

// Return error response for invalid memo
memoValidationError(memo: unknown, groupId?: string): NextResponse | null
```

#### 3. Stellar Service Integration (`lib/blockchain/stellar-service.ts`)

The `submitMetadataHash()` function:
1. Derives memo from group ID using `deriveMemoGroupId()`
2. Validates memo before building transaction
3. Embeds memo in Stellar transaction using `StellarSdk.Memo.text()`
4. Returns `memoGroupId` in the result for database storage

#### 4. API Endpoints

##### `GET /api/stellar/memo?memo=grp_abc123xyz`
Looks up a group by its Stellar memo identifier:
- Validates memo format
- Queries `group_tx_memos` lookup table first (fast path)
- Falls back to `rooms` table if lookup table entry missing
- Returns room record and associated transaction hash

##### `POST /api/rooms`
Creates a room and:
- Derives memo from room ID
- Submits transaction with embedded memo
- Stores `memo_group_id` in `rooms` table
- Persists mapping in `group_tx_memos` lookup table

##### `GET /api/rooms/[roomId]/verify`
Verifies room metadata including:
- Retrieves transaction from blockchain
- Extracts memo from on-chain transaction
- Validates memo matches expected value for group
- Returns verification status with memo validation result

## Acceptance Criteria

✅ **Each transaction memo is linked to a specific group ID**
- Memo is deterministically derived from room ID
- Stored in both `rooms.memo_group_id` and `group_tx_memos` table

✅ **Memo is stored and retrievable during on-chain interaction**
- Memo embedded in Stellar transaction via `StellarSdk.Memo.text()`
- Can be retrieved via `/api/stellar/memo` endpoint
- Transaction hash stored for blockchain verification

✅ **Group ID can be validated against existing records**
- `memoMatchesGroup()` validates on-chain memo against expected value
- Middleware validates memo format and cross-checks with group ID
- Verification endpoint includes memo validation status

✅ **Ensure memo usage does not conflict with other transaction metadata**
- Memo carries group ID reference only
- Metadata hash stored separately in database
- Clear separation of concerns: memo = group ID, hash = metadata integrity

## Migration

Apply the database migration:

```bash
# Using psql
psql "$DATABASE_URL" -f scripts/011_stellar_memo_group_id.sql

# Or via Supabase SQL Editor
# Run the contents of scripts/011_stellar_memo_group_id.sql
```

## Usage Examples

### Deriving a Memo

```typescript
import { deriveMemoGroupId } from "@/lib/blockchain/memo";

const roomId = "room_1714000000000_abc123xyz";
const memo = deriveMemoGroupId(roomId);
// Returns: "grp_abc123xyz" (17 bytes)
```

### Validating a Memo

```typescript
import { validateMemoGroupId } from "@/lib/blockchain/memo";

const result = validateMemoGroupId("grp_abc123xyz");
if (!result.valid) {
  console.error(result.reason);
}
```

### Looking Up a Group by Memo

```bash
curl "https://your-app.com/api/stellar/memo?memo=grp_abc123xyz"
```

Response:
```json
{
  "groupId": "room_1714000000000_abc123xyz",
  "memoGroupId": "grp_abc123xyz",
  "transactionHash": "abc123...",
  "explorerUrl": "https://stellar.expert/tx/abc123...",
  "room": {
    "id": "room_1714000000000_abc123xyz",
    "name": "My Group",
    "description": "A private group",
    "is_private": false,
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

### Verifying Memo Integrity

```typescript
import { memoMatchesGroup } from "@/lib/blockchain/memo";

const roomId = "room_1714000000000_abc123xyz";
const onChainMemo = "grp_abc123xyz";

if (memoMatchesGroup(roomId, onChainMemo)) {
  console.log("Memo is valid for this group");
}
```

## Error Handling

### Missing Memo
- API returns 400 with error: "memo query parameter is required"

### Invalid Memo Format
- API returns 400 with detailed reason (e.g., exceeds byte limit, wrong prefix, non-ASCII characters)

### Memo Not Found
- API returns 404 with error: "No group found for the provided memo"

### Memo Mismatch
- Verification endpoint returns `memoVerified: false` with expected vs actual memo values

## Technical Notes

### Memo Length Limits
- Stellar TEXT memo limit: 28 bytes
- Our format: `grp_<12-char-slug>` = 17 bytes (safe margin)
- Fallback format: `grp_<24-hex-chars>` = 28 bytes (at limit)

### Deterministic Derivation
- Same room ID always produces same memo
- Enables reliable on-chain group identification
- No need to store memo separately for derivation

### Lookup Table Benefits
- Fast O(1) lookups by memo or transaction hash
- Avoids re-querying blockchain for common operations
- Enables reverse lookup (tx_hash → group_id)

### Security Considerations
- Memo is public on-chain (by design)
- Group IDs are pseudonymous, not sensitive
- RLS policies ensure authenticated inserts only
- Memo validation prevents injection attacks

## Testing

### Manual Testing

1. Create a room via POST `/api/rooms`
2. Verify `memo_group_id` is returned in response
3. Check database for `memo_group_id` in `rooms` table
4. Check database for entry in `group_tx_memos` table
5. Lookup group via GET `/api/stellar/memo?memo=grp_xxx`
6. Verify room via GET `/api/rooms/[roomId]/verify`
7. Confirm `memoVerified: true` in verification response

### API Smoke Test

```bash
# Test memo lookup with valid memo
curl "http://localhost:3000/api/stellar/memo?memo=grp_test123"

# Test memo lookup with invalid memo
curl "http://localhost:3000/api/stellar/memo?memo=invalid"

# Test memo lookup with missing parameter
curl "http://localhost:3000/api/stellar/memo"
```

## Future Enhancements

- [ ] Add memo-based group search in frontend
- [ ] Implement memo-based group discovery
- [ ] Add memo validation to all group-related endpoints
- [ ] Consider using HASH memo for additional privacy
- [ ] Add memo rotation support for group renames
