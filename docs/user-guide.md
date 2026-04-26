# AnonChat User Guide

Welcome to AnonChat — an anonymous, Stellar-powered chat platform. This guide walks you through everything you need to get started, from installing a wallet to chatting in your first group.

**No email. No phone number. No identity required.**

---

## Table of Contents

1. [What you need](#1-what-you-need)
2. [Install the Freighter wallet](#2-install-the-freighter-wallet)
3. [Create and fund a testnet account](#3-create-and-fund-a-testnet-account)
4. [Connect your wallet to AnonChat](#4-connect-your-wallet-to-anonchat)
5. [Navigate the chat interface](#5-navigate-the-chat-interface)
6. [Create a group](#6-create-a-group)
7. [Join an existing group](#7-join-an-existing-group)
8. [Send and receive messages](#8-send-and-receive-messages)
9. [View group members](#9-view-group-members)
10. [Disconnect your wallet](#10-disconnect-your-wallet)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. What you need

| Requirement | Details |
|---|---|
| Browser | Chrome, Brave, Firefox, or Edge (desktop) |
| Wallet extension | Freighter (recommended), xBull, or Lobstr |
| Stellar account | A testnet account funded with test XLM |
| Internet connection | Required for real-time messaging and blockchain operations |

> **Mainnet vs. Testnet:** The live demo runs on Stellar **testnet**. Testnet XLM has no real-world value — it's free and safe to experiment with.

---

## 2. Install the Freighter wallet

Freighter is a browser extension wallet for the Stellar network. It's the easiest way to authenticate with AnonChat.

**Steps:**

1. Go to [freighter.app](https://freighter.app) and click **Add to Chrome** (or your browser).
2. Follow the browser prompt to install the extension.
3. Click the Freighter icon in your browser toolbar to open it.
4. Choose **Create new wallet**.
5. Write down your **12-word recovery phrase** and store it somewhere safe — this is the only way to recover your wallet.
6. Set a password for the extension.
7. Your wallet is ready. You'll see your Stellar public key (starts with `G...`) on the home screen.

> **Other supported wallets:** xBull ([xbull.app](https://xbull.app)) and Lobstr ([lobstr.co](https://lobstr.co)) also work with AnonChat. The connection flow is the same.

---

## 3. Create and fund a testnet account

Your Freighter wallet generates a Stellar keypair, but the account doesn't exist on the network until it's funded. On testnet, you can get free XLM instantly.

**Steps:**

1. Open Freighter and switch to **Testnet**:
   - Click the network name at the top (it may say "Mainnet").
   - Select **Test SDF Network / Testnet**.

2. Copy your public key from Freighter (the `G...` address).

3. Open [Stellar Laboratory — Friendbot](https://laboratory.stellar.org/#account-creator?network=test).

4. Paste your public key into the **Public Key** field and click **Get test network lumens**.

5. You'll receive **10,000 test XLM** — more than enough to use AnonChat.

6. Back in Freighter, your balance should now show `10,000 XLM`.

> **Why do I need XLM?** Creating a group on AnonChat submits a small transaction to the Stellar network to anchor the group's metadata. The fee is tiny (around 0.0000100 XLM), but your account must exist on-chain first.

---

## 4. Connect your wallet to AnonChat

**Steps:**

1. Open [AnonChat](https://anonchat-one.vercel.app) in your browser.

2. Click the **Connect** button in the top-right corner of the header.

3. A wallet selection dialog appears. Choose **Freighter** (or your preferred wallet).

4. Freighter will ask you to approve the connection — click **Connect**.

5. AnonChat will request a **signature** to verify you own the wallet:
   - A toast notification appears: *"Sign the message in your wallet to verify ownership…"*
   - Freighter opens automatically with a signing request.
   - Review the message (it will look like `anonchat:1234567890:uuid`) and click **Sign**.

6. On success, your wallet address appears in the header (shortened, e.g. `GABC...XYZ`).
   - First-time users see: *"Wallet verified & account created!"*
   - Returning users see: *"Wallet verified — welcome back!"*

> **What just happened?** The server generated a one-time nonce, you signed it with your private key, and the server verified the signature using your public key. No password was ever sent. This is the entire authentication flow.

---

## 5. Navigate the chat interface

After connecting, click **Start Chatting Now** on the landing page, or go directly to [/chat](https://anonchat-one.vercel.app/chat).

The chat interface has two main areas:

**Left sidebar — Room list**
- Shows all groups you have access to.
- Displays the last message preview and unread count for each room.
- Use the search bar at the top to filter rooms by name.
- **Create Group** and **Join Group** buttons are at the top of the sidebar.

**Right panel — Conversation**
- Shows messages for the selected room.
- Type in the input at the bottom and press **Enter** or click the send button.
- Message status indicators: sending → sent → delivered → read.

**On mobile:** The sidebar and conversation panel stack. Use the back arrow to return to the room list.

---

## 6. Create a group

Creating a group anchors its metadata on the Stellar blockchain. A small network fee applies.

**Steps:**

1. In the chat sidebar, click **Create Group**.

2. If your wallet isn't connected yet, the modal will prompt you to connect first.

3. Enter a **Group Name** (e.g. "Shadow Explorers").

4. The modal shows your connected wallet address and the **estimated network fee** (fetched live from Stellar, typically ~0.0000100 XLM).

5. Click **Create Group**.

6. Wait a few seconds while the transaction is submitted to Stellar.

7. On success, a toast confirms: *"Group 'Shadow Explorers' created successfully! Network charged: 0.0000100 XLM."*

8. The new group appears in your room list immediately.

> **What gets anchored on-chain?** A SHA-256 hash of the group's metadata (name, description, creator, timestamp) is embedded in a Stellar transaction memo. Anyone can verify the group's integrity by checking this hash against the blockchain.

---

## 7. Join an existing group

You can join a group using either an **invite code** or the **group ID**.

**Steps:**

1. Click **Join Group** in the chat sidebar.

2. Choose your method:
   - **Invite Code** — paste a code shared by a group member (format: `X7b-tnk-...`)
   - **Group ID** — paste the room's UUID directly

3. Enter the code or ID and click **Join Group**.

4. On success, the group appears in your room list.

> **Getting an invite code:** Currently, group creators share their group ID directly. Copy it from the room details or ask the group creator to share it with you.

---

## 8. Send and receive messages

**Sending a message:**

1. Select a room from the sidebar.
2. Click the message input at the bottom of the conversation panel.
3. Type your message and press **Enter** or click the **send** button (arrow icon).
4. Your message appears immediately with a "sending" indicator, then updates to "sent" once confirmed.

**Message status:**
- ⏳ **Sending** — being submitted to the server
- ✓ **Sent** — saved to the database
- ✓✓ **Delivered** — received by the room
- ✓✓ **Read** — seen by other members

**Real-time updates:** Messages from other members appear instantly via Supabase Realtime — no need to refresh.

> **Rate limiting:** To prevent spam, there is a per-wallet message rate limit. If you send too many messages too quickly, you'll receive a "rate limit exceeded" error. Wait a moment and try again.

---

## 9. View group members

1. Open a room in the conversation panel.
2. Click the **Users** icon (👥) in the room header, or the **⋮** (more options) button.
3. The **Room Members** dialog opens, showing all current members by their wallet address.

**Voting to remove a member:**

If a member is being disruptive, other members can vote to remove them:

1. In the Room Members dialog, find the member you want to remove.
2. Click **Vote to Remove** next to their address.
3. When a majority of members have voted to remove the same member, they are automatically removed from the room and can no longer send messages.

> Removal is wallet-based — the removed wallet address is blocked from the room. The member can still read public rooms but cannot post.

---

## 10. Disconnect your wallet

1. Click your wallet address in the header.
2. Click **Disconnect**.
3. Your session ends and the wallet address is cleared from the UI.

You can reconnect at any time by clicking **Connect** again. Your rooms and message history are preserved.

---

## 11. Troubleshooting

### "Failed to get nonce" or "Authentication failed"

- Make sure Freighter is unlocked (enter your extension password if prompted).
- Check that you're on the correct network (Testnet for the demo).
- Try refreshing the page and connecting again.

### Wallet connects but no rooms appear

- Your account may not have joined any rooms yet. Click **Join Group** or **Create Group**.
- Check your browser console for errors and ensure `NEXT_PUBLIC_SUPABASE_URL` is set correctly (for self-hosted instances).

### "Failed to create group" / transaction error

- Ensure your testnet account has XLM. Re-fund it at [Stellar Friendbot](https://laboratory.stellar.org/#account-creator?network=test).
- The Stellar network fee is tiny but your account must have a non-zero balance.
- Check that `STELLAR_SOURCE_SECRET` is set in your environment (for self-hosted instances).

### Messages not appearing in real-time

- Check your internet connection.
- Supabase Realtime requires WebSocket support. Make sure your browser or network isn't blocking WebSocket connections.
- Try refreshing the page.

### Freighter doesn't open for signing

- Make sure the Freighter extension is installed and unlocked.
- Some browsers block extension popups — check your browser's popup settings and allow popups from the AnonChat domain.

### I lost my recovery phrase

- Unfortunately, there is no way to recover a Stellar wallet without the recovery phrase. Create a new wallet and fund it again from Friendbot.

---

## Need help?

- Open an issue on [GitHub](https://github.com/your-username/AnonChat/issues)
- See the [README](../README.md) for project overview and setup instructions
- See [SETUP.md](../SETUP.md) for developer setup

---

*AnonChat collects no personal data. Your wallet address is your only identity on the platform.*
