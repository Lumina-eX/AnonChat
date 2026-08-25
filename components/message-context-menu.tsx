"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Clipboard,
  Flag,
  Reply,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const MESSAGE_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉"] as const;

type MenuPosition = {
  left: number;
  top: number;
};

export interface MessageContextMenuProps {
  children: React.ReactNode;
  canDelete?: boolean;
  onReply?: () => void;
  onCopy?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onReact?: (emoji: string) => void | Promise<void>;
  onReport?: () => void | Promise<void>;
}

type MenuAction = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect?: () => void | Promise<void>;
  destructive?: boolean;
};

const MENU_WIDTH = 224;
const MENU_MARGIN = 8;
const LONG_PRESS_MS = 500;

function getSafePosition(clientX: number, clientY: number): MenuPosition {
  const maxLeft = Math.max(MENU_MARGIN, window.innerWidth - MENU_WIDTH - MENU_MARGIN);
  const estimatedMenuHeight = 320;
  const maxTop = Math.max(MENU_MARGIN, window.innerHeight - estimatedMenuHeight - MENU_MARGIN);

  return {
    left: Math.min(Math.max(clientX, MENU_MARGIN), maxLeft),
    top: Math.min(Math.max(clientY, MENU_MARGIN), maxTop),
  };
}

export function MessageContextMenu({
  children,
  canDelete = false,
  onReply,
  onCopy,
  onDelete,
  onReact,
  onReport,
}: MessageContextMenuProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressContextMenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressContextMenuRef = useRef(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [showReactions, setShowReactions] = useState(false);

  const closeMenu = useCallback(() => {
    setPosition(null);
    setShowReactions(false);
  }, []);

  const openMenu = useCallback((clientX: number, clientY: number) => {
    setPosition(getSafePosition(clientX, clientY));
    setShowReactions(false);
  }, []);

  useEffect(() => {
    if (!position) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        closeMenu();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenu, position]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (suppressContextMenuTimerRef.current) {
        clearTimeout(suppressContextMenuTimerRef.current);
      }
    };
  }, []);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false;
      return;
    }
    openMenu(event.clientX, event.clientY);
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return;
    clearLongPress();
    const touch = event.touches[0];
    longPressTimerRef.current = setTimeout(() => {
      suppressContextMenuRef.current = true;
      suppressContextMenuTimerRef.current = setTimeout(() => {
        suppressContextMenuRef.current = false;
        suppressContextMenuTimerRef.current = null;
      }, LONG_PRESS_MS);
      openMenu(touch.clientX, touch.clientY);
      longPressTimerRef.current = null;
    }, LONG_PRESS_MS);
  };

  const handleTouchEnd = () => {
    clearLongPress();
  };

  const selectAction = (action?: () => void | Promise<void>) => {
    closeMenu();
    void action?.();
  };

  const actions: MenuAction[] = [
    ...(onReply ? [{ label: "Reply", icon: Reply, onSelect: onReply }] : []),
    ...(onCopy ? [{ label: "Copy message", icon: Clipboard, onSelect: onCopy }] : []),
    ...(canDelete && onDelete
      ? [{ label: "Delete message", icon: Trash2, onSelect: onDelete, destructive: true }]
      : []),
    ...(onReact
      ? [{ label: "React to message", icon: SmilePlus }]
      : []),
    ...(onReport ? [{ label: "Report message", icon: Flag, onSelect: onReport }] : []),
  ];

  return (
    <div
      ref={triggerRef}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={clearLongPress}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      className="relative touch-manipulation"
    >
      {children}

      {position && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Message actions"
          className="fixed z-50 w-56 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
          style={{ left: position.left, top: position.top }}
        >
          {actions.map(({ label, icon: Icon, onSelect, destructive }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                if (label === "React to message") {
                  setShowReactions((current) => !current);
                  return;
                }
                selectAction(onSelect);
              }}
              aria-expanded={label === "React to message" ? showReactions : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                destructive
                  ? "text-destructive hover:bg-destructive/10"
                  : "text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{label}</span>
            </button>
          ))}

          {showReactions && (
            <div className="mt-1 flex items-center justify-between border-t border-border/70 px-2 pt-1.5" aria-label="Choose a reaction">
              {MESSAGE_REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => selectAction(() => onReact?.(emoji))}
                  className="rounded-lg p-1.5 text-base transition-transform hover:bg-muted hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
