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
}
