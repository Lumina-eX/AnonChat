import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MessageItem } from "./MessageItem";

afterEach(() => {
  cleanup();
});

const baseMessage = {
  id: "m1",
  text: "Hello",
  sender: "wallet_abc",
  timestamp: new Date("2025-01-01T10:00:00Z"),
  isOwn: true,
  isEncrypted: false,
};

describe("MessageItem", () => {
  it("renders Edited label when message is edited", () => {
    render(<MessageItem message={{ ...baseMessage, editedAt: new Date("2025-01-01T10:01:00Z") }} />);
    expect(screen.getByText("Hello")).toBeDefined();
    expect(screen.getByText("Edited")).toBeDefined();
  });

  it("does not render Edited label when message is not edited", () => {
    render(<MessageItem message={{ ...baseMessage, editedAt: undefined }} />);
    expect(screen.getByText("Hello")).toBeDefined();
    expect(screen.queryByText("Edited")).toBeNull();
  });

  it("renders quoted message when replyTo is present", () => {
    render(
      <MessageItem
        message={{
          ...baseMessage,
          replyTo: {
            id: "m0",
            text: "Original message text",
            sender: "wallet_xyz",
          },
        }}
      />
    );
    expect(screen.getByText("Original message text")).toBeDefined();
    expect(screen.getByText("wallet_xyz")).toBeDefined();
  });

  it("calls onJumpToMessage when quoted message is clicked", () => {
    const handleJump = vi.fn();
    render(
      <MessageItem
        message={{
          ...baseMessage,
          replyTo: {
            id: "m0",
            text: "Original message text",
            sender: "wallet_xyz",
          },
        }}
        onJumpToMessage={handleJump}
      />
    );

    const quoteEl = screen.getByText("Original message text");
    fireEvent.click(quoteEl);
    expect(handleJump).toHaveBeenCalledWith("m0");
  });

  it("calls onReply when reply button is clicked", () => {
    const handleReply = vi.fn();
    render(
      <MessageItem
        message={baseMessage}
        onReply={handleReply}
      />
    );

    const replyBtn = screen.getByRole("button", { name: /reply to message/i });
    fireEvent.click(replyBtn);
    expect(handleReply).toHaveBeenCalledWith(baseMessage);
  });

  it("gracefully displays deleted original message in reply quote", () => {
    render(
      <MessageItem
        message={{
          ...baseMessage,
          replyTo: {
            id: "deleted_1",
            text: "",
            isDeleted: true,
          },
        }}
      />
    );
    expect(screen.getByText("Original message was deleted")).toBeDefined();
  });
});