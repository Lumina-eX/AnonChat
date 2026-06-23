import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { room_id, dry_run = false } = body as {
      room_id?: string;
      dry_run?: boolean;
    };

    // If room_id provided, verify user is owner/member
    if (room_id) {
      const { data: room } = await supabase
        .from("rooms")
        .select("id, created_by")
        .eq("id", room_id)
        .maybeSingle();

      if (!room) {
        return NextResponse.json({ error: "Room not found" }, { status: 404 });
      }

      if (room.created_by !== user.id) {
        const { data: membership } = await supabase
          .from("room_members")
          .select("user_id")
          .eq("room_id", room_id)
          .eq("user_id", user.id)
          .maybeSingle();

        if (!membership) {
          return NextResponse.json(
            { error: "Only room members can clean up invites" },
            { status: 403 },
          );
        }
      }
    }

    // Call the cleanup function
    const { data: result, error } = await supabase.rpc(
      "cleanup_expired_invites",
      {
        p_room_id: room_id || null,
        p_dry_run: dry_run,
      },
    );

    if (error) {
      console.error("[cleanup-invites] Error:", error);
      return NextResponse.json(
        { error: "Failed to clean up expired invites" },
        { status: 500 },
      );
    }

    console.info(
      `[cleanup-invites] Cleanup completed by user ${user.id} for room ${room_id || "all"}: ${result[0]?.details}`,
    );

    return NextResponse.json(
      {
        success: true,
        cleanup: {
          cleaned_count: result[0]?.cleaned_count || 0,
          time_expired_count: result[0]?.time_expired_count || 0,
          usage_expired_count: result[0]?.usage_expired_count || 0,
          details: result[0]?.details || "No expired invites found",
          dry_run: dry_run,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error(
      "[cleanup-invites] POST /api/groups/invites/cleanup error:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to clean up expired invites" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get("room_id");
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    // Build query for expiration logs
    let query = supabase
      .from("invite_expiration_logs")
      .select(
        "id, invite_code, room_id, expiration_type, created_at, metadata",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (roomId) {
      // Verify user has access to this room
      const { data: room } = await supabase
        .from("rooms")
        .select("id, created_by")
        .eq("id", roomId)
        .maybeSingle();

      if (!room) {
        return NextResponse.json({ error: "Room not found" }, { status: 404 });
      }

      if (room.created_by !== user.id) {
        const { data: membership } = await supabase
          .from("room_members")
          .select("user_id")
          .eq("room_id", roomId)
          .eq("user_id", user.id)
          .maybeSingle();

        if (!membership) {
          return NextResponse.json(
            { error: "Access denied" },
            { status: 403 },
          );
        }
      }

      query = query.eq("room_id", roomId);
    }

    const { data: logs, error, count } = await query;

    if (error) {
      console.error("[cleanup-invites] Error fetching logs:", error);
      return NextResponse.json(
        { error: "Failed to fetch expiration logs" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        logs: logs || [],
        count: count || 0,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error(
      "[cleanup-invites] GET /api/groups/invites/cleanup error:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to fetch expiration logs" },
      { status: 500 },
    );
  }
}
