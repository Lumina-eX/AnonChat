/**
 * Group Member Pagination & Access Control Service
 *
 * Implements cursor-based and offset-based pagination, multi-field sorting,
 * and authorization checks for room/group member retrieval.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type MemberRole = "owner" | "moderator" | "member";

export type SortField =
  | "joinDate"
  | "joined_at"
  | "role"
  | "username"
  | "display_name";

export type SortOrder = "asc" | "desc";

export interface GroupMemberItem {
  user_id: string;
  joined_at: string;
  is_current_user: boolean;
  display_name: string | null;
  username: string | null;
  wallet_address: string | null;
  avatar_url: string | null;
  role: MemberRole;
}

export interface GroupMembersPaginationParams {
  roomId: string;
  currentUserId: string;
  limit?: number;
  offset?: number;
  page?: number;
  cursor?: string;
  sortBy?: SortField;
  sortOrder?: SortOrder;
}

export interface PaginatedGroupMembersResponse {
  members: GroupMemberItem[];
  totalCount: number;
  pageSize: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
}

export type GroupAccessCheckResult =
  | { authorized: true; room: { id: string; name: string; created_by: string; is_private?: boolean } }
  | { authorized: false; reason: "not_found" | "unauthorized" | "error"; error?: string };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const ROLE_PRIORITY: Record<MemberRole, number> = {
  owner: 3,
  moderator: 2,
  member: 1,
};

/**
 * Encodes a sort value and user ID into an opaque cursor token.
 */
export function encodeCursor(sortValue: string, userId: string): string {
  const raw = `${sortValue}:::${userId}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

/**
 * Decodes an opaque cursor token into its sort value and user ID components.
 */
export function decodeCursor(cursor: string): { sortValue: string; userId: string } | null {
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

/**
 * Verifies if a user is authorized to query members of a group.
 * Authorization rules:
 *   1. Room must exist.
 *   2. If room is public, authenticated users can view members.
 *   3. Room creator/owner is always authorized.
 *   4. Active members (room_members where removed_at is null) are authorized.
 */
export async function verifyGroupMemberAccess(
  supabase: SupabaseClient,
  roomId: string,
  userId: string,
): Promise<GroupAccessCheckResult> {
  try {
    // 1. Check room existence
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("id, name, created_by, is_private")
      .eq("id", roomId)
      .maybeSingle();

    if (roomError) {
      return { authorized: false, reason: "error", error: roomError.message };
    }

    if (!room) {
      return { authorized: false, reason: "not_found" };
    }

    // 2. Room creator is always authorized
    if (room.created_by === userId) {
      return { authorized: true, room };
    }

    // 3. Public room is accessible by authenticated users
    if (room.is_private === false) {
      return { authorized: true, room };
    }

    // 4. Check active membership in room_members
    const { data: membership, error: memberError } = await supabase
      .from("room_members")
      .select("id")
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .is("removed_at", null)
      .maybeSingle();

    if (memberError && memberError.code !== "PGRST116") {
      return { authorized: false, reason: "error", error: memberError.message };
    }

    if (membership) {
      return { authorized: true, room };
    }

    // 5. Fallback: check profile wallet against group_membership
    const { data: profile } = await supabase
      .from("profiles")
      .select("wallet_address")
      .eq("id", userId)
      .maybeSingle();

    if (profile?.wallet_address) {
      const { data: groupMember } = await supabase
        .from("group_membership")
        .select("id")
        .eq("group_id", roomId)
        .eq("wallet_address", profile.wallet_address)
        .maybeSingle();

      if (groupMember) {
        return { authorized: true, room };
      }
    }

    return { authorized: false, reason: "unauthorized" };
  } catch (err: any) {
    return {
      authorized: false,
      reason: "error",
      error: err?.message || "Access validation error",
    };
  }
}

/**
 * Normalizes member sorting field.
 */
export function normalizeSortField(field?: string): "joined_at" | "role" | "username" {
  if (!field) return "joined_at";
  const lowered = field.toLowerCase().trim();
  if (lowered === "role") return "role";
  if (lowered === "username" || lowered === "display_name" || lowered === "name") return "username";
  return "joined_at";
}

function buildSortValue(member: GroupMemberItem, sortBy: "joined_at" | "role" | "username"): string {
  if (sortBy === "role") return member.role;
  if (sortBy === "username") return (member.display_name || member.username || "").toLowerCase();
  return member.joined_at;
}

function compareMembers(
  a: GroupMemberItem,
  b: GroupMemberItem,
  sortBy: "joined_at" | "role" | "username",
  sortOrder: SortOrder,
): number {
  const isAsc = sortOrder === "asc";
  const comparison =
    sortBy === "role"
      ? (ROLE_PRIORITY[a.role] || 1) - (ROLE_PRIORITY[b.role] || 1)
      : sortBy === "username"
        ? buildSortValue(a, "username").localeCompare(buildSortValue(b, "username"))
        : a.joined_at.localeCompare(b.joined_at);

  if (comparison !== 0) {
    return isAsc ? comparison : -comparison;
  }

  return a.user_id.localeCompare(b.user_id);
}

/**
 * Sorts and slices group members according to requested pagination and sorting options.
 */
export function sortAndPaginateMembers(
  members: GroupMemberItem[],
  params: {
    limit: number;
    offset: number;
    cursor?: string;
    sortBy: "joined_at" | "role" | "username";
    sortOrder: SortOrder;
  },
): {
  paginatedMembers: GroupMemberItem[];
  hasMore: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
  effectivePage: number;
} {
  const { limit, offset, cursor, sortBy, sortOrder } = params;
  const sorted = [...members].sort((a, b) => compareMembers(a, b, sortBy, sortOrder));

  let startIndex = 0;

  // Handle cursor pagination
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

/**
 * Retrieves paginated room members with profile information and roles.
 */
export async function paginateGroupMembers(
  supabase: SupabaseClient,
  params: GroupMembersPaginationParams,
): Promise<PaginatedGroupMembersResponse> {
  const { roomId, currentUserId } = params;
  const limit = Math.min(Math.max(params.limit || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const sortBy = normalizeSortField(params.sortBy);
  const sortOrder: SortOrder = params.sortOrder === "desc" ? "desc" : "asc";

  let offset = 0;
  if (params.offset !== undefined && params.offset >= 0) {
    offset = params.offset;
  } else if (params.page !== undefined && params.page >= 1) {
    offset = (params.page - 1) * limit;
  }

  // 1. Fetch room to determine creator/owner
  const { data: room } = await supabase
    .from("rooms")
    .select("created_by")
    .eq("id", roomId)
    .maybeSingle();

  const creatorUserId = room?.created_by || null;

  // 2. Count active memberships and fetch only the requested page slice
  const { count: totalCount, error: countError } = await supabase
    .from("room_members")
    .select("user_id", { count: "exact", head: true })
    .eq("room_id", roomId)
    .is("removed_at", null);

  if (countError) {
    throw new Error(`Failed to count room members: ${countError.message}`);
  }

  const safeTotalCount = totalCount || 0;

  if (safeTotalCount === 0) {
    return {
      members: [],
      totalCount: 0,
      pageSize: limit,
      page: 1,
      totalPages: 0,
      hasMore: false,
      nextCursor: null,
      prevCursor: null,
    };
  }

  // 3. Fetch only the requested page slice from room_members
  let membersQuery = supabase
    .from("room_members")
    .select("user_id, joined_at")
    .eq("room_id", roomId)
    .is("removed_at", null);

  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    if (decoded) {
      membersQuery = membersQuery.or(
        `joined_at.gt.${decoded.sortValue},and(joined_at.eq.${decoded.sortValue},user_id.gt.${decoded.userId})`,
      );
    }
  } else if (offset > 0) {
    membersQuery = membersQuery.range(offset, offset + limit - 1);
  } else {
    membersQuery = membersQuery.limit(limit);
  }

  membersQuery = membersQuery.order("joined_at", { ascending: sortOrder === "asc" });
  membersQuery = membersQuery.order("user_id", { ascending: true });

  const { data: pageRows, error: pageError } = await membersQuery;
  if (pageError) {
    throw new Error(`Failed to fetch paginated members: ${pageError.message}`);
  }

  const memberRows = pageRows || [];
  const pagedUserIds = memberRows.map((m) => m.user_id);

  // 4. Batch fetch profiles for just the page slice
  const { data: rawProfiles } = pagedUserIds.length
    ? await supabase
        .from("profiles")
        .select("id, display_name, username, wallet_address, avatar_url")
        .in("id", pagedUserIds)
    : { data: [] as any[] };

  const profileById = new Map((rawProfiles || []).map((p) => [p.id, p]));

  // 5. Batch fetch roles from group_membership for the page slice
  const walletAddresses = (rawProfiles || [])
    .map((p) => p.wallet_address)
    .filter(Boolean) as string[];

  const roleByWallet = new Map<string, MemberRole>();
  if (walletAddresses.length > 0) {
    const { data: memberships } = await supabase
      .from("group_membership")
      .select("wallet_address, role")
      .eq("group_id", roomId)
      .in("wallet_address", walletAddresses);

    for (const gm of memberships || []) {
      if (gm.wallet_address && gm.role) {
        roleByWallet.set(gm.wallet_address, gm.role as MemberRole);
      }
    }
  }

  // 6. Assemble fully hydrated member records
  const enrichedMembers: GroupMemberItem[] = memberRows.map((m) => {
    const profile = profileById.get(m.user_id);
    const wallet = profile?.wallet_address || null;
    let role: MemberRole = "member";
    if (m.user_id === creatorUserId) role = "owner";
    else if (wallet && roleByWallet.has(wallet)) role = roleByWallet.get(wallet)!;

    return {
      user_id: m.user_id,
      joined_at: m.joined_at,
      is_current_user: m.user_id === currentUserId,
      display_name: profile?.display_name || profile?.username || null,
      username: profile?.username || null,
      wallet_address: wallet,
      avatar_url: profile?.avatar_url || null,
      role,
    };
  });

  const hasMore = memberRows.length === limit;
  const nextCursor =
    enrichedMembers.length > 0 && hasMore
      ? encodeCursor(
          buildSortValue(enrichedMembers[enrichedMembers.length - 1], sortBy),
          enrichedMembers[enrichedMembers.length - 1].user_id,
        )
      : null;
  const prevCursor =
    params.cursor && enrichedMembers.length > 0
      ? encodeCursor(
          buildSortValue(enrichedMembers[0], sortBy),
          enrichedMembers[0].user_id,
        )
      : null;
  const effectivePage = params.cursor
    ? Math.floor((offset || 0) / limit) + 1
    : Math.floor((offset || 0) / limit) + 1;
  const totalPages = Math.ceil(safeTotalCount / limit);

  return {
    members: enrichedMembers.sort((a, b) => compareMembers(a, b, sortBy, sortOrder)),
    totalCount: safeTotalCount,
    pageSize: limit,
    page: effectivePage,
    totalPages,
    hasMore,
    nextCursor,
    prevCursor,
  };
}
