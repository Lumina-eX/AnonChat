# AnonChat Project Setup Guide 🚀

This guide provides comprehensive instructions for setting up the AnonChat project locally for development.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Environment Configuration](#environment-configuration)
- [Running the Project](#running-the-project)
- [Database Setup](#database-setup)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, ensure you have the following installed on your system:

### Required Software

- **Node.js** (v18 or higher) - [Download](https://nodejs.org)
- **Git** - [Download](https://git-scm.com)
- **pnpm** (v8 or higher) - Install globally with:
  ```bash
  npm install -g pnpm
  ```

### Required Accounts

- **GitHub** account - For forking and contributing to the repository
- **Supabase** account - For database and authentication services ([Sign up](https://supabase.com))
- **Stellar Wallet** - For Web3 wallet authentication testing

### Recommended Tools

- **VS Code** - [Download](https://code.visualstudio.com)
- **PostGres Client** - For database management
- **Stellar Lab** - For testing blockchain interactions ([Link](https://stellar.expert))

---

## Initial Setup

### 1. Fork and Clone the Repository

```bash
# Fork the repository on GitHub first, then clone your fork
git clone https://github.com/YOUR-USERNAME/AnonChat.git
cd AnonChat
```

### 2. Add Upstream Remote

To keep your fork synchronized with the original repository:

```bash
git remote add upstream https://github.com/original-owner/AnonChat.git
git fetch upstream
```

### 3. Install Dependencies

Using pnpm (recommended for this project):

```bash
pnpm install
```

This will install all dependencies listed in `package.json`, including:
- **Next.js** - React framework
- **Tailwind CSS** - Utility-first CSS framework
- **Radix UI** - Headless UI components
- **Stellar Wallet Kit** - Web3 wallet integration
- **Supabase** - Backend services and authentication

### 4. Verify Installation

```bash
pnpm --version
node --version
```

---

## Environment Configuration

### 1. Create Environment Files

Create a `.env.local` file in the root directory for local development:

```bash
cp .env.example .env.local  # If .env.example exists, or create manually
```

### 2. Configure Supabase

Add the following environment variables to `.env.local`:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Optional: Supabase Service Role Key (for server-side operations)
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

#### Getting Supabase Credentials:

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Create a new project or select existing one
3. Navigate to **Settings** → **API**
4. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **Anon Key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **Service Role Key** → `SUPABASE_SERVICE_ROLE_KEY`

### 3. Configure Web3/Stellar Settings

Add Stellar-specific configuration to `.env.local`:

```env
# Stellar Configuration (if needed)
NEXT_PUBLIC_STELLAR_NETWORK=testnet  # Use 'testnet' for development, 'public' for production
```

### 4. Verify Environment Setup

Ensure your `.env.local` file is in the root directory and contains all required variables:

```bash
# List environment files (should show .env.local)
ls -la | grep env
```

---

## Database Setup

### 1. Initialize Supabase Database

The database schema is managed through Supabase migrations. SQL migration files are located in the `scripts/` directory:

- `001_create_profiles.sql` - Creates user profiles table
- `002_create_profile_trigger.sql` - Creates database trigger for profile creation

### 2. Execute Migrations

#### Option A: Using Supabase Dashboard (Recommended for beginners)

1. Go to [Supabase Dashboard](https://app.supabase.com) → Your Project
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy and paste the contents of `scripts/001_create_profiles.sql`
5. Click **Run**
6. Repeat for `scripts/002_create_profile_trigger.sql`

#### Option B: Using Supabase CLI (Advanced)

```bash
# Install Supabase CLI (if not already installed)
npm install -g supabase

# Login to Supabase
supabase login

# Push migrations
supabase db push
```

### 3. Verify Database Setup

Check that tables are created in Supabase:

1. Go to **Supabase Dashboard** → **Table Editor**
2. Verify `profiles` table exists with expected columns

---

## Running the Project

### 1. Development Mode

Start the development server:

```bash
pnpm dev
```

The application will be available at `http://localhost:3000`

### 2. Production Build

Build the project for production:

```bash
pnpm build
```

### 3. Start Production Server

After building, start the production server:

```bash
pnpm start
```

### 4. Linting

Check code for style violations:

```bash
pnpm lint
```

---

## Project Structure Overview

```
AnonChat/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   │   ├── auth/          # Authentication endpoints
│   │   ├── messages/      # Message handling
│   │   └── rooms/         # Chat rooms
│   ├── chat/              # Chat pages
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── components/            # Reusable React components
├── lib/                   # Utility functions and services
│   └── supabase/          # Supabase client configurations
├── public/                # Static assets
├── scripts/               # Database migration scripts
├── styles/                # Global CSS
├── package.json           # Project dependencies
├── tsconfig.json          # TypeScript configuration
└── next.config.mjs        # Next.js configuration
```

---

## Key Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend Framework** | Next.js 16 / React 19 |
| **Styling** | Tailwind CSS 4, Radix UI |
| **Language** | TypeScript 5 |
| **Web3 Auth** | Stellar Wallet Kit |
| **Backend** | Supabase (PostGres + APIs) |
| **Forms** | React Hook Form, Zod validation |
| **Real-time** | Supabase Realtime |
| **Deployment** | Vercel |

---

## Common Development Tasks

### Working on a Feature

```bash
# 1. Create a new feature branch
git checkout -b feature-[issue-number]

# 2. Make changes and test
pnpm dev

# 3. Lint and build
pnpm lint
pnpm build

# 4. Commit with proper message
git commit -m "Feat: description (#issue-number)"

# 5. Push to your fork
git push origin feature-[issue-number]

# 6. Create a Pull Request on GitHub
```

### Updating from Main Branch

```bash
# Fetch latest changes
git fetch upstream

# Rebase your branch on latest main
git rebase upstream/main

# If there are conflicts, resolve them and continue
git rebase --continue
```

---

## Testing the Application

### Manual Testing Checklist

Before submitting a PR, test locally:

- [ ] Application starts without errors: `pnpm dev`
- [ ] No console errors or warnings
- [ ] Responsive design works on mobile/tablet/desktop
- [ ] Web3 wallet connection works (if modified)
- [ ] Chat functionality works as expected
- [ ] All linting passes: `pnpm lint`
- [ ] Production build succeeds: `pnpm build`

---

## Troubleshooting

### Common Issues and Solutions

#### Issue: `pnpm install` fails

**Solution:**
```bash
# Clear pnpm cache
pnpm store prune

# Clean install
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

#### Issue: Port 3000 already in use

**Solution:**
```bash
# Run on different port
pnpm dev -- -p 3001
```

#### Issue: Supabase connection errors

**Solution:**
1. Verify `.env.local` has correct Supabase credentials
2. Check internet connection
3. Verify Supabase project is active in dashboard
4. Try refreshing Supabase auth token:
   ```bash
   supabase logout
   supabase login
   ```

#### Issue: Database migrations not applied

**Solution:**
1. Verify you're using correct Supabase project
2. Check SQL syntax in migration files
3. Try running migrations manually in Supabase Dashboard SQL Editor
4. Check Supabase logs for errors

#### Issue: TypeScript errors in IDE

**Solution:**
```bash
# Rebuild TypeScript
pnpm tsc --noEmit

# Clean and reinstall
rm -rf node_modules .next
pnpm install
pnpm build
```

#### Issue: Stellar wallet not connecting

**Solution:**
1. Ensure you're using a testnet wallet for development
2. Check wallet browser extension is installed and enabled
3. Verify `NEXT_PUBLIC_STELLAR_NETWORK` is set to `testnet`
4. Try a different wallet (Freighter, Lobstr, etc.)

### Getting Help

- **Check existing issues** on GitHub
- **Ask in discussions** or comments on related issues
- **Review documentation**: [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md)
- **Consult references**:
  - Next.js: https://nextjs.org/docs
  - Supabase: https://supabase.com/docs
  - Tailwind: https://tailwindcss.com/docs

---

## Next Steps After Setup

1. ✅ Read the [README.md](README.md) to understand the project
2. ✅ Review [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines
3. ✅ Check [design.md](design.md) for UI/UX specifications
4. ✅ Look at open issues and find one to work on
5. ✅ Follow the branch naming conventions mentioned in CONTRIBUTING.md
6. ✅ Submit your first PR!

---

## Resources

- **Stellar Documentation**: https://developers.stellar.org
- **Next.js Documentation**: https://nextjs.org/docs
- **Supabase Documentation**: https://supabase.com/docs
- **Tailwind CSS Documentation**: https://tailwindcss.com/docs
- **Radix UI Documentation**: https://www.radix-ui.com

---

**Happy Coding! 🎉**

If you encounter any issues during setup, please open an issue on GitHub with details about your environment and the error message.
