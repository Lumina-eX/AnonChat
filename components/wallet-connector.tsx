"use client";

import {
  disconnect,
  getPublicKey,
  signMessage,
  detectWalletNetwork,
  getExpectedNetwork,
} from "@/app/stellar-wallet-kit";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { WalletAddress } from "@/components/wallet-address";
import { ProfileDrawer } from "@/components/profile-drawer";
import { WalletSelectionModal } from "@/components/wallet-selection-modal";
import { WalletNetworkWarning } from "@/components/wallet-network-warning";
import { handleAppError } from "@/lib/error-handler";

export default function ConnectWallet() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const supabase = createClient();

  // ── Wallet signature login flow ───────────────────────────────────────────
  async function authenticateWithWallet(address: string) {
    setAuthenticating(true);
    try {
      // 1. Request a nonce from the server
      const nonceRes = await fetch("/api/auth/nonce", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address }),
      });

      if (!nonceRes.ok) {
        throw new Error("AUTH_SERVER_UNREACHABLE");
      }

      const { nonce } = await nonceRes.json();

      // 2. Prompt user to sign
      toast("Sign the message in your wallet to verify ownership…", {
        icon: "✍️",
        duration: 6000,
      });

      const signature = await signMessage(nonce);

      // 3. Verify signature and create session
      const loginRes = await fetch("/api/auth/wallet-login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address, signature }),
      });

      if (!loginRes.ok) {
        throw new Error("VERIFICATION_FAILED");
      }

      const { session, isNewUser } = await loginRes.json();

      // 4. Persist Supabase session on the client
      if (session) {
        await supabase.auth.setSession(session);
      }

      // Wallet JWTs are set as httpOnly cookies by the server

      setPublicKey(address);
      toast.success(
        isNewUser
          ? "Wallet verified & account created!"
          : "Wallet verified — welcome back!",
        { duration: 3000 },
      );
    } catch (err: any) {
      // The firewall strips technical details and shows clean UI feedback
      handleAppError(err, "WALLET_CONNECT");

      // Clean up wallet state so user can retry
      await disconnect();
      setPublicKey(null);
    } finally {
      setAuthenticating(false);
      setLoading(false);
    }
  }

  async function handleConnect() {
    // Immediate network check
    if (!window.navigator.onLine) {
      handleAppError(new Error("offline"), "NETWORK");
      return;
    }
    setIsModalOpen(true);
  }

  async function handleWalletConnected(address: string) {
    const detected = await detectWalletNetwork();
    const expected = getExpectedNetwork();

    if (detected !== "unknown" && detected !== expected) {
      const expectedLabel = expected === "testnet" ? "Testnet" : "Mainnet";
      const walletLabel = detected === "testnet" ? "Testnet" : "Mainnet";
      handleAppError(
        new Error(`Wallet is on ${walletLabel}. Please switch to ${expectedLabel} in your wallet extension.`),
        "NETWORK_MISMATCH"
      );
      await disconnect();
      setPublicKey(null);
      return;
    }

    await authenticateWithWallet(address);
  }

  async function handleConnectSuccess() {
    try {
      const key = await getPublicKey();
      if (key) {
        await handleWalletConnected(key);
      } else {
        handleAppError(new Error("No public key found"), "WALLET_CONNECT");
        setLoading(false);
      }
    } catch (error) {
      handleAppError(error, "WALLET_CONNECT");
      setLoading(false);
    }
  }


  async function handleDisconnect() {
    setLoading(true);
    await disconnect(async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      } catch (error) {
        console.error("Wallet JWT logout error:", error);
      }
      try {
        await supabase.auth.signOut();
      } catch (error) {
        // Silently log Supabase errors to console to avoid bothering user on exit
        console.error("Supabase signout error:", error);
      }
      setPublicKey(null);
      setLoading(false);
      toast("Wallet disconnected", { icon: "🔌", duration: 2000 });
    });
  }

  async function refreshWalletSession() {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        console.warn("[wallet-auth] session refresh failed:", res.status);
        if (res.status === 401) {
          const body = await res.json().catch(() => ({}));
          if (body?.error?.toLowerCase().includes("session expired") || body?.error?.toLowerCase().includes("signature")) {
            handleAppError(new Error("Session expired. Please re-authenticate."), "SESSION_EXPIRED");
            await disconnect();
            setPublicKey(null);
          }
        }
      }
    } catch (error) {
      console.error("[wallet-auth] session refresh error:", error);
    }
  }

  // Restore wallet state on mount; refresh JWT before access token expires
  useEffect(() => {
    (async () => {
      try {
        const key = await getPublicKey();
        if (key) {
          setPublicKey(key);
          await refreshWalletSession();
        }
      } catch (error) {
        console.error("Initial wallet check failed:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!publicKey) return;
    const intervalMs = 10 * 60 * 1000; // access token TTL is 15 minutes
    const id = window.setInterval(() => {
      void refreshWalletSession();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [publicKey]);

  return (
    <div id="connect-wrap" className="wrap" aria-live="polite">
      {!loading && publicKey && (
        <WalletNetworkWarning variant="inline" className="mb-2" />
      )}
      {!loading && publicKey && (
        <ProfileDrawer publicKey={publicKey} onDisconnect={handleDisconnect}>
          <div
            className="ellipsis cursor-pointer bg-linear-to-r from-primary to-accent p-2 rounded-2xl"
            title={publicKey}
          >
            <WalletAddress
              address={publicKey}
              className="max-w-[8.5rem]"
              addressClassName="text-primary-foreground"
            />
          </div>
        </ProfileDrawer>
      )}

      {!loading && !publicKey && (
        <button
          onClick={handleConnect}
          disabled={authenticating}
          className="bg-linear-to-r from-primary to-accent p-2 rounded-2xl px-8 disabled:opacity-60 transition-all hover:shadow-lg active:scale-95"
        >
          {authenticating ? "Verifying…" : "Connect"}
        </button>
      )}

      {loading && <div className="p-2 text-sm opacity-60">Loading…</div>}

      <WalletSelectionModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        onConnectSuccess={handleConnectSuccess}
      />
    </div>

  );
}
