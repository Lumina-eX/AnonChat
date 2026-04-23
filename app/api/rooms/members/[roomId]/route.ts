import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { roomId } = params;

    if (!roomId) {
      return NextResponse.json(
        { error: "roomId is required" },
        { status: 400 }
      );
    }

    const { data: members, error } = await supabase
      .from("room_members")
      .select("user_id, joined_at, removed_at")
      .eq("room_id", roomId)
      .is("removed_at", null)
      .order("joined_at", { ascending: true });

    if (error) throw error;

    return NextResponse.json({
      members: (members ?? []).map((m) => ({
        user_id: m.user_id,
        joined_at: m.joined_at,
        is_current_user: m.user_id === user.id,
      })),
    });
  } catch (error) {
    console.error("[rooms/members] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch members" },
      { status: 500 }
    );
  }
}