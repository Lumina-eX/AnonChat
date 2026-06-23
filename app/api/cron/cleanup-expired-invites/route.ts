import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredInvites } from "@/lib/groups/invite-cleanup";

/**
 * Scheduled cleanup endpoint for expired invite codes.
 * 
 * Can be called by:
 * - Vercel Cron (requires correct cron secret)
 * - External cron service with authorization header
 * - Internal scheduled tasks
 * 
 * Query parameters:
 * - room_id: (optional) Limit cleanup to specific room
 * - dry_run: (optional) If true, count expired codes without logging
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authorization (check for secret or cron header)
    const authHeader = request.headers.get("authorization");
    const vercelCron = request.headers.get("x-vercel-cron");

    if (!vercelCron && !authHeader) {
      return NextResponse.json(
        { error: "Unauthorized - Missing authorization" },
        { status: 401 },
      );
    }

    // If using custom auth, verify the secret
    if (authHeader) {
      const expectedSecret = process.env.CLEANUP_SECRET;
      if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
        return NextResponse.json(
          { error: "Unauthorized - Invalid secret" },
          { status: 401 },
        );
      }
    }

    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get("room_id") || undefined;
    const dryRun = searchParams.get("dry_run") === "true";

    console.info("[cleanup-cron] Starting scheduled cleanup of expired invites...");

    const result = await cleanupExpiredInvites(roomId, dryRun);

    if (!result.success) {
      console.error("[cleanup-cron] Cleanup failed:", result.error);
      return NextResponse.json(
        {
          success: false,
          message: "Cleanup failed",
          error: result.error,
        },
        { status: 500 },
      );
    }

    console.info(`[cleanup-cron] Cleanup completed: ${result.details}`);

    return NextResponse.json(
      {
        success: true,
        message: "Cleanup completed successfully",
        results: {
          cleaned_count: result.cleaned_count,
          time_expired_count: result.time_expired_count,
          usage_expired_count: result.usage_expired_count,
          details: result.details,
          dry_run: dryRun,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[cleanup-cron] Unexpected error:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error during cleanup",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
