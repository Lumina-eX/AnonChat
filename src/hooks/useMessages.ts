"use client";

import { useState, useCallback } from "react";
import { Message, AddMessageFn } from "../types/message";

export function useMessages() {
  const [messages, setMessages] = useState<Message[]>([]);

  const addMessage: AddMessageFn = useCallback((msg) => {
    const newMsg: Message = {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMsg]);
  }, []);

  return { messages, addMessage };
}
