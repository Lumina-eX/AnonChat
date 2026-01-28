"use client";

import { connect, disconnect, getPublicKey } from "@/app/stellar-wallet-kit";
import { useEffect, useState } from "react";

export default function ConnectWallet() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function showConnected() {
    const key = await getPublicKey();
    if (key) {
      setPublicKey(key);
    } else {
      setPublicKey(null);
    }
    setLoading(false);
  }

  async function showDisconnected() {
    setPublicKey(null);
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      const key = await getPublicKey();
      if (key) {
        setPublicKey(key);
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div id="connect-wrap" className="wrap" aria-live="polite">
      {!loading && publicKey && (
        <div className="flex gap-5">
          <div
            className="ellipsis bg-gradient-to-r from-primary to-accent p-2 rounded-2xl"
            title={publicKey}
          >
            {publicKey.slice(0, 4)}...${publicKey.slice(-4)}
          </div>
          <button
            className="bg-gradient-to-r from-primary/50 to-accent/70 p-2 rounded-xl"
            onClick={() => disconnect(showDisconnected)}
          >
            Disconnect
          </button>
        </div>
      )}

      {!loading && !publicKey && (
        <>
          <button
            onClick={() => connect(showConnected)}
            // className=" text-white px-6 py-2 rounded-lg transition font-medium"
            className="bg-gradient-to-r from-primary to-accent p-2 rounded-2xl px-8"
          >
            Connect
          </button>
        </>
      )}
    </div>
  );
}
