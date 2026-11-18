"use client";

import React, { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  resultCount?: number;
  isVisible: boolean;
}

export function MessageSearchBar({
  value,
  onChange,
  onClose,
  resultCount,
  isVisible,
}: MessageSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when the bar becomes visible
  useEffect(() => {
    if (isVisible) {
      // Small delay so the CSS transition doesn't fight focus
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [isVisible]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isVisible) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, onClose]);

  return (
    <div
      role="search"
      aria-label="Search messages in this group"
      // When collapsed the bar is visually hidden; `inert` also removes it
      // from the tab order and the accessibility tree.
      inert={!isVisible}
      aria-hidden={!isVisible}
      className={cn(
        "overflow-hidden transition-all duration-200 ease-out",
        isVisible ? "max-h-14 opacity-100" : "max-h-0 opacity-0 pointer-events-none",
      )}
    >
      <div className="px-4 sm:px-5 py-2 border-b border-border/70 bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <label htmlFor="message-search-input" className="sr-only">
              Search messages
            </label>
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
            />
            <input
              id="message-search-input"
              ref={inputRef}
              type="search"
              aria-describedby="message-search-results"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Search messages…"
              className="w-full rounded-xl border border-border/80 bg-background/70 pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
            />
          </div>

          {/* Result count badge — announced politely as it changes */}
          <span
            id="message-search-results"
            role="status"
            className="shrink-0 text-xs text-muted-foreground tabular-nums whitespace-nowrap empty:hidden"
          >
            {value.trim()
              ? resultCount === 0
                ? "No results"
                : `${resultCount} result${resultCount !== 1 ? "s" : ""}`
              : ""}
          </span>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
