#!/usr/bin/env node
/**
 * Unit tests for Group Member Pagination & Access Control.
 * Run with: node --test scripts/test-group-members-pagination.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const ROLE_PRIORITY = {
  owner: 3,
  moderator: 2,
  member: 1,
};

function encodeCursor(sortValue, userId) {
  const raw = `${sortValue}:::${userId}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parts = raw.split(":::");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return null;
    }
    return { sortValue: parts[0], userId: parts[1] };
  } catch {
    return null;
  }
}

function normalizeSortField(field) {
  if (!field) return "joined_at";
  const lowered = field.toLowerCase().trim();
  if (lowered === "role") return "role";
  if (lowered === "username" || lowered === "display_name" || lowered === "name") return "username";
  return "joined_at";
}

function sortAndPaginateMembers(members, params) {
  const { limit, offset, cursor, sortBy, sortOrder } = params;
  const isAsc = sortOrder === "asc";

  const sorted = [...members].sort((a, b) => {
    let comparison = 0;

    if (sortBy === "role") {
      const pA = ROLE_PRIORITY[a.role] || 1;
      const pB = ROLE_PRIORITY[b.role] || 1;
      comparison = pA - pB;
    } else if (sortBy === "username") {
      const nameA = (a.display_name || a.username || "").toLowerCase();
      const nameB = (b.display_name || b.username || "").toLowerCase();
      comparison = nameA.localeCompare(nameB);
    } else {
      comparison = a.joined_at.localeCompare(b.joined_at);
    }

    if (comparison !== 0) {
      return isAsc ? comparison : -comparison;
    }

    return a.user_id.localeCompare(b.user_id);
  });

  let startIndex = 0;

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      const cursorIndex = sorted.findIndex((m) => m.user_id === decoded.userId);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }
  } else {
    startIndex = Math.max(0, offset);
  }

  const paginatedMembers = sorted.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < sorted.length;

  const nextCursor =
    paginatedMembers.length > 0 && hasMore
      ? encodeCursor(
          sortBy === "role"
            ? paginatedMembers[paginatedMembers.length - 1].role
            : sortBy === "username"
              ? paginatedMembers[paginatedMembers.length - 1].display_name || ""
              : paginatedMembers[paginatedMembers.length - 1].joined_at,
          paginatedMembers[paginatedMembers.length - 1].user_id,
        )
      : null;

  const prevCursor =
    startIndex > 0 && paginatedMembers.length > 0
      ? encodeCursor(
          sortBy === "role"
            ? paginatedMembers[0].role
            : sortBy === "username"
              ? paginatedMembers[0].display_name || ""
              : paginatedMembers[0].joined_at,
          paginatedMembers[0].user_id,
        )
      : null;

  const effectivePage = Math.floor(startIndex / limit) + 1;

  return {
    paginatedMembers,
    hasMore,
    nextCursor,
    prevCursor,
    effectivePage,
  };
}

const mockMembers = [
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
      assert.equal(typeof cursor, "string");
      const decoded = decodeCursor(cursor);
      assert.deepEqual(decoded, {
        sortValue: "2026-01-01T10:00:00Z",
        userId: "user-1",
      });
    });

    it("returns null for malformed or corrupted cursor tokens", () => {
      assert.equal(decodeCursor("invalid_base64_!@#"), null);
      assert.equal(
        decodeCursor(Buffer.from("invalid-no-delimiter", "utf8").toString("base64url")),
        null,
      );
      assert.equal(decodeCursor(""), null);
    });
  });

  describe("normalizeSortField", () => {
    it("normalizes various aliases to standard fields", () => {
      assert.equal(normalizeSortField("joinDate"), "joined_at");
      assert.equal(normalizeSortField("joined_at"), "joined_at");
      assert.equal(normalizeSortField("role"), "role");
      assert.equal(normalizeSortField("username"), "username");
      assert.equal(normalizeSortField("display_name"), "username");
      assert.equal(normalizeSortField(undefined), "joined_at");
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

      assert.equal(result.paginatedMembers.length, 2);
      assert.equal(result.paginatedMembers[0].user_id, "user-1");
      assert.equal(result.paginatedMembers[1].user_id, "user-3");
      assert.equal(result.hasMore, true);
      assert.notEqual(result.nextCursor, null);
    });

    it("sorts by role priority descending (owner > mod > member)", () => {
      const result = sortAndPaginateMembers(mockMembers, {
        limit: 10,
        offset: 0,
        sortBy: "role",
        sortOrder: "desc",
      });

      assert.equal(result.paginatedMembers[0].role, "owner");
      assert.equal(result.paginatedMembers[1].role, "moderator");
      assert.equal(result.paginatedMembers[2].role, "member");
      assert.equal(result.paginatedMembers[3].role, "member");
    });

    it("sorts by username alphabetically", () => {
      const result = sortAndPaginateMembers(mockMembers, {
        limit: 10,
        offset: 0,
        sortBy: "username",
        sortOrder: "asc",
      });

      const names = result.paginatedMembers.map((m) => m.display_name);
      assert.deepEqual(names, ["Alice", "Bob", "Charlie", "David"]);
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

      assert.deepEqual(page1Ids, ["user-1", "user-3"]);
      assert.deepEqual(page2Ids, ["user-2", "user-4"]);

      // Verify no intersection / duplicates
      const intersection = page1Ids.filter((id) => page2Ids.includes(id));
      assert.equal(intersection.length, 0);
    });

    it("paginates without duplicates using nextCursor", () => {
      const page1 = sortAndPaginateMembers(mockMembers, {
        limit: 2,
        offset: 0,
        sortBy: "joined_at",
        sortOrder: "asc",
      });

      assert.notEqual(page1.nextCursor, null);

      const page2 = sortAndPaginateMembers(mockMembers, {
        limit: 2,
        offset: 0,
        cursor: page1.nextCursor,
        sortBy: "joined_at",
        sortOrder: "asc",
      });

      assert.deepEqual(
        page2.paginatedMembers.map((m) => m.user_id),
        ["user-2", "user-4"],
      );
      assert.equal(page2.hasMore, false);
      assert.equal(page2.nextCursor, null);
    });

    it("handles empty member list gracefully", () => {
      const result = sortAndPaginateMembers([], {
        limit: 10,
        offset: 0,
        sortBy: "joined_at",
        sortOrder: "asc",
      });

      assert.deepEqual(result.paginatedMembers, []);
      assert.equal(result.hasMore, false);
      assert.equal(result.nextCursor, null);
      assert.equal(result.prevCursor, null);
    });
  });
});
