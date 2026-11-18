import { NextResponse } from "next/server";

type RequireGroupAccessParams = {
  supabase: any;
  groupId: string;
  userId: string;
};

/**
 * Verifies that the user has access to the group (as owner or member).
 * Returns an object with `authorized: true` when check passes, otherwise
 * returns a `NextResponse` with a properly shaped error JSON body.
 */
export async function requireGroupAccess({
  supabase,
  groupId,
  userId,
}: RequireGroupAccessParams): Promise<any> {
  try {
    const { data: room, error } = await supabase
      .from("rooms")
      .select("id, created_by, is_private")
      .eq("id", groupId)
      .maybeSingle();

    if (error) {
      console.error("[requireGroupAccess] group lookup error:", error);
      return NextResponse.json({ error: "Failed to retrieve group" }, { status: 500 });
    }

    if (!room) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Creator always has access
    if (room.created_by === userId) {
      return { authorized: true, isOwner: true };
    }

    // Public groups: any authenticated user has access
    if (!room.is_private) {
      return { authorized: true, isOwner: false };
    }

    // Private groups: check membership
    const { data: membership } = await supabase
      .from("room_members")
      .select("id")
      .eq("room_id", groupId)
      .eq("user_id", userId)
      .is("removed_at", null)
      .maybeSingle();

    if (membership) {
      return { authorized: true, isOwner: false };
    }

    return NextResponse.json(
      { error: "Access denied", message: "You do not have access to this group." },
      { status: 403 }
    );
  } catch (err) {
    console.error("[requireGroupAccess] unexpected error:", err);
    return NextResponse.json({ error: "Failed to verify access" }, { status: 500 });
  }
}

export default requireGroupAccess;
