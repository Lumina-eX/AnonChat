# SEP-10 Web Authentication

AnonChat supports Stellar Web Authentication ([SEP-10](https://stellar.org/protocol/sep-10))
as an alternative to the nonce + message-signature login flow. Both flows use a
challenge/response exchange and issue the same wallet-bound application session
(JWT access token + refresh token cookies).

## Configuration

| Variable | Required | Purpose |
|----------|----------|---------|
| `SEP10_SERVER_SECRET` | Yes | Secret key (`S...`) used to sign challenge transactions |
| `SEP10_HOME_DOMAIN` | No | Home domain embedded in the challenge (defaults to `NEXT_PUBLIC_APP_URL` host, then `anonchat.app`) |
| `SEP10_WEB_AUTH_DOMAIN` | No | `web_auth_domain` value (defaults to `SEP10_HOME_DOMAIN`) |
| `SEP10_NETWORK_PASSPHRASE` | No | Network passphrase (defaults to testnet unless `STELLAR_NETWORK=mainnet`) |
| `SEP10_CHALLENGE_TTL_SECONDS` | No | Challenge lifetime in seconds (default `300`) |
| `SEP10_RATE_LIMIT` | No | Requests allowed per window, per IP/account (default `20`) |
| `SEP10_RATE_WINDOW_SECONDS` | No | Rate-limit window in seconds (default `60`) |

Replay protection uses Redis when `REDIS_URL` is set and falls back to an
in-memory store otherwise.

## Flow

1. The wallet requests a challenge for its account:

   ```http
   GET /api/auth/sep10/challenge?account=G...
   ```

   ```json
   {
     "transaction": "<base64 TransactionEnvelope>",
     "networkPassphrase": "Test SDF Network ; September 2015",
     "expiresIn": 300
   }
   ```

   `POST` with `{ "account": "G..." }` is also supported.

2. The wallet parses the transaction and signs it, then submits the signed
   envelope:

   ```http
   POST /api/auth/sep10/token
   { "transaction": "<signed base64 TransactionEnvelope>" }
   ```

   Optional `account` (or `walletAddress`) asserts the expected wallet.

3. On success the server returns a SEP-10 token response and sets the wallet
   auth cookies:

   ```json
   {
     "token": "<JWT access token>",
     "token_type": "Bearer",
     "walletAddress": "G...",
     "sessionId": "uuid",
     "expires_in": 900
   }
   ```

## Validation rules

- The challenge is built and signed by the server.
- The server signature, structure, time bounds and network passphrase are
  validated by the Stellar SDK before the wallet signature is considered.
- The wallet signature must match the challenge's client account and, when
  supplied, the expected account.
- Challenges are single-use; a replayed transaction hash is rejected with
  `401`.
- Expired, tampered, wrong-network and unsigned challenges return `401` with a
  generic message.
- Failed authentication never creates an application session.
- Authentication events are logged with the wallet prefix, home domain and
  challenge hash (`sep10.challenge_issued`, `sep10.authentication_succeeded`,
  `sep10.authentication_failed`, `sep10.replay_rejected`).

## Errors

| Status | Meaning |
|--------|---------|
| `400` | Missing/invalid account or transaction payload |
| `401` | Invalid, expired, tampered, replayed or mismatched challenge |
| `429` | Rate limit exceeded |
| `503` | SEP-10 is not configured on the server |
