import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";

/**
 * PATCH /api/notifications/[id]/read
 * Marks a single notification as read for the authenticated user.
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Notification ID is required" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .is("read_at", null)
      .select("*")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!existing) {
        return NextResponse.json(
          { error: "Notification not found" },
          { status: 404 },
        );
      }

      return NextResponse.json({
        success: true,
        message: "Notification already marked as read",
      });
    }

    return NextResponse.json({ success: true, notification: data });
  } catch (error) {
    console.error("[notifications] PATCH read error:", error);
    return NextResponse.json(
      { error: "Failed to mark notification as read" },
      { status: 500 },
    );
  }
}
