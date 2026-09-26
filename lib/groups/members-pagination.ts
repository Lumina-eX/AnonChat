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
    const separator = raw.lastIndexOf(":::");
    if (separator < 0 || separator + 3 === raw.length) {
      return null;
    }
    return { sortValue: raw.slice(0, separator), userId: raw.slice(separator + 3) };
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

  const cursorFor = (index: number) =>
    encodeCursor(buildSortValue(sorted[index], sortBy), sorted[index].user_id);
  const nextCursor = paginatedMembers.length > 0 && hasMore
    ? cursorFor(startIndex + paginatedMembers.length - 1)
    : null;
  // A cursor identifies the row before the requested page. The empty user ID
  // sentinel decodes as invalid and intentionally returns the first page.
  const previousStart = Math.max(0, startIndex - limit);
  const prevCursor = startIndex > 0 && paginatedMembers.length > 0
    ? previousStart === 0 ? encodeCursor("start", "") : cursorFor(previousStart - 1)
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
  const limit = Math.min(Math.max(Number.isFinite(params.limit) ? Math.floor(params.limit!) : DEFAULT_LIMIT, 1), MAX_LIMIT);
  const sortBy = normalizeSortField(params.sortBy);
  const sortOrder: SortOrder = params.sortOrder === "desc" ? "desc" : "asc";

  let offset = 0;
  if (params.offset !== undefined && params.offset >= 0) {
    offset = params.offset;
  } else if (params.page !== undefined && params.page >= 1) {
    offset = (params.page - 1) * limit;
  }

  // 1. Fetch room to determine creator/owner
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("created_by")
    .eq("id", roomId)
    .maybeSingle();

  if (roomError) throw new Error(`Failed to fetch room: ${roomError.message}`);
  const creatorUserId = room?.created_by || null;

  // Fetch deterministic batches so the server row cap cannot truncate the group.
  // Names and roles live in separate tables: hydrate before sorting and slicing.
  const memberRows: { user_id: string; joined_at: string }[] = [];
  const profileById = new Map<string, {
    display_name: string | null; username: string | null;
    wallet_address: string | null; avatar_url: string | null;
  }>();
  const roleByWallet = new Map<string, MemberRole>();
  const batchSize = 100;
  for (let start = 0; ; ) {
    const { data, error } = await supabase
      .from("room_members")
      .select("user_id, joined_at")
      .eq("room_id", roomId)
      .is("removed_at", null)
      .order("user_id", { ascending: true })
      .range(start, start + batchSize - 1);
    if (error) throw new Error(`Failed to fetch room members: ${error.message}`);
    const batch = data || [];
    if (batch.length === 0) break;
    memberRows.push(...batch);
    start += batch.length;
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name, username, wallet_address, avatar_url")
      .in("id", batch.map((member) => member.user_id));
    if (profileError) throw new Error(`Failed to fetch member profiles: ${profileError.message}`);
    for (const profile of profiles || []) profileById.set(profile.id, profile);
    const wallets = (profiles || []).map((profile) => profile.wallet_address).filter(Boolean);
    if (wallets.length) {
      const { data: roles, error: roleError } = await supabase
        .from("group_membership")
        .select("wallet_address, role")
        .eq("group_id", roomId)
        .in("wallet_address", wallets);
      if (roleError) throw new Error(`Failed to fetch member roles: ${roleError.message}`);
      for (const member of roles || []) roleByWallet.set(member.wallet_address, member.role as MemberRole);
    }
  }
  const safeTotalCount = memberRows.length;

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

  const result = sortAndPaginateMembers(enrichedMembers, {
    limit, offset, cursor: params.cursor, sortBy, sortOrder,
  });
  return {
    members: result.paginatedMembers,
    totalCount: safeTotalCount,
    pageSize: limit,
    page: result.effectivePage,
    totalPages: Math.ceil(safeTotalCount / limit),
    hasMore: result.hasMore,
    nextCursor: result.nextCursor,
    prevCursor: result.prevCursor,
  };
}
