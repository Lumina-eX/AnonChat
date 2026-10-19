import { NextResponse } from "next/server";

/**
 * Centralized group permission policy and authorization service.
 *
 * Roles:
 *   - owner:     group creator. Full control over group management,
 *                members, join requests, moderation, retention policies.
 *   - moderator: review join requests, moderate messages, manage members,
 *                access moderation tools.
 *   - member:    view authorized content, send messages, access approved
 *                resources, manage own content.
 *
 * Permissions are enforced server-side and shared between REST and WebSocket
 * entry points via the exported helpers below.
 */

export type GroupRole = "owner" | "moderator" | "member" | null;

export type GroupPermission =
  | "group:view"
  | "group:update_settings"
  | "group:delete"
  | "member:view"
  | "member:invite"
  | "member:remove"
  | "member:update_role"
  | "join_request:view"
  | "join_request:review"
  | "message:create"
  | "message:delete_own"
  | "message:delete_any"
  | "message:moderate"
  | "file:view"
  | "file:upload"
  | "retention_policy:manage";

/**
 * Default role permission matrix. This is the single source of truth for
 * authorization decisions across the application.
 */
export const ROLE_PERMISSIONS: Record<Exclude<GroupRole, null>, ReadonlySet<GroupPermission>> = {
  owner: new Set<GroupPermission>([
    "group:view",
    "group:update_settings",
    "group:delete",
    "member:view",
    "member:invite",
    "member:remove",
    "member:update_role",
    "join_request:view",
    "join_request:review",
    "message:create",
    "message:delete_own",
    "message:delete_any",
    "message:moderate",
    "file:view",
    "file:upload",
    "retention_policy:manage",
  ]),
  moderator: new Set<GroupPermission>([
    "group:view",
    "member:view",
    "member:invite",
    "member:remove",
    "join_request:view",
    "join_request:review",
    "message:create",
    "message:delete_own",
    "message:delete_any",
    "message:moderate",
    "file:view",
    "file:upload",
  ]),
  member: new Set<GroupPermission>(["group:view", "message:create", "message:delete_own", "file:view", "file:upload"]),
};

type SupabaseLike = {
  from: (table: string) => any;
};

type RequireGroupAccessParams = {
  supabase: SupabaseLike;
  groupId: string;
  userId: string;
};

export type GroupPermissionResult = GroupPermissionResultAllowed | GroupPermissionDenied;

export type GroupPermissionResultAllowed = {
  authorized: true;
  isOwner: boolean;
  role: Exclude<GroupRole, null>;
  permissions: ReadonlySet<GroupPermission>;
};

export type GroupPermissionDenied = {
  authorized: false;
  response: NextResponse;
};

export type GroupPermissionResultType = GroupPermissionResult;

/**
 * Resolves the effective role of a user within a group.
 * - Creator => owner
 * - room_members.role => owner | moderator | member
 * - Public groups allow any authenticated user as member for viewing/posting.
 */
export async function resolveGroupRole({
  supabase,
  groupId,
  userId,
}: RequireGroupAccessParams): Promise<{
  role: GroupRole;
  isOwner: boolean;
  isMember: boolean;
  isPublic: boolean;
  room: any | null;
}> {
  const { data: room, error } = await supabase
    .from("rooms")
    .select("id, created_by, is_private")
    .eq("id", groupId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to retrieve group: ${error.message ?? error}`);
  }

  if (!room) {
    return { role: null, isOwner: false, isMember: false, isPublic: false, room: null };
  }

  if (room.created_by === userId) {
    return {
      role: "owner",
      isOwner: true,
      isMember: true,
      isPublic: !room.is_private,
      room,
    };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("room_members")
    .select("id, role")
    .eq("room_id", groupId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (membershipError) {
    throw new Error(
      `Failed to retrieve membership: ${membershipError.message ?? membershipError}`
    );
  }

  if (membership) {
    const rawRole = (membership as { role?: string | null }).role;
    const role: Exclude<GroupRole, null> =
      rawRole === "owner" || rawRole === "moderator" || rawRole === "member"
        ? rawRole
        : "member";
    return {
      role,
      isOwner: role === "owner",
      isMember: true,
      isPublic: !room.is_private,
      room,
    };
  }

  // Public groups: any authenticated user acts as a member for read/post.
  if (!room.is_private) {
    return {
      role: "member",
      isOwner: false,
      isMember: false,
      isPublic: true,
      room,
    };
  }

  return { role: null, isOwner: false, isMember: false, isPublic: false, room };
}

/**
 * Returns true if the given role has the requested permission.
 */
export function roleHasPermission(role: GroupRole, permission: GroupPermission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

/**
 * Core permission check. Validates user identity, group membership, assigned
 * role, and the requested action. Optionally validates resource ownership.
 */
export async function checkGroupPermission({
  supabase,
  groupId,
  userId,
  permission,
  resourceOwnerId,
  requireOwnership = false,
}: RequireGroupAccessParams & {
  permission: GroupPermission;
  resourceOwnerId?: string | null;
  requireOwnership?: boolean;
}): Promise<GroupPermissionResult> {
  if (!userId) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Unauthorized", message: "User identity is required." },
        { status: 401 }
      ),
    };
  }

  try {
    const { role, isOwner, isMember, isPublic, room } = await resolveGroupRole({
      supabase,
      groupId,
      userId,
    });

    if (!room) {
      return {
        authorized: false,
        response: NextResponse.json({ error: "Group not found" }, { status: 404 }),
      };
    }

    // Private groups require membership (or ownership).
    if (room.is_private && !isMember && !isOwner) {
      return {
        authorized: false,
        response: NextResponse.json(
          { error: "Access denied", message: "You do not have access to this group." },
          { status: 403 }
        ),
      };
    }

    if (!roleHasPermission(role, permission)) {
      return {
        authorized: false,
        response: NextResponse.json(
          {
            error: "Forbidden",
            message: `You do not have permission to perform '${permission}'.`,
          },
          { status: 403 }
        ),
      };
    }

    if (requireOwnership) {
      const owns =
        resourceOwnerId != null && resourceOwnerId === userId;
      if (!owns && !roleHasPermission(role, "message:delete_any")) {
        return {
          authorized: false,
          response: NextResponse.json(
            {
              error: "Forbidden",
              message: "You do not own this resource.",
            },
            { status: 403 }
          ),
        };
      }
    }

    const effectiveRole: Exclude<GroupRole, null> = role ?? (isPublic ? "member" : "member");

    return {
      authorized: true,
      isOwner,
      role: effectiveRole,
      permissions: ROLE_PERMISSIONS[effectiveRole],
    };
  } catch (err) {
    console.error("[checkGroupPermission] unexpected error:", err);
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Failed to verify permission" },
        { status: 500 }
      ),
    };
  }
}

/**
 * Verifies that the user has access to the group (as owner or member).
 * Returns an object with `authorized: true` when check passes, otherwise
 * returns a `NextResponse` with a properly shaped error JSON body.
 */
export async function requireGroupAccess({
  supabase,
  groupId,
  userId,
}: RequireGroupAccessParams): Promise<GroupPermissionResultAllowed | NextResponse> {
  const result = await checkGroupPermission({
    supabase,
    groupId,
    userId,
    permission: "group:view",
  });

  if (!result.authorized) {
    return result.response;
  }

  return {
    authorized: true,
    isOwner: result.isOwner,
    role: result.role,
    permissions: result.permissions,
  };
}

/**
 * Requires a specific permission for a group operation. Used by REST
 * endpoints and WebSocket handlers alike.
 */
export async function requireGroupPermission({
  supabase,
  groupId,
  userId,
  permission,
  resourceOwnerId,
  requireOwnership,
}: RequireGroupAccessParams & {
  permission: GroupPermission;
  resourceOwnerId?: string | null;
  requireOwnership?: boolean;
}): Promise<GroupPermissionResultAllowed | NextResponse> {
  const result = await checkGroupPermission({
    supabase,
    groupId,
    userId,
    permission,
    resourceOwnerId,
    requireOwnership,
  });

  if (!result.authorized) {
    return result.response;
  }

  return {
    authorized: true,
    isOwner: result.isOwner,
    role: result.role,
    permissions: result.permissions,
  };
}

/**
 * Boolean helper for WebSocket handlers that need to enforce the same
 * permission rules as REST endpoints. Returns `true` when the user is
 * authorized for the given permission, false otherwise.
 */
export async function hasGroupPermission({
  supabase,
  groupId,
  userId,
  permission,
  resourceOwnerId,
  requireOwnership,
}: RequireGroupAccessParams & {
  permission: GroupPermission;
  resourceOwnerId?: string | null;
  requireOwnership?: boolean;
}): Promise<boolean> {
  const result = await checkGroupPermission({
    supabase,
    groupId,
    userId,
    permission,
    resourceOwnerId,
    requireOwnership,
  });
  return result.authorized;
}
