import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MessageInput } from "./MessageInput";

afterEach(() => {
  cleanup();
});

describe("MessageInput Component", () => {
  it("renders textarea and send button", () => {
    render(<MessageInput onSend={vi.fn()} />);
    expect(screen.getByPlaceholderText(/type a message/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /send/i })).toBeDefined();
  });

  it("shows referenced message banner when replyingTo is provided", () => {
    render(
      <MessageInput
        onSend={vi.fn()}
        replyingTo={{
          id: "msg_orig",
          text: "Referenced text snippet",
          sender: "Bob",
        }}
      />
    );

    expect(screen.getByText(/replying to bob/i)).toBeDefined();
    expect(screen.getByText("Referenced text snippet")).toBeDefined();
  });

  it("calls onCancelReply when dismiss button is clicked", () => {
    const handleCancel = vi.fn();
    render(
      <MessageInput
        onSend={vi.fn()}
        replyingTo={{
          id: "msg_orig",
          text: "Referenced text snippet",
          sender: "Bob",
        }}
        onCancelReply={handleCancel}
      />
    );

    const cancelBtn = screen.getByRole("button", { name: /cancel reply/i });
    fireEvent.click(cancelBtn);
    expect(handleCancel).toHaveBeenCalled();
  });

  it("cancels reply mode when Escape key is pressed", () => {
    const handleCancel = vi.fn();
    render(
      <MessageInput
        onSend={vi.fn()}
        replyingTo={{
          id: "msg_orig",
          text: "Referenced text snippet",
          sender: "Bob",
        }}
        onCancelReply={handleCancel}
      />
    );

    const textarea = screen.getByPlaceholderText(/type a message/i);
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(handleCancel).toHaveBeenCalled();
  });

  it("sends message with reply payload on submit", () => {
    const handleSend = vi.fn();
    const replyingTo = {
      id: "msg_orig",
      text: "Referenced text snippet",
      sender: "Bob",
    };

    render(
      <MessageInput
        onSend={handleSend}
        replyingTo={replyingTo}
      />
    );

    const textarea = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(textarea, { target: { value: "My response" } });

    const sendBtn = screen.getByRole("button", { name: /send/i });
    fireEvent.click(sendBtn);

    expect(handleSend).toHaveBeenCalledWith("My response", replyingTo);
  });
});
