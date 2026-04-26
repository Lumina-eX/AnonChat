# AnonChat 🌌

**AnonChat** is a **Stellar-based anonymous communication platform** that lets users create and join chat groups without revealing their identity. Authentication is powered by Web3 wallet signatures — no email, no phone number, no personal data.

> Speak freely. Stay anonymous. Powered by Stellar.

[![CI](https://github.com/your-username/AnonChat/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/AnonChat/actions/workflows/ci.yml)
[![Vercel](https://img.shields.io/badge/deployed-Vercel-black?logo=vercel)](https://anonchat-one.vercel.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.9.0-brightgreen)](https://nodejs.org)

---

## 🌐 Live Demo

🔗 **[https://anonchat-one.vercel.app](https://anonchat-one.vercel.app)**

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
| Encrypted file references | Infrastructure and API routes for encrypted file metadata |
| Responsive UI | Mobile-first design, dark/light mode |
| WebSocket support | Real-time connection layer alongside Supabase Realtime |
| CI pipeline | Lint + build on every pull request via GitHub Actions |

### 🚧 Planned / not yet implemented

| Feature | Status |
|---|---|
| End-to-end message encryption | Infrastructure exists (`is_encrypted` flag), client-side encryption not wired up |
| Encrypted file sharing (complete) | API routes exist, upload/download UI not built |
| DAO-based moderation | Dispute resolution is manual; on-chain DAO voting not implemented |
| Group ownership via Stellar accounts | Metadata anchoring works; full on-chain ownership model not implemented |
| Mobile PWA | Responsive design works; PWA manifest not configured |
| Message pagination UI | API supports cursor-based pagination; infinite scroll not built |

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

A full escrow lifecycle built on Stellar: create, fund (on-chain payment), release to beneficiary, refund to initiator, raise a dispute, or resolve it.

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript 5, Tailwind CSS 4 |
| UI Components | Radix UI primitives (30+ components) |
| Web3 | Stellar Wallets Kit (`@creit.tech/stellar-wallets-kit`) |
| Auth | Supabase Auth + Stellar Ed25519 signature verification |
| Database | Supabase (PostgreSQL) with Row-Level Security |
| Real-time | Supabase Realtime + WebSocket server |
| Blockchain | Stellar SDK v13 (`@stellar/stellar-sdk`) |
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
- **npm** (comes with Node) or **pnpm** >= 8
- **Supabase account** — [supabase.com](https://supabase.com) (free tier works)
- **Stellar testnet account** — get one free at [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test)
- **Freighter wallet** browser extension — [freighter.app](https://freighter.app) (for testing)

### 1. Clone and install

```bash
git clone https://github.com/your-username/AnonChat.git
cd AnonChat
npm install
```

> The project uses `npm` as its primary package manager. `pnpm` also works — use `pnpm install` if you prefer.

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. In **Settings → API**, copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`

### 3. Configure environment variables

Create `.env.local` in the project root:

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
```

> **Never commit `.env.local`** — it is already in `.gitignore`.  
> For `STELLAR_SOURCE_SECRET`, create a funded testnet account at [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test) and fund it with the Friendbot.

### 4. Run database migrations

Open the **Supabase SQL Editor** (Dashboard → SQL Editor) and run each script in order:

```
scripts/001_create_profiles.sql
scripts/002_create_profile_trigger.sql
scripts/003_create_invites.sql
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

Or, if you have direct database access via `psql`:

```bash
export DATABASE_URL="postgresql://postgres:<password>@<host>:5432/postgres"
for f in scripts/0*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app is ready.

To also run the WebSocket server alongside Next.js:

```bash
npm run dev:all
```

### 6. Verify the setup

1. Open the app and click **Connect** in the header.
2. Approve the connection in Freighter.
3. Sign the authentication message when prompted.
4. You should see your wallet address displayed and a success toast.
5. Navigate to `/chat` and create a group — you'll see the estimated Stellar network fee before confirming.

---

## 🧪 Testing

```bash
# Lint
npm run lint

# Production build (catches type errors)
npm run build

# API smoke tests for member removal voting
npm run test:vote-remove

# WebSocket connectivity check
npm test
```

The CI pipeline runs lint and build on every pull request. See `.github/workflows/ci.yml`.

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

---

## 📖 Documentation

- **[User Guide](docs/user-guide.md)** — Step-by-step guide for new users: installing Freighter, funding a testnet account, connecting, creating groups, and chatting.
- **[Setup Guide](SETUP.md)** — Detailed local development setup.
- **[Contributing](CONTRIBUTING.md)** — How to contribute.
- **[WebSocket Integration](WEBSOCKET_INTEGRATION.md)** — WebSocket server details.
- **[Database Migrations](scripts/MIGRATIONS_README.md)** — Migration order and instructions.

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork → create branch `fix-[issue-number]` or `feat-[description]`
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
