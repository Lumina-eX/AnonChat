import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * POST /api/notifications/mark-all-read
 * Marks all unread notifications as read for the authenticated user.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", user.id)
      .is("read_at", null)
      .select("id");

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      updatedCount: data?.length ?? 0,
    });
  } catch (error) {
    console.error("[notifications] POST mark-all-read error:", error);
    return NextResponse.json(
      { error: "Failed to mark all notifications as read" },
      { status: 500 },
    );
  }
}
