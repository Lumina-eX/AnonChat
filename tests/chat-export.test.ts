import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "../app/api/groups/[id]/export/route";
import { createClient } from "../lib/supabase/server";

vi.mock("../lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

function makeRequest(url: string): NextRequest {
  return new NextRequest(url);
}

describe("GET /api/groups/[id]/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 if user is not authenticated", async () => {
    const mockSupabase = {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
      },
    };
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const req = makeRequest("http://localhost/api/groups/room-1/export");
    const res = await GET(req, { params: Promise.resolve({ id: "room-1" }) });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Unauthorized");
  });

  it("should return 403 if user is not a member of the group", async () => {
    const mockSupabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "room_members") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const req = makeRequest("http://localhost/api/groups/room-1/export");
    const res = await GET(req, { params: Promise.resolve({ id: "room-1" }) });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Forbidden. You are not a member of this room.");
  });

  it("should return 403 if user was removed from the group", async () => {
    const mockSupabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "room_members") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: "member-1", removed_at: "2026-07-27" }, error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const req = makeRequest("http://localhost/api/groups/room-1/export");
    const res = await GET(req, { params: Promise.resolve({ id: "room-1" }) });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Forbidden. You have been removed from this room.");
  });

  it("should successfully stream JSON export of chat history", async () => {
    const mockMessages = [
      {
        id: "msg-1",
        content: "Hello",
        created_at: "2026-07-27T10:00:00Z",
        user_id: "user-1",
        is_encrypted: false,
        edited_at: null,
        profiles: { display_name: "User One" },
      },
      {
        id: "msg-2",
        content: "Hi there",
        created_at: "2026-07-27T10:01:00Z",
        user_id: "user-2",
        is_encrypted: false,
        edited_at: null,
        profiles: { display_name: "User Two" },
      },
    ];

    const mockSupabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "room_members") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: "member-1", removed_at: null }, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "rooms") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { name: "Cool Group" }, error: null }),
              }),
            }),
          };
        }
        if (table === "messages") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  range: async () => ({ data: mockMessages, error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const req = makeRequest("http://localhost/api/groups/room-1/export?format=json");
    const res = await GET(req, { params: Promise.resolve({ id: "room-1" }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="cool-group-export.json"');

    const text = await res.text();
    const parsed = JSON.parse(text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].content).toBe("Hello");
    expect(parsed[0].sender).toBe("User One");
  });

  it("should successfully stream TXT export of chat history", async () => {
    const mockMessages = [
      {
        id: "msg-1",
        content: "Hello",
        created_at: "2026-07-27T10:00:00.000Z",
        user_id: "user-1",
        is_encrypted: false,
        edited_at: null,
        profiles: { display_name: "User One" },
      },
    ];

    const mockSupabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "room_members") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: "member-1", removed_at: null }, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "rooms") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { name: "Cool Group" }, error: null }),
              }),
            }),
          };
        }
        if (table === "messages") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  range: async () => ({ data: mockMessages, error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const req = makeRequest("http://localhost/api/groups/room-1/export?format=txt");
    const res = await GET(req, { params: Promise.resolve({ id: "room-1" }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="cool-group-export.txt"');

    const text = await res.text();
    expect(text).toContain("[2026-07-27 10:00:00] User One: Hello");
  });
});
