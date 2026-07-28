import { type NextRequest, NextResponse } from "next/server";
import { cleanupExpiredSessions } from "@/lib/auth/session-service";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const expectedSecret = process.env.SESSION_CLEANUP_SECRET;

    if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const removedCount = await cleanupExpiredSessions();

    return NextResponse.json({
      ok: true,
      removedCount,
    });
  } catch (err) {
    logger.error("sessions.cleanup_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}