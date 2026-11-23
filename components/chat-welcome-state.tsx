"use client";

import React from "react";
import { Plus, Users, MessageSquare, Sparkles } from "lucide-react";

interface ChatWelcomeStateProps {
    onCreateGroup?: () => void;
    onJoinGroup?: () => void;
}

export function ChatWelcomeState({
    onCreateGroup = () => console.log("Create group triggered"),
    onJoinGroup = () => console.log("Join group triggered"),
}: ChatWelcomeStateProps) {
    return (
        <div className="w-full h-full flex items-center justify-center relative p-6">
            {/* Background Decorative Elements */}
            <div aria-hidden="true" className="absolute top-12 left-12 text-primary/10 animate-pulse pointer-events-none">
                <Sparkles className="h-16 w-16" />
            </div>
            <div aria-hidden="true" className="absolute bottom-12 right-12 text-muted-foreground/10 pointer-events-none">
                <MessageSquare className="h-24 w-24" />
            </div>

            {/* Centered Interaction Box */}
            <div className="max-w-md w-full text-center space-y-8 z-10 animate-fade-in">

                {/* Animated Icon Container */}
                <div aria-hidden="true" className="inline-flex p-4 rounded-2xl bg-primary/10 border border-primary/20 text-primary shadow-sm animate-bounce-slow mx-auto">
                    <MessageSquare className="h-6 w-6" />
                </div>

                {/* Content Headers */}
                <div className="space-y-3">
                    <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                        Welcome to AnonChat
                    </h2>
                    <p className="text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">
                        Your curated space for encrypted, real-time group interactions. Select your entry pathway below to begin.
                    </p>
                </div>

                {/* CTA Buttons */}
                <div className="space-y-3 pt-2">
                    <button
                        type="button"
                        onClick={onCreateGroup}
                        className="w-full inline-flex cursor-pointer items-center justify-between bg-primary text-primary-foreground h-12 px-5 rounded-xl text-xs font-semibold tracking-wider uppercase shadow-sm transition-all duration-300 group hover:translate-y-[-1px] hover:shadow-md"
                    >
                        <span className="flex items-center gap-3">
                            <Plus aria-hidden="true" className="h-4 w-4 opacity-80 group-hover:scale-110 transition-transform" />
                            Create New Group
                        </span>
                        <span aria-hidden="true" className="text-[10px] opacity-60 font-mono tracking-normal transform translate-x-0 group-hover:translate-x-1 transition-transform">
                            &rarr;
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={onJoinGroup}
                        className="w-full cursor-pointer inline-flex items-center justify-between bg-background border border-border/80 text-foreground h-12 px-5 rounded-xl text-xs font-semibold tracking-wider uppercase transition-all duration-300 group hover:translate-y-[-1px] hover:bg-muted/40 hover:border-border"
                    >
                        <span className="flex items-center gap-3">
                            <Users aria-hidden="true" className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                            Join Existing Group
                        </span>
                        <span aria-hidden="true" className="text-[10px] opacity-40 font-mono tracking-normal transform translate-x-0 group-hover:translate-x-1 transition-transform">
                            &rarr;
                        </span>
                    </button>
                </div>

                {/* Security Disclaimers */}
                <p className="text-[11px] text-muted-foreground tracking-wide pt-4">
                    No tracking profile configurations or personal identity details required.
                </p>
            </div>

            {/* Local Animation Styling CSS Overrides */}
            <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.98) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes bounceSlow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        .animate-fade-in {
          animation: fadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .animate-bounce-slow {
          animation: bounceSlow 3s ease-in-out infinite;
        }
      `}</style>
        </div>
    );
}