import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import { getInviteExpirationStatus } from "@/lib/groups/invite";

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
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.json(
        { error: "Invite code is required" },
        { status: 400 },
      );
    }

    const status = await getInviteExpirationStatus(supabase, code.trim());

    if (!status) {
      return NextResponse.json(
        { error: "Invite code not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        status: {
          code,
          is_expired: status.isExpired,
          is_time_expired: status.isTimeExpired,
          is_usage_expired: status.isUsageExpired,
          time_remaining: status.timeRemaining,
          uses_remaining: status.usesRemaining,
          expires_at: status.expiresAt,
          max_uses: status.maxUses,
          use_count: status.useCount,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[invite-status] GET /api/groups/invites/status error:", error);
    return NextResponse.json(
      { error: "Failed to get invite status" },
      { status: 500 },
    );
  }
}
