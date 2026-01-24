"use client"

import { Header } from "@/components/header"
import { ChatInput } from "@/components/chat-input"
import { useState } from "react"
import { cn } from "@/lib/utils"

export default function ChatPage() {
    const [messages, setMessages] = useState<{ id: number, text: string, sent: boolean }[]>([
        { id: 1, text: "Welcome to AnonChat! Your identity is hidden.", sent: false },
        { id: 2, text: "Messages are encrypted and ephemeral.", sent: false }
    ])

    const handleSend = (text: string) => {
        setMessages(prev => [...prev, { id: Date.now(), text, sent: true }])
    }

    return (
        <div className="min-h-screen bg-background flex flex-col">
            <Header />

            <main className="flex-1 pt-20 pb-4 px-4 container mx-auto flex gap-4 max-w-7xl h-[calc(100vh-1rem)]">
                {/* Sidebar - Chat History (Hidden on mobile) */}
                <aside className="hidden md:flex flex-col w-64 bg-card/30 rounded-2xl border border-border/50 p-4 h-full">
                    <div className="mb-4">
                        {/* Title Color Verification: Uses gradient-text */}
                        <h2 className="text-xl font-bold gradient-text px-2">Active Chats</h2>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                        {/* Mock History Items */}
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="p-3 rounded-xl hover:bg-muted/50 transition-colors cursor-pointer group">
                                <div className="font-medium text-foreground group-hover:text-primary transition-colors">Anonymous User #{i}</div>
                                <div className="text-xs text-muted-foreground truncate">Last message content...</div>
                            </div>
                        ))}
                    </div>
                </aside>

                {/* Main Chat Area */}
                <section className="flex-1 flex flex-col bg-card/30 rounded-2xl border border-border/50 h-full relative overflow-hidden">
                    {/* Chat Header */}
                    <div className="p-4 border-b border-border/50 flex items-center justify-between bg-card/50 backdrop-blur-sm">
                        <div>
                            <h1 className="text-lg font-bold gradient-text flex items-center">
                                <span className="w-2 h-2 inline-block rounded-full bg-green-500 mr-2 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]"></span>
                                Live Chat
                            </h1>
                        </div>
                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                        {messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={cn(
                                    "flex w-full",
                                    msg.sent ? "justify-end" : "justify-start"
                                )}
                            >
                                <div
                                    className={cn(
                                        "max-w-[80%] rounded-2xl px-4 py-3 shadow-md",
                                        msg.sent
                                            ? "bg-gradient-to-br from-primary to-accent text-primary-foreground rounded-tr-none"
                                            : "bg-muted text-foreground rounded-tl-none border border-border/50"
                                    )}
                                >
                                    <p className="leading-relaxed">{msg.text}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Input Area */}
                    <div className="p-4 bg-gradient-to-t from-background/80 to-transparent backdrop-blur-sm">
                        <ChatInput onSend={handleSend} />
                    </div>
                </section>
            </main>
        </div>
    )
import { useState } from "react"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { PresenceIndicator, PresenceStatus } from "@/components/presence-indicator"
import { User, Send, Smartphone, Laptop, Globe } from "lucide-react"
import { cn } from "@/lib/utils"

export default function ChatDemoPage() {
  const [currentStatus, setCurrentStatus] = useState<PresenceStatus>("online")

  const mockParticipants = [
    { name: "Alex Johnson", status: "online" as PresenceStatus, device: "Desktop" },
    { name: "Sarah Smith", status: "recently_active" as PresenceStatus, device: "Mobile" },
    { name: "Mike Ross", status: "offline" as PresenceStatus, device: "Web" },
    { name: "Jessica Day", status: "online" as PresenceStatus, device: "Desktop" },
  ]

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      
      <main className="flex-1 pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full">
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold gradient-text">Presence Interface Demo</h1>
            <p className="text-muted-foreground mt-1">Experience real-time availability status indicators.</p>
          </div>

          <div className="flex items-center gap-3 p-1 bg-muted/50 rounded-xl border w-fit">
            {(["online", "recently_active", "offline"] as PresenceStatus[]).map((status) => (
              <button
                key={status}
                onClick={() => setCurrentStatus(status)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize",
                  currentStatus === status 
                    ? "bg-background shadow-sm text-foreground" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {status.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[600px]">
          {/* Chat Area */}
          <div className="lg:col-span-3 border rounded-2xl bg-card overflow-hidden flex flex-col shadow-sm">
            <div className="p-4 border-b bg-muted/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="text-primary" size={20} />
                  </div>
                  <PresenceIndicator 
                    status={currentStatus} 
                    className="absolute -bottom-0.5 -right-0.5 ring-4 ring-card" 
                  />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">General Chat</h3>
                  <p className="text-[10px] text-muted-foreground">You are currently <span className="font-medium text-foreground">{currentStatus.replace("_", " ")}</span></p>
                </div>
              </div>
            </div>

            <div className="flex-1 p-6 flex items-center justify-center bg-muted/5">
              <div className="text-center space-y-4 max-w-sm">
                <div className="inline-flex p-4 rounded-full bg-primary/5 text-primary mb-2">
                  <Globe size={32} />
                </div>
                <h4 className="text-lg font-semibold">Interactive Presence Demo</h4>
                <p className="text-sm text-muted-foreground">
                  Use the toggles above to change your own availability. The sidebar shows how other participants' status indicators would appear in a live environment.
                </p>
              </div>
            </div>

            <div className="p-4 border-t bg-background flex gap-2">
              <input 
                type="text" 
                placeholder="Type a message..." 
                className="flex-1 px-4 py-2 rounded-lg border bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-sm"
              />
              <button className="p-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
                <Send size={18} />
              </button>
            </div>
          </div>

          {/* Participants Sidebar */}
          <div className="border rounded-2xl bg-card overflow-hidden flex flex-col shadow-sm">
            <div className="p-4 border-b bg-muted/20">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Participants</h3>
            </div>
            <div className="p-2 space-y-1 overflow-y-auto">
              {mockParticipants.map((participant, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/50 transition-colors group">
                  <div className="relative">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/5 to-accent/5 border flex items-center justify-center">
                      <User size={16} className="text-muted-foreground/60" />
                    </div>
                    <PresenceIndicator 
                      status={participant.status} 
                      className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card" 
                    />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">{participant.name}</span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1 capitalize">
                      {participant.status.replace("_", " ")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
