import { describe, it, expect } from "vitest";
import {
  paginateGroupMembers,
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

// Exercise the service with a query mock that applies database ranges BEFORE
// hydration, reproducing the distinction the pure sorting tests cannot catch.
function database(members: GroupMemberItem[], cap = 100) {
  return {
    from(table: string) {
      let ids: string[] | undefined;
      let start = 0;
      let end = Infinity;
      let head = false;
      const query = {
        select(_fields: string, options?: { head?: boolean }) { head = !!options?.head; return query; },
        eq() { return query; },
        is() { return query; },
        order() { return query; },
        in(_field: string, values: string[]) { ids = values; return query; },
        range(from: number, to: number) { start = from; end = to + 1; return query; },
        limit(limit: number) { end = limit; return query; },
        maybeSingle() { return Promise.resolve({ data: { created_by: "user-1" }, error: null }); },
        then(resolve: (result: unknown) => unknown) {
          let data: unknown[] = [];
          if (table === "room_members") data = members.map(({ user_id, joined_at }) => ({ user_id, joined_at }));
          if (table === "profiles") data = members.filter(m => ids?.includes(m.user_id)).map(m => ({ ...m, id: m.user_id }));
          if (table === "group_membership") data = members.filter(m => ids?.includes(m.wallet_address!));
          return Promise.resolve({ data: head ? null : data.slice(start, Math.min(end, start + cap)), count: members.length, error: null }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as Parameters<typeof paginateGroupMembers>[0];
}

describe("database-backed pagination", () => {
  const params = { roomId: "room", currentUserId: "user-1", limit: 2 };
  for (const sortBy of ["joined_at", "username", "role"] as const) {
    for (const sortOrder of ["asc", "desc"] as const) {
      it(`paginates globally by ${sortBy} ${sortOrder} with forward and backward cursors`, async () => {
        const db = database(mockMembers);
        const options = { ...params, sortBy, sortOrder };
        const expected = sortAndPaginateMembers(mockMembers, { limit: 100, offset: 0, sortBy, sortOrder }).paginatedMembers;
        const first = await paginateGroupMembers(db, options);
        const second = await paginateGroupMembers(db, { ...options, cursor: first.nextCursor! });
        expect(first.members).toHaveLength(2);
        expect(second.members).toHaveLength(2);
        expect([...first.members, ...second.members].map(m => m.user_id)).toEqual(expected.map(m => m.user_id));
        expect(second.page).toBe(2);
        expect(second.totalCount).toBe(4);
        expect(second.hasMore).toBe(false);
        expect(second.nextCursor).toBeNull();
        const back = await paginateGroupMembers(db, { ...options, cursor: second.prevCursor! });
        expect(back.members).toEqual(first.members);
        const offsetPage = await paginateGroupMembers(db, { ...options, page: 2 });
        expect(offsetPage.members).toEqual(second.members);
      });
    }
  }

  it("bounds invalid cursor responses and supports empty display names", async () => {
    const members = mockMembers.map(m => ({ ...m, display_name: null, username: null }));
    const db = database(members);
    const first = await paginateGroupMembers(db, { ...params, sortBy: "username", cursor: "bad" });
    const second = await paginateGroupMembers(db, { ...params, sortBy: "username", cursor: first.nextCursor! });
    expect(first.members).toHaveLength(2);
    expect(second.members.map(m => m.user_id)).toEqual(["user-3", "user-4"]);
  });

  it("handles empty groups, out-of-range pages and zero limits", async () => {
    expect(await paginateGroupMembers(database([]), params)).toMatchObject({ members: [], totalCount: 0, totalPages: 0, hasMore: false });
    expect(await paginateGroupMembers(database(mockMembers), { ...params, page: 8 })).toMatchObject({ members: [], page: 8, hasMore: false });
    expect(await paginateGroupMembers(database(mockMembers), { ...params, limit: 0 })).toMatchObject({ pageSize: 1 });
  });

  it("reads multiple database batches without losing members", async () => {
    const members = Array.from({ length: 205 }, (_, i) => ({ ...mockMembers[0], user_id: `id-${String(i).padStart(3, "0")}`, display_name: `name-${String(205 - i).padStart(3, "0")}` }));
    const result = await paginateGroupMembers(database(members), { ...params, sortBy: "username" });
    expect(result.totalCount).toBe(205);
    expect(result.members.map(m => m.user_id)).toEqual(["id-204", "id-203"]);
  });
});
