import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { DELETE } from "../route";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const roomId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const messageId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherMessageId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function createSupabaseMock({
  user = { id: userId },
  membership = { id: "membership", removed_at: null },
  messages = [{ id: messageId, user_id: userId }],
  deletedMessages = [{ id: messageId }],
}: {
  user?: { id: string } | null;
  membership?: { id: string; removed_at: string | null } | null;
  messages?: Array<{ id: string; user_id: string }>;
  deletedMessages?: Array<{ id: string }>;
} = {}) {
  let messageQueryCount = 0;

  const memberChain = {
    select: vi.fn(() => memberChain),
    eq: vi.fn(() => memberChain),
    maybeSingle: vi.fn(async () => ({ data: membership, error: null })),
  };
  const readChain = {
    select: vi.fn(() => readChain),
    eq: vi.fn(() => readChain),
    in: vi.fn(async () => ({ data: messages, error: null })),
  };
  const deleteChain = {
    delete: vi.fn(() => deleteChain),
    eq: vi.fn(() => deleteChain),
    in: vi.fn(() => deleteChain),
    select: vi.fn(async () => ({ data: deletedMessages, error: null })),
  };

  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: null })),
    },
    from: vi.fn((table: string) => {
      if (table === "room_members") return memberChain;
      messageQueryCount += 1;
      return messageQueryCount === 1 ? readChain : deleteChain;
    }),
  };

  createClientMock.mockResolvedValue(supabase);
  return { supabase, deleteChain };
}

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/messages", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("DELETE /api/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires an authenticated user", async () => {
    createSupabaseMock({ user: null });

    const response = await DELETE(
      makeRequest({ room_id: roomId, message_ids: [messageId] }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects deletion if any selected message belongs to another user", async () => {
    const { deleteChain } = createSupabaseMock({
      messages: [
        { id: messageId, user_id: userId },
        { id: otherMessageId, user_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
      ],
    });

    const response = await DELETE(
      makeRequest({ room_id: roomId, message_ids: [messageId, otherMessageId] }),
    );

    expect(response.status).toBe(403);
    expect(deleteChain.delete).not.toHaveBeenCalled();
  });

  it("deletes only validated owned messages in an active room", async () => {
    const { deleteChain } = createSupabaseMock({
      messages: [
        { id: messageId, user_id: userId },
        { id: otherMessageId, user_id: userId },
      ],
      deletedMessages: [{ id: messageId }, { id: otherMessageId }],
    });

    const response = await DELETE(
      makeRequest({ room_id: roomId, message_ids: [messageId, otherMessageId] }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      deleted_count: 2,
      deleted_ids: [messageId, otherMessageId],
    });
    expect(deleteChain.delete).toHaveBeenCalledOnce();
  });

  it("rejects malformed message identifiers", async () => {
    createSupabaseMock();

    const response = await DELETE(
      makeRequest({ room_id: roomId, message_ids: ["not-a-uuid"] }),
    );

    expect(response.status).toBe(400);
  });
});
