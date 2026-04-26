# AnonChat 🌌

**AnonChat** is a **Stellar-based anonymous communication platform** that lets users create and join chat groups without revealing their identity. Authentication is powered by Web3 wallet signatures — no email, no phone number, no personal data.

> Speak freely. Stay anonymous. Powered by Stellar.

<!-- Replace `your-org/AnonChat` with the actual GitHub repository path -->
[![CI](https://github.com/your-org/AnonChat/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/AnonChat/actions/workflows/ci.yml)
[![Vercel](https://img.shields.io/badge/deployed-Vercel-black?logo=vercel)](https://anonchat-one.vercel.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.9.0-brightgreen)](https://nodejs.org)

> **Badge setup:** After pushing to GitHub, replace `your-org/AnonChat` in the CI badge URL above with your actual GitHub username/org and repository name. The Vercel badge will update automatically once the project is deployed.

---

## 🌐 Live Demo

🔗 **[https://anonchat-one.vercel.app](https://anonchat-one.vercel.app)**

> If the demo is unavailable, the app requires a live Supabase project and Stellar testnet account — see [Getting Started](#️-getting-started) to run it locally.

---

## 📋 Current Status

### ✅ Implemented and working

| Feature | Notes |
|---|---|
| Stellar wallet authentication | Ed25519 signature verification, nonce-based replay protection |
| Anonymous chat rooms | Create public groups, list and search rooms |
| Real-time messaging | Supabase Realtime, message status (sending → sent → delivered → read) |
| Blockchain metadata anchoring | Group metadata SHA-256 hash submitted to Stellar via self-payment memo |
| On-chain group verification | Verify a room's metadata hash against its Stellar transaction |
| Member management | View members, vote to remove members (majority threshold) |
| Escrow system | Full lifecycle: create → fund → release / refund / dispute → resolve |
| Rate limiting | Per-wallet message rate limiting with 429 responses |
| Encrypted file references | API routes and DB schema for encrypted file metadata |
| Responsive UI | Mobile-first design, dark/light mode |
| WebSocket server | Real-time presence and typing indicators alongside Supabase Realtime |
| CI pipeline | Lint + build on every pull request via GitHub Actions |

### 🚧 Planned / not yet implemented

| Feature | Notes |
|---|---|
| End-to-end message encryption | DB flag (`is_encrypted`) and schema exist; client-side encryption not wired up |
| Encrypted file sharing (UI) | API routes exist; upload/download UI not built |
| DAO-based moderation | Dispute resolution is currently manual; on-chain DAO voting not implemented |
| Group ownership via Stellar accounts | Metadata anchoring works; full on-chain ownership model not implemented |
| Mobile PWA | Responsive design works; PWA manifest not configured |
| Message pagination UI | API supports cursor-based pagination; infinite scroll not built |
| Test coverage reporting | Unit test file exists (`lib/auth/stellar-verify.test.ts`); no test runner (Jest/Vitest) is configured yet |

---

## 📸 Screenshots

> Screenshots will be added once the live deployment is stable. To preview the UI locally, follow the [Getting Started](#️-getting-started) steps and open `http://localhost:3000`.

**To contribute screenshots:**
1. Run the app locally (`npm run dev`)
2. Take screenshots of: landing page, wallet connect flow, chat room list, active chat, create group modal
3. Save them to `public/screenshots/` and open a PR

---

## 🧩 Core Features

### 👛 Web3 Wallet Authentication

Connect with any Stellar-compatible wallet (Freighter, xBull, Lobstr, etc.). The server issues a one-time nonce, your wallet signs it, and the signature is verified server-side using Ed25519 — no password ever touches the server.

### 🌐 Anonymous Chat Rooms

Create or join public chat rooms. Your wallet address is your pseudonymous identity. No display name, no avatar, no profile.

### ⭐ Stellar Blockchain Anchoring

When you create a group, its metadata is hashed (SHA-256) and submitted to the Stellar network as a self-payment transaction memo. Anyone can independently verify the group's integrity on-chain.

### 🗳️ Wallet-Based Member Removal

Room members can vote to remove another member. When a majority votes, the member is removed and can no longer send messages in that room.

### 💰 Escrow System

A full escrow lifecycle built on Stellar: create, fund (on-chain payment), release to beneficiary, refund to initiator, raise a dispute, or resolve it. No smart contracts — escrow state is tracked in Supabase and settled via Stellar payments from the service wallet.

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.0.10, React 19.2.0, TypeScript 5, Tailwind CSS 4 |
| UI Components | Radix UI primitives (30+ components), shadcn/ui |
| Web3 | Stellar Wallets Kit v1.9.5 (`@creit.tech/stellar-wallets-kit`) |
| Auth | Supabase Auth + Stellar Ed25519 signature verification |
| Database | Supabase (PostgreSQL) with Row-Level Security |
| Real-time | Supabase Realtime + WebSocket server (ws v8.19.0) |
| Blockchain | Stellar SDK v13.3.0 (`@stellar/stellar-sdk`) |
| Rate limiting | Redis v4.7.0 (optional; falls back to in-memory) |
| Hosting | Vercel |
| CI/CD | GitHub Actions |

---

## 🏛️ Architecture

```mermaid
flowchart TB
    subgraph Client["👤 Client"]
        Wallet[Stellar Wallet\nFreighter / xBull / Lobstr]
        Browser[Browser]
    end

    subgraph Frontend["⚛️ Next.js App"]
        UI[React Components]
        Auth[Wallet Auth Module]
        Chat[Chat Interface]
    end

    subgraph Backend["🔧 API Routes"]
        AuthAPI[/api/auth]
        RoomsAPI[/api/rooms]
        MessagesAPI[/api/messages]
        EscrowAPI[/api/escrow]
        StellarAPI[/api/stellar]
    end

    subgraph Data["💾 Supabase"]
        DB[(PostgreSQL)]
        Realtime[Realtime Engine]
        RLS[Row-Level Security]
    end

    subgraph Blockchain["⭐ Stellar Network"]
        Horizon[Horizon API]
        Testnet[Testnet / Mainnet]
    end

    Wallet -->|Sign nonce| Auth
    Browser --> UI
    UI --> Chat
    Auth --> AuthAPI
    Chat --> MessagesAPI
    Chat --> RoomsAPI
    RoomsAPI --> StellarAPI
    EscrowAPI --> Horizon
    StellarAPI --> Horizon
    AuthAPI --> DB
    MessagesAPI --> Realtime
    Realtime --> DB
    DB --> RLS
```

---

## 🛠️ Getting Started

### Prerequisites

- **Node.js** >= 20.9.0 — [nodejs.org](https://nodejs.org)
- **npm** (bundled with Node) or **pnpm** >= 8
- **Supabase account** — [supabase.com](https://supabase.com) (free tier works)
- **Stellar testnet account** — create and fund one at [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test)
- **Freighter wallet** browser extension — [freighter.app](https://freighter.app) (for testing auth)

### 1. Clone and install

```bash
git clone https://github.com/your-org/AnonChat.git
cd AnonChat
npm install
```

> `pnpm install` also works if you prefer pnpm.

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. In **Settings → API**, copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`

### 3. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

```env
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Stellar (required for blockchain features)
STELLAR_NETWORK=testnet
STELLAR_SOURCE_SECRET=S...your-testnet-secret-key...
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_TRANSACTION_TIMEOUT=30000

# App
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_APP_NAME=AnonChat

# Redis (optional — rate limiting falls back to in-memory without this)
# REDIS_URL=redis://localhost:6379
```

> **Never commit `.env.local`** — it is already in `.gitignore`.  
> For `STELLAR_SOURCE_SECRET`, create a funded testnet account at [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test) and fund it via Friendbot.

### 4. Run database migrations

The `scripts/` folder contains 15 SQL migration files. Run them in the order below — the numeric prefix determines the order, but note that some share the same prefix and must both be applied.

**Option A — Supabase SQL Editor** (Dashboard → SQL Editor → New query):

Run each file in this order:

```
scripts/001_create_profiles.sql
scripts/002_create_profile_trigger.sql
scripts/003_create_invites.sql
scripts/003_add_blockchain_fields.sql
scripts/003_room_members_and_removal_votes.sql
scripts/004_create_room_members.sql
scripts/005_add_last_read_to_room_members.sql
scripts/006_unread_view.sql
scripts/007_create_group_membership.sql
scripts/007_secure_messages_rls.sql
scripts/008_create_groups.sql
scripts/009_encrypted_file_references.sql
scripts/010_message_status.sql
scripts/011_group_tx_memo_map.sql
scripts/012_escrow_tables.sql
```

**Option B — psql** (if you have direct database access):

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
  psql "$DATABASE_URL" -f "$f"
done
```

> The Supabase connection string is in your project: **Settings → Database → Connection string**.

### 5. Start the development server

```bash
# Next.js only (port 3000)
npm run dev

# Next.js + WebSocket server (ports 3000 and 3001)
npm run dev:all
```

Open [http://localhost:3000](http://localhost:3000).

### 6. Verify the setup

1. Click **Connect** in the header.
2. Approve the connection in Freighter.
3. Sign the authentication message when prompted.
4. Your wallet address should appear in the header — that confirms auth is working.
5. Navigate to `/chat` and create a group. You'll see the estimated Stellar network fee before confirming.

---

## 🧪 Testing

There is no automated test runner configured yet. The following commands are available:

```bash
# ESLint — catches code quality issues
npm run lint

# TypeScript compilation — catches type errors across the whole project
npm run build

# WebSocket connectivity check — requires the WS server to be running
npm test

# API smoke tests for member removal voting — requires a running dev server
npm run test:vote-remove
```

A unit test file exists at `lib/auth/stellar-verify.test.ts` (covers Ed25519 signature verification and nonce management) but requires a test runner (Jest or Vitest) to be wired up. See the [roadmap](#️-roadmap) — adding a proper test runner and CI coverage reporting is a planned improvement.

The CI pipeline (`.github/workflows/ci.yml`) runs `npm run lint` and `npm run build` on every pull request.

---

## 🐳 Docker

```bash
docker build -t anonchat .
docker run -p 3000:3000 --env-file .env.local anonchat
```

---

## 🗺️ Roadmap

- [ ] Client-side end-to-end message encryption
- [ ] Encrypted file sharing (upload/download UI)
- [ ] DAO-based moderation (on-chain dispute resolution)
- [ ] Group ownership via Stellar accounts
- [ ] Mobile PWA support
- [ ] Message pagination UI (infinite scroll)
- [ ] Wire up Jest/Vitest test runner and add CI coverage reporting
- [ ] Screenshots in README

---

## 📖 Documentation

- **[User Guide](docs/user-guide.md)** — Installing Freighter, funding a testnet account, connecting, creating groups, and chatting.
- **[Setup Guide](SETUP.md)** — Detailed local development setup.
- **[Contributing](CONTRIBUTING.md)** — How to contribute.
- **[WebSocket Integration](WEBSOCKET_INTEGRATION.md)** — WebSocket server architecture and message protocol.
- **[WebSocket Examples](WEBSOCKET_EXAMPLES.md)** — Code examples for connecting to the WebSocket server.
- **[Database Migrations](scripts/MIGRATIONS_README.md)** — Migration notes (note: this file lists only migrations up to 007; the full list is in this README).

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork → create a branch: `fix/issue-number` or `feat/description`
2. Make changes → run `npm run lint` and `npm run build`
3. Open a PR — only submit PRs for issues you're assigned to

---

## 📜 License

MIT — see [LICENSE](LICENSE).

---

## 💜 Credits

Built with privacy in mind, powered by the **Stellar Blockchain**.

> If you believe communication should be free, anonymous, and decentralized — AnonChat is for you.

⭐ Star the repo if you find it useful!
