import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import { parsePagination } from "@/lib/notifications/service";

/**
 * GET /api/notifications
 *
 * Query params:
 * - limit (1-100, default 20)
 * - offset (default 0)
 * - unread_only (true|false, default false)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { limit, offset, unreadOnly } = parsePagination(
      request.nextUrl.searchParams,
    );

    let query = supabase
      .from("notifications")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (unreadOnly) {
      query = query.is("read_at", null);
    }

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    const { count: unreadCount, error: unreadError } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);

    if (unreadError) {
      throw unreadError;
    }

    const total = count ?? 0;

    return NextResponse.json({
      notifications: data ?? [],
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + (data?.length ?? 0) < total,
      },
      unreadCount: unreadCount ?? 0,
    });
  } catch (error) {
    console.error("[notifications] GET /api/notifications error:", error);
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 },
    );
  }
}
