# AnonChat 🌌

**AnonChat** is a **Stellar-based anonymous communication platform** that allows users to create groups and chat freely with strangers — **without revealing identity**. Access is powered by **Web3 wallet authentication**, ensuring privacy, decentralization, and user sovereignty.

> Speak freely. Stay anonymous. Powered by Stellar.

---

## 🚀 What is AnonChat?

AnonChat is a decentralized, privacy-first chat application where:

* Users **connect using a Web3 wallet**
* No personal data, email, or phone number is required
* Users can **create or join anonymous groups**
* Messages are **end-to-end encrypted**
* Identity is never exposed — not even to us

The platform leverages **Stellar blockchain primitives** to ensure transparency, decentralization, and trustless authentication.

---

## 🌟 Why Stellar?

AnonChat is **built on Stellar** because it offers:

* ⚡ **Fast & low-cost transactions**
* 🌍 **Global, borderless infrastructure**
* 🔐 **Secure public-key cryptography**
* 🧩 Perfect fit for **wallet-based authentication**

Stellar enables AnonChat to remain lightweight, scalable, and censorship-resistant.


---

## 🧩 Core Features

### 🔒 Complete Anonymity

* No usernames, emails, or profile data
* No tracking or surveillance
* Zero-knowledge architecture

### 🔐 End-to-End Encryption

* Messages are encrypted client-side
* Only chat participants can read messages

### 🌐 Decentralized Groups

* Create or join anonymous chat rooms
* No central authority or moderation bias

### 👛 Web3 Wallet Authentication

* Login using a supported Web3 wallet
* Wallet address acts as a **pseudonymous identity**

### ⚡ Lightning Fast Messaging

* Real-time chat with minimal latency

### 🛡 Privacy First

* No IP logging
* No data selling or analytics exploitation

---

## 🏗️ Tech Stack

### Frontend

* **Next.js / React**
* **Tailwind CSS**
* **Web3 Wallet Integration**

### Blockchain

* **Stellar Blockchain** ⭐
* Wallet-based authentication
* Public-key cryptography

### Backend

* Node.js / Serverless APIs
* WebSocket / Real-time messaging
* Encrypted message storage

### Hosting

* **Vercel**

---

## 🔐 Security Model

* End-to-end encrypted messages
* Zero-knowledge design
* Decentralized architecture
* Open-source codebase (auditable)
* No identity or metadata storage

---



## 🏛️ Architecture

AnonChat is built with a modern, scalable architecture:

* **Frontend**: Next.js 16 with React 19, TypeScript, and Tailwind CSS
* **Authentication**: Supabase Auth with Web3 wallet integration
* **Database**: Supabase (PostgreSQL) for user profiles and chat data
* **Real-time**: Supabase Realtime for instant messaging
* **Styling**: Tailwind CSS with Radix UI components
* **Deployment**: Vercel for frontend hosting

### Project Structure

```
AnonChat/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   ├── auth/              # Authentication pages
│   ├── chat/              # Chat interface
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Landing page
├── components/            # React components
├── lib/                   # Utility functions
│   └── supabase/         # Supabase client setup
├── scripts/              # Database migration scripts
│   ├── 001_create_profiles.sql
│   └── 002_create_profile_trigger.sql
├── public/               # Static assets
└── styles/               # Global styles
```

---

## 🛠️ Installation & Setup

### Prerequisites

Before you begin, ensure you have the following installed:

* **Node.js** >= 18.x
* **pnpm** (recommended) or npm/yarn
* A **Supabase account** (free tier works)
* A **Stellar-compatible wallet** (for testing)

### Step 1: Clone the Repository

```bash
git clone https://github.com/your-username/anonchat.git
cd AnonChat
```

### Step 2: Install Dependencies

We recommend using **pnpm** for faster installs:

```bash
pnpm install
```

Or with npm:

```bash
npm install
```

### Step 3: Supabase Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com)
2. **Run database migrations**:
   - Go to your Supabase project dashboard
   - Navigate to SQL Editor
   - Run the SQL scripts in order:
     - `scripts/001_create_profiles.sql`
     - `scripts/002_create_profile_trigger.sql`

### Step 4: Environment Variables

Create a `.env.local` file in the root directory:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Stellar Configuration
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_APP_NAME=AnonChat
```

**Where to find Supabase credentials:**
- Go to your Supabase project settings
- Navigate to **API** section
- Copy the **Project URL** and **anon/public key**

### Step 5: Run Development Server

```bash
pnpm dev
```

The app will be available at:

```
http://localhost:3000
```

### Troubleshooting

**Issue**: `Module not found` errors
- **Solution**: Delete `node_modules` and lock files, then reinstall:
  ```bash
  rm -rf node_modules pnpm-lock.yaml
  pnpm install
  ```

**Issue**: Supabase connection errors
- **Solution**: Verify your `.env.local` has correct credentials
- Check if your Supabase project is active

**Issue**: Build failures
- **Solution**: Ensure Node.js version >= 18.x:
  ```bash
  node --version
  ```

---

## 🧪 Roadmap

* [ ] Group ownership via Stellar accounts
* [ ] On-chain group identity
* [ ] DAO-based moderation
* [ ] Encrypted file sharing
* [ ] Mobile PWA support

---

## 🤝 Contributing

We welcome contributions from the community! Please read our [CONTRIBUTING.md](CONTRIBUTING.md) guide for detailed instructions on:

* Setting up your development environment
* Code style and standards
* Branching strategy
* Submitting pull requests
* Issue guidelines

**Quick Start:**

1. Fork the repository
2. Create a feature branch: `git checkout -b fix-[issue-number]`
3. Make your changes following our code standards
4. Test your changes locally
5. Commit with clear messages: `git commit -m "Fix: [description]"`
6. Push and open a pull request

**Important**: Only create a pull request if you were assigned to the issue.

---

## 📜 License

This project is licensed under the **MIT License**.

---

## 🌐 Live Demo

🔗 [https://anonchat-one.vercel.app](https://anonchat-one.vercel.app)

---

## 💜 Credits

Built with privacy in mind and powered by **Stellar Blockchain**.

> If you believe communication should be free, anonymous, and decentralized — AnonChat is for you.

---

### ⭐ Don’t forget to star the repository if you like the project!
