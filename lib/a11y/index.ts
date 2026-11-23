"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/** Selector matching elements that can receive keyboard focus. */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Returns the visible, tabbable descendants of `container` in DOM order. */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (el) =>
      !el.hasAttribute("inert") &&
      !el.closest("[inert]") &&
      el.getAttribute("aria-hidden") !== "true" &&
      // Skip elements hidden with display:none / visibility:hidden.
      (el.offsetParent !== null || el === document.activeElement),
  );
}

interface FocusTrapOptions {
  /** Called when the user presses Escape inside the trapped region. */
  onEscape?: () => void;
  /** Element to focus when the trap activates (defaults to first focusable). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Element to return focus to when the trap deactivates. Defaults to the
   * element that was focused right before the trap became active.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Traps keyboard focus inside `containerRef` while `active` is true:
 * - moves focus into the container on activation,
 * - wraps Tab / Shift+Tab at the edges,
 * - calls `onEscape` on Escape,
 * - restores focus to the triggering element on deactivation.
 *
 * Radix dialogs already provide this; use this hook for custom overlays
 * such as the mobile sidebar and the mobile member panel.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  { onEscape, initialFocusRef, returnFocusRef }: FocusTrapOptions = {},
) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusInitial = () => {
      const target =
        initialFocusRef?.current ?? getFocusableElements(container)[0];
      if (target) {
        target.focus();
      } else {
        if (!container.hasAttribute("tabindex")) {
          container.setAttribute("tabindex", "-1");
        }
        container.focus();
      }
    };
    // Wait a frame so CSS transitions / conditional rendering have settled.
    const frame = requestAnimationFrame(focusInitial);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onEscapeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (event.shiftKey && (current === first || !container.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !container.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };

    // If focus escapes (e.g. a click on the backdrop), pull it back in.
    const handleFocusIn = (event: FocusEvent) => {
      if (!container.contains(event.target as Node)) {
        focusInitial();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn);
      const returnTarget = returnFocusRef?.current ?? previouslyFocused;
      if (returnTarget && document.contains(returnTarget)) {
        returnTarget.focus();
      }
    };
  }, [active]);
}

/** Tracks a CSS media query. Returns `false` during SSR. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/**
 * Keyboard handler implementing roving focus over a list of items
 * (WAI-ARIA "composite widget" pattern). Arrow Up/Down move to the
 * previous/next item, Home/End jump to the first/last one.
 *
 * Returns true when the event was handled.
 */
export function handleRovingKeyDown(
  event: { key: string; preventDefault: () => void; target: EventTarget | null },
  container: HTMLElement | null,
  itemSelector: string,
): boolean {
  if (!container) return false;
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return false;

  const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
  if (items.length === 0) return false;

  const current = (event.target as HTMLElement | null)?.closest?.(itemSelector) as
    | HTMLElement
    | null;
  const index = current ? items.indexOf(current) : -1;

  let next: number;
  switch (event.key) {
    case "ArrowDown":
      next = index < 0 ? 0 : Math.min(items.length - 1, index + 1);
      break;
    case "ArrowUp":
      next = index < 0 ? items.length - 1 : Math.max(0, index - 1);
      break;
    case "Home":
      next = 0;
      break;
    default:
      next = items.length - 1;
  }

  event.preventDefault();
  items[next].focus();
  items[next].scrollIntoView?.({ block: "nearest" });
  return true;
}
