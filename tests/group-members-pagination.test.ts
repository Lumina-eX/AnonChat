import { describe, it, expect } from "vitest";
import {
  encodeCursor,
  decodeCursor,
  normalizeSortField,
  sortAndPaginateMembers,
  type GroupMemberItem,
} from "@/lib/groups/members-pagination";

const mockMembers: GroupMemberItem[] = [
  {
    user_id: "user-1",
    joined_at: "2026-01-01T10:00:00Z",
    is_current_user: true,
    display_name: "Alice",
    username: "alice_anon",
    wallet_address: "GA11111111111111111111111111111111111111111111111111111111",
    avatar_url: null,
    role: "owner",
  },
  {
    user_id: "user-2",
    joined_at: "2026-01-02T10:00:00Z",
    is_current_user: false,
    display_name: "Charlie",
    username: "charlie_anon",
    wallet_address: "GC33333333333333333333333333333333333333333333333333333333",
    avatar_url: null,
    role: "member",
  },
  {
    user_id: "user-3",
    joined_at: "2026-01-01T15:00:00Z",
    is_current_user: false,
    display_name: "Bob",
    username: "bob_anon",
    wallet_address: "GB22222222222222222222222222222222222222222222222222222222",
    avatar_url: null,
    role: "moderator",
  },
  {
    user_id: "user-4",
    joined_at: "2026-01-03T10:00:00Z",
    is_current_user: false,
    display_name: "David",
    username: "david_anon",
    wallet_address: "GD44444444444444444444444444444444444444444444444444444444",
    avatar_url: null,
    role: "member",
  },
];

describe("Group Members Pagination Service", () => {
  describe("Cursor Encoding & Decoding", () => {
    it("encodes and decodes valid cursor tokens", () => {
      const cursor = encodeCursor("2026-01-01T10:00:00Z", "user-1");
      expect(typeof cursor).toBe("string");
      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual({
        sortValue: "2026-01-01T10:00:00Z",
        userId: "user-1",
      });
    });

    it("returns null for malformed or corrupted cursor tokens", () => {
      expect(decodeCursor("invalid_base64_!@#")).toBeNull();
      expect(decodeCursor(Buffer.from("invalid-no-delimiter", "utf8").toString("base64url"))).toBeNull();
      expect(decodeCursor("")).toBeNull();
    });
  });

  describe("normalizeSortField", () => {
    it("normalizes various aliases to standard fields", () => {
      expect(normalizeSortField("joinDate")).toBe("joined_at");
      expect(normalizeSortField("joined_at")).toBe("joined_at");
      expect(normalizeSortField("role")).toBe("role");
      expect(normalizeSortField("username")).toBe("username");
      expect(normalizeSortField("display_name")).toBe("username");
      expect(normalizeSortField(undefined)).toBe("joined_at");
    });
  });

  describe("sortAndPaginateMembers", () => {
    it("sorts by join date ascending by default", () => {
      const result = sortAndPaginateMembers(mockMembers, {
        limit: 2,
        offset: 0,
        sortBy: "joined_at",
        sortOrder: "asc",
      });

      expect(result.paginatedMembers).toHaveLength(2);
      expect(result.paginatedMembers[0].user_id).toBe("user-1");
      expect(result.paginatedMembers[1].user_id).toBe("user-3");
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).not.toBeNull();
    });

    it("sorts by role priority descending (owner > mod > member)", () => {
      const result = sortAndPaginateMembers(mockMembers, {
        limit: 10,
        offset: 0,
        sortBy: "role",
        sortOrder: "desc",
      });

      expect(result.paginatedMembers[0].role).toBe("owner");
      expect(result.paginatedMembers[1].role).toBe("moderator");
      expect(result.paginatedMembers[2].role).toBe("member");
      expect(result.paginatedMembers[3].role).toBe("member");
    });

    it("sorts by username alphabetically", () => {
      const result = sortAndPaginateMembers(mockMembers, {
        limit: 10,
        offset: 0,
        sortBy: "username",
        sortOrder: "asc",
      });

      const names = result.paginatedMembers.map((m) => m.display_name);
      expect(names).toEqual(["Alice", "Bob", "Charlie", "David"]);
    });

    it("paginates without duplicates across page 1 and page 2 using offset", () => {
      const page1 = sortAndPaginateMembers(mockMembers, {
        limit: 2,
        offset: 0,
        sortBy: "joined_at",
        sortOrder: "asc",
      });

      const page2 = sortAndPaginateMembers(mockMembers, {
        limit: 2,
        offset: 2,
        sortBy: "joined_at",
        sortOrder: "asc",
      });

      const page1Ids = page1.paginatedMembers.map((m) => m.user_id);
      const page2Ids = page2.paginatedMembers.map((m) => m.user_id);

      expect(page1Ids).toEqual(["user-1", "user-3"]);
      expect(page2Ids).toEqual(["user-2", "user-4"]);

      // Verify no intersection / duplicates
      const intersection = page1Ids.filter((id) => page2Ids.includes(id));
      expect(intersection).toHaveLength(0);
    });

    it("paginates without duplicates using nextCursor", () => {
      const page1 = sortAndPaginateMembers(mockMembers, {
        limit: 2,
        offset: 0,
        sortBy: "joined_at",
        sortOrder: "asc",
      });

      expect(page1.nextCursor).not.toBeNull();

      const page2 = sortAndPaginateMembers(mockMembers, {
        limit: 2,
        offset: 0,
        cursor: page1.nextCursor!,
        sortBy: "joined_at",
        sortOrder: "asc",
      });

      expect(page2.paginatedMembers.map((m) => m.user_id)).toEqual(["user-2", "user-4"]);
      expect(page2.hasMore).toBe(false);
      expect(page2.nextCursor).toBeNull();
    });

    it("handles empty member list gracefully", () => {
      const result = sortAndPaginateMembers([], {
        limit: 10,
        offset: 0,
        sortBy: "joined_at",
        sortOrder: "asc",
      });

      expect(result.paginatedMembers).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(result.prevCursor).toBeNull();
    });
  });
});
