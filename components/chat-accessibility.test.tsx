import React, { useRef, useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ChatMessageBubble, type ChatMessage } from "./chat-message-bubble";
import { MessageSearchBar } from "./message-search-bar";
import { PresenceIndicator } from "./presence-indicator";
import { handleRovingKeyDown, useFocusTrap } from "@/lib/a11y";

afterEach(() => {
  cleanup();
});

const theirMessage: ChatMessage = {
  id: "m1",
  author: "them",
  text: "Hello from Alice",
  time: "09:30",
  status: "read",
  senderName: "Alice",
};

describe("ChatMessageBubble accessibility", () => {
  it("exposes the message as an article named by its sender and text", () => {
    render(<ChatMessageBubble message={theirMessage} />);
    const article = screen.getByRole("article");
    expect(article.getAttribute("aria-labelledby")).toBe("msg-m1-sender msg-m1-text");
    expect(screen.getByText("Alice said")).toBeDefined();
    // Focusable programmatically for arrow-key navigation, but not a tab stop.
    expect(article.getAttribute("tabindex")).toBe("-1");
  });

  it("conveys delivery status as text, not only with a tick symbol", () => {
    render(<ChatMessageBubble message={{ ...theirMessage, author: "me", status: "sending" }} />);
    expect(screen.getByText("Sending")).toBeDefined();
  });

  it("groups message actions in a labelled toolbar with named emoji buttons", () => {
    render(<ChatMessageBubble message={theirMessage} onReply={() => {}} />);
    const toolbar = screen.getByRole("toolbar", { name: /actions for message from alice/i });
    expect(toolbar).toBeDefined();
    expect(screen.getByRole("button", { name: "React with thumbs up" })).toBeDefined();
  });

  it("marks the pin toggle as pressed when the message is pinned", () => {
    render(
      <ChatMessageBubble message={theirMessage} isAdmin isPinned onTogglePin={() => {}} />,
    );
    const pin = screen.getByRole("button", { name: "Unpin message" });
    expect(pin.getAttribute("aria-pressed")).toBe("true");
  });

  it("describes reactions including the count and whether the user reacted", () => {
    render(
      <ChatMessageBubble
        message={{ ...theirMessage, reactions: [{ emoji: "👍", userIds: ["me", "u2"] }] }}
      />,
    );
    const reaction = screen.getByRole("button", {
      name: "thumbs up: 2 reactions, including yours",
    });
    expect(reaction.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("MessageSearchBar accessibility", () => {
  it("has a labelled search input and announces the result count", () => {
    render(
      <MessageSearchBar isVisible value="hi" onChange={() => {}} onClose={() => {}} resultCount={3} />,
    );
    expect(screen.getByLabelText("Search messages")).toBeDefined();
    expect(screen.getByRole("status").textContent).toBe("3 results");
  });

  it("is removed from the tab order while collapsed", () => {
    const { container } = render(
      <MessageSearchBar isVisible={false} value="" onChange={() => {}} onClose={() => {}} />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.hasAttribute("inert")).toBe(true);
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("PresenceIndicator accessibility", () => {
  it("provides a text alternative when the visible label is hidden", () => {
    render(<PresenceIndicator status="online" />);
    expect(screen.getByText("Online").className).toContain("sr-only");
  });
});

describe("handleRovingKeyDown", () => {
  function setup() {
    render(
      <ul data-testid="list">
        <li><button data-item="true">One</button></li>
        <li><button data-item="true">Two</button></li>
        <li><button data-item="true">Three</button></li>
      </ul>,
    );
    const list = screen.getByTestId("list");
    const [one, two, three] = screen.getAllByRole("button");
    const press = (target: HTMLElement, key: string) =>
      handleRovingKeyDown({ key, target, preventDefault: () => {} }, list, '[data-item="true"]');
    return { one, two, three, press };
  }

  it("moves focus with arrow keys and Home/End", () => {
    const { one, two, three, press } = setup();
    one.focus();
    expect(press(one, "ArrowDown")).toBe(true);
    expect(document.activeElement).toBe(two);
    press(two, "End");
    expect(document.activeElement).toBe(three);
    press(three, "ArrowDown"); // stays on last item
    expect(document.activeElement).toBe(three);
    press(three, "Home");
    expect(document.activeElement).toBe(one);
    press(one, "ArrowUp"); // stays on first item
    expect(document.activeElement).toBe(one);
  });

  it("ignores unrelated keys", () => {
    const { one, press } = setup();
    expect(press(one, "a")).toBe(false);
  });
});

describe("useFocusTrap", () => {
  function Harness({ onEscape }: { onEscape: () => void }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useFocusTrap(ref, open, {
      onEscape: () => {
        onEscape();
        setOpen(false);
      },
    });
    return (
      <div>
        <button onClick={() => setOpen(true)}>Open</button>
        {open && (
          <div ref={ref} role="dialog" aria-label="Panel">
            <button>First</button>
            <button>Last</button>
          </div>
        )}
      </div>
    );
  }

  it("traps Tab inside, closes on Escape and restores focus to the trigger", async () => {
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();
    fireEvent.click(trigger);

    // Initial focus is moved into the panel on the next animation frame.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    expect(document.activeElement).toBe(first);

    // Tab from the last element wraps to the first.
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // Shift+Tab from the first element wraps to the last.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
