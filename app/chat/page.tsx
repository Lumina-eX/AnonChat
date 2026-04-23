"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner"; // ✅ ADDED
import Image from "next/image";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import {
  PresenceIndicator,
  type PresenceStatus,
} from "@/components/presence-indicator";
import ConnectWallet from "@/components/wallet-connector";
import { cn } from "@/lib/utils";
import { getPublicKey, onDisconnect } from "@/app/stellar-wallet-kit";
import { Search, MessageCircle, Send, Wallet, Star } from "lucide-react";

import { calculateReputation, trackActivity } from "@/lib/reputation";
import { CONFIG } from "@/lib/config";

/* ---------------- TYPES ---------------- */

type ChatPreview = {
  id: string;
  name: string;
  address: string;
  lastMessage: string;
  lastSeen: string;
  unreadCount: number;
  status: PresenceStatus;
};

type ChatMessage = {
  id: string;
  author: "me" | "them";
  text: string;
  time: string;
  delivered: boolean;
  read: boolean;
  status?: "sending" | "sent" | "delivered" | "read";
};

/* ---------------- PAGE ---------------- */

export default function ChatPage() {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [inputMessage, setInputMessage] = useState("");

  const [walletConnected, setWalletConnected] = useState(false);
  const [currentPublicKey, setCurrentPublicKey] = useState<string | null>(null);
  const [reputationScore, setReputationScore] = useState(0);

  const [chats, setChats] = useState<ChatPreview[]>([
    {
      id: "1",
      name: "Anon Whisper",
      address: "GABC...1234",
      lastMessage: "Got your message, will reply soon.",
      lastSeen: "Today • 14:32",
      unreadCount: 2,
      status: "online",
    },
  ]);

  const [messagesByChat, setMessagesByChat] = useState<
    Record<string, ChatMessage[]>
  >({
    "1": [
      {
        id: "m1",
        author: "them",
        text: "Hey 👋",
        time: "14:20",
        delivered: true,
        read: true,
      },
    ],
  });

  const selectedChat = chats.find((c) => c.id === selectedChatId) || null;
  const messages = selectedChat ? messagesByChat[selectedChat.id] || [] : [];

  /* ---------------- WALLET ---------------- */

  useEffect(() => {
    const checkWallet = async () => {
      const address = await getPublicKey();

      setWalletConnected(!!address);
      setCurrentPublicKey(address);

      if (address) toast.success("Wallet connected");
    };

    checkWallet();

    const unsubscribe = onDisconnect(() => {
      setWalletConnected(false);
      setCurrentPublicKey(null);
      toast.error("Wallet disconnected");
    });

    const interval = setInterval(checkWallet, 3000);

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  /* ---------------- REPUTATION ---------------- */

  useEffect(() => {
    setReputationScore(calculateReputation(currentPublicKey));
  }, [currentPublicKey]);

  /* ---------------- CHAT ACTIONS ---------------- */

  const handleSelectChat = (id: string) => {
    setSelectedChatId(id);
    setChats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)),
    );

    toast("Chat opened");
  };

  const handleSendMessage = () => {
    if (!inputMessage.trim() || !selectedChatId) return;

    const msg: ChatMessage = {
      id: Date.now().toString(),
      author: "me",
      text: inputMessage,
      time: new Date().toLocaleTimeString(),
      delivered: false,
      read: false,
      status: "sent",
    };

    setMessagesByChat((prev) => ({
      ...prev,
      [selectedChatId]: [...(prev[selectedChatId] || []), msg],
    }));

    setInputMessage("");
    trackActivity(currentPublicKey, "message");

    toast.success("Message sent"); // ✅ ADDED
  };

  const getStatus = (m: ChatMessage) =>
    m.status || (m.read ? "read" : m.delivered ? "delivered" : "sent");

  /* ---------------- UI ---------------- */

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 flex justify-center pt-24 px-4">
        <div className="w-full max-w-6xl flex border rounded-2xl overflow-hidden">
          {/* Sidebar */}
          <aside className="w-[340px] border-r bg-card flex flex-col">
            <div className="p-3 border-b relative">
              <Search className="absolute left-6 top-6 h-4 w-4" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-8 p-2 border rounded-md"
                placeholder="Search"
              />
            </div>

            <div className="flex-1 overflow-y-auto">
              {chats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => handleSelectChat(chat.id)}
                  className={cn(
                    "w-full text-left p-3 hover:bg-muted",
                    selectedChatId === chat.id && "bg-muted",
                  )}
                >
                  <div className="font-medium">{chat.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {chat.lastMessage}
                  </div>
                </button>
              ))}
            </div>

            <div className="p-3 border-t flex justify-between text-xs">
              <span>Wallet:</span>
              <ConnectWallet />
            </div>
          </aside>

          {/* Chat */}
          <section className="flex-1 flex flex-col">
            {!selectedChat ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                Select a chat
              </div>
            ) : (
              <>
                <div className="p-4 border-b font-medium">
                  {selectedChat.name}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "flex",
                        m.author === "me" ? "justify-end" : "justify-start",
                      )}
                    >
                      <div className="bg-muted px-3 py-2 rounded-xl text-sm">
                        {m.text}
                        <div className="text-[10px] text-muted-foreground text-right">
                          {m.time}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-3 border-t flex gap-2">
                  <input
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    className="flex-1 border rounded-full px-4 py-2"
                    placeholder="Message..."
                  />
                  <button
                    onClick={handleSendMessage}
                    className="bg-primary text-white px-4 rounded-full"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
