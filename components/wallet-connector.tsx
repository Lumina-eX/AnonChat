"use client";

import {
  disconnect,
  getPublicKey,
  signMessage,
} from "@/app/stellar-wallet-kit";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { WalletAddress } from "@/components/wallet-address";
import { WalletSelectionModal } from "@/components/wallet-selection-modal";
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

  async function handleConnectSuccess() {
    try {
      const key = await getPublicKey();
      if (key) {
        await authenticateWithWallet(key);
      } else {
        // Triggered if the wallet kit returns without a key
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

  // Restore wallet state on mount
  useEffect(() => {
    (async () => {
      try {
        const key = await getPublicKey();
        if (key) setPublicKey(key);
      } catch (error) {
        console.error("Initial wallet check failed:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div id="connect-wrap" className="wrap" aria-live="polite">
      {!loading && publicKey && (
        <div className="flex gap-5">
          <div
            className="ellipsis bg-linear-to-r from-primary to-accent p-2 rounded-2xl"
            title={publicKey}
          >
            <WalletAddress
              address={publicKey}
              className="max-w-[8.5rem]"
              addressClassName="text-primary-foreground"
            />
          </div>
          <button
            className="bg-linear-to-r from-primary/50 to-accent/70 p-2 rounded-xl h-10 px-4 self-center transition-opacity hover:opacity-80"
            onClick={handleDisconnect}
          >
            Disconnect
          </button>
        </div>
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
