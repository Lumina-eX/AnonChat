import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatMessageBubble, type ChatMessage } from "./chat-message-bubble";

afterEach(() => {
  cleanup();
});

const baseMessage: ChatMessage = {
  id: "msg_123",
  author: "me",
  text: "Hello world reply test",
  time: "12:00",
  status: "sent",
};

describe("ChatMessageBubble Component", () => {
  it("renders message text and timestamp correctly", () => {
    render(<ChatMessageBubble message={baseMessage} />);
    expect(screen.getByText("Hello world reply test")).toBeDefined();
    expect(screen.getByText("12:00")).toBeDefined();
  });

  it("renders reply action button and triggers onReply when clicked", () => {
    const onReply = vi.fn();
    render(<ChatMessageBubble message={baseMessage} onReply={onReply} />);

    const replyButton = screen.getByRole("button", { name: /reply to message/i });
    expect(replyButton).toBeDefined();

    fireEvent.click(replyButton);
    expect(onReply).toHaveBeenCalledWith(baseMessage);
  });

  it("renders quoted message when replyTo is present", () => {
    const replyMessage: ChatMessage = {
      ...baseMessage,
      replyTo: {
        id: "orig_456",
        text: "This is the original quoted text",
        sender: "Alice",
      },
    };

    render(<ChatMessageBubble message={replyMessage} />);
    expect(screen.getByText("This is the original quoted text")).toBeDefined();
    expect(screen.getByText("Alice")).toBeDefined();
  });

  it("calls onJumpToMessage when clicking the quoted message", () => {
    const onJumpToMessage = vi.fn();
    const replyMessage: ChatMessage = {
      ...baseMessage,
      replyTo: {
        id: "orig_456",
        text: "This is the original quoted text",
        sender: "Alice",
      },
    };

    render(
      <ChatMessageBubble
        message={replyMessage}
        onJumpToMessage={onJumpToMessage}
      />
    );

    const quoteElement = screen.getByText("This is the original quoted text");
    fireEvent.click(quoteElement);
    expect(onJumpToMessage).toHaveBeenCalledWith("orig_456");
  });

  it("supports keyboard navigation on quoted message with Enter key", () => {
    const onJumpToMessage = vi.fn();
    const replyMessage: ChatMessage = {
      ...baseMessage,
      replyTo: {
        id: "orig_456",
        text: "This is the original quoted text",
        sender: "Alice",
      },
    };

    render(
      <ChatMessageBubble
        message={replyMessage}
        onJumpToMessage={onJumpToMessage}
      />
    );

    const quoteContainer = screen.getByRole("button", {
      name: /replying to alice: this is the original quoted text/i,
    });
    fireEvent.keyDown(quoteContainer, { key: "Enter" });
    expect(onJumpToMessage).toHaveBeenCalledWith("orig_456");
  });

  it("handles deleted referenced messages gracefully", () => {
    const deletedReplyMessage: ChatMessage = {
      ...baseMessage,
      replyTo: {
        id: "deleted_789",
        text: "",
        isDeleted: true,
      },
    };

    render(<ChatMessageBubble message={deletedReplyMessage} />);
    expect(screen.getByText("Original message was deleted")).toBeDefined();
  });
});
