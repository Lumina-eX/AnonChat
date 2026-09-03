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

  it("shows sending indicator when status is sending", () => {
    render(<MessageItem message={{ ...baseMessage, status: "sending" }} />);
    expect(screen.getByText("Sending\u2026")).toBeDefined();
    expect(screen.queryByText("Tap to retry")).toBeNull();
  });

  it("shows retry button when status is failed", () => {
    const onRetry = vi.fn();
    render(<MessageItem message={{ ...baseMessage, status: "failed" }} onRetry={onRetry} />);
    expect(screen.getByText("Tap to retry")).toBeDefined();
    expect(screen.queryByText("Sending\u2026")).toBeNull();
  });

  it("calls onRetry when retry button is clicked", () => {
    const onRetry = vi.fn();
    render(<MessageItem message={{ ...baseMessage, status: "failed" }} onRetry={onRetry} />);
    fireEvent.click(screen.getByText("Tap to retry"));
    expect(onRetry).toHaveBeenCalledWith("m1");
  });

  it("shows timestamp when status is sent", () => {
    const { container } = render(<MessageItem message={{ ...baseMessage, status: "sent" }} />);
    const timestamp = container.querySelector(".text-gray-500");
    expect(timestamp).not.toBeNull();
    expect(timestamp?.textContent).toBeTruthy();
  });

  it("applies reduced opacity when sending", () => {
    const { container } = render(<MessageItem message={{ ...baseMessage, status: "sending" }} />);
    const bubble = container.querySelector(".opacity-60");
    expect(bubble).not.toBeNull();
  });

  it("applies red background when failed", () => {
    const { container } = render(<MessageItem message={{ ...baseMessage, status: "failed" }} />);
    const bubble = container.querySelector(".bg-red-600\\/80");
    expect(bubble).not.toBeNull();
  });
});
