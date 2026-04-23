"use client";

import { MessageCircle, Shield, Lock, Sparkles } from "lucide-react";

/**
 * ChatEmptyState - An engaging empty state for the chat interface
 * Features animated SVG illustration and call-to-action
 */
export function ChatEmptyState() {
  return (
    <div
      className="flex flex-1 items-center justify-center px-8"
      role="region"
      aria-label="Empty chat state"
    >
      <div className="flex flex-col items-center text-center gap-6 max-w-md animate-in fade-in-0 slide-in-from-bottom-4 duration-700">
        {/* Animated Illustration */}
        <div className="relative">
          {/* Outer glow ring */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-primary/20 via-accent/20 to-primary/20 blur-2xl empty-state-glow" />
          
          {/* Main illustration container */}
          <div className="relative empty-state-float">
            {/* Background circles */}
            <div className="absolute -inset-4 rounded-full bg-gradient-to-br from-primary/5 to-accent/5 empty-state-pulse" />
            <div className="absolute -inset-2 rounded-full bg-gradient-to-br from-primary/10 to-accent/10" />
            
            {/* Central icon area */}
            <div className="relative h-24 w-24 rounded-2xl bg-gradient-to-br from-primary/20 via-primary/10 to-accent/20 border border-primary/30 flex items-center justify-center shadow-lg shadow-primary/10">
              {/* Animated chat bubbles SVG */}
              <svg
                viewBox="0 0 64 64"
                className="h-14 w-14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                {/* Main chat bubble */}
                <g className="empty-state-bubble-1">
                  <rect
                    x="8"
                    y="12"
                    width="32"
                    height="24"
                    rx="6"
                    className="fill-primary/30 stroke-primary"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M12 36 L8 44 L18 36"
                    className="fill-primary/30 stroke-primary"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  {/* Dots animation */}
                  <circle cx="18" cy="24" r="2" className="fill-primary empty-state-dot-1" />
                  <circle cx="24" cy="24" r="2" className="fill-primary empty-state-dot-2" />
                  <circle cx="30" cy="24" r="2" className="fill-primary empty-state-dot-3" />
                </g>
                
                {/* Secondary chat bubble */}
                <g className="empty-state-bubble-2">
                  <rect
                    x="24"
                    y="28"
                    width="32"
                    height="20"
                    rx="5"
                    className="fill-accent/20 stroke-accent/60"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M52 48 L56 54 L48 48"
                    className="fill-accent/20 stroke-accent/60"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  {/* Line placeholders */}
                  <line x1="30" y1="36" x2="50" y2="36" className="stroke-accent/50" strokeWidth="2" strokeLinecap="round" />
                  <line x1="30" y1="42" x2="44" y2="42" className="stroke-accent/40" strokeWidth="2" strokeLinecap="round" />
                </g>
                
                {/* Sparkle accents */}
                <g className="empty-state-sparkle">
                  <circle cx="48" cy="10" r="1.5" className="fill-primary" />
                  <circle cx="58" cy="20" r="1" className="fill-accent" />
                  <circle cx="4" cy="28" r="1" className="fill-primary/60" />
                </g>
              </svg>
            </div>
            
            {/* Floating accent elements */}
            <div className="absolute -top-2 -right-2 h-6 w-6 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center empty-state-accent-1">
              <Shield className="h-3 w-3 text-primary" />
            </div>
            <div className="absolute -bottom-1 -left-3 h-5 w-5 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center empty-state-accent-2">
              <Lock className="h-2.5 w-2.5 text-accent" />
            </div>
            <div className="absolute top-1/2 -right-4 h-4 w-4 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center empty-state-accent-3">
              <Sparkles className="h-2 w-2 text-primary/80" />
            </div>
          </div>
        </div>

        {/* Text content */}
        <div className="space-y-3 animate-in fade-in-0 duration-700 delay-200">
          <h2 className="text-2xl font-semibold tracking-tight bg-gradient-to-r from-foreground via-foreground to-muted-foreground bg-clip-text">
            Say hello to get started!
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
            Pick a room from the sidebar to begin your anonymous conversation.
            <span className="block mt-1 text-primary/80 font-medium">
              Every message is end-to-end encrypted.
            </span>
          </p>
        </div>

        {/* Feature badges */}
        <div className="flex flex-wrap justify-center gap-2 animate-in fade-in-0 duration-700 delay-300">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary">
            <Shield className="h-3 w-3" />
            <span>Anonymous</span>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-xs text-accent">
            <Lock className="h-3 w-3" />
            <span>Encrypted</span>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/10 border border-secondary/20 text-xs text-secondary">
            <MessageCircle className="h-3 w-3" />
            <span>Real-time</span>
          </div>
        </div>

        {/* Subtle hint */}
        <p className="text-xs text-muted-foreground/60 animate-in fade-in-0 duration-700 delay-500">
          Select a room from the left panel or create a new one
        </p>
      </div>
    </div>
  );
}
