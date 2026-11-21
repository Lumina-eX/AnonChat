import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  cleanupExpiredMessages,
  getCleanupLogs,
  getCleanupStats,
} from "@/lib/ephemeral-cleanup";

const CLEANUP_SECRET = process.env.EPHEMERAL_CLEANUP_SECRET;

/**
 * POST /api/ephemeral/cleanup - Trigger ephemeral message cleanup
 * Authorization: Requires EPHEMERAL_CLEANUP_SECRET header (for cron jobs)
 * or can be triggered manually for testing
 */
export async function POST(request: NextRequest) {
  try {
    // Check authorization (from environment variable for cron security)
    const authHeader = request.headers.get("X-Cleanup-Secret");
    if (!authHeader || authHeader !== CLEANUP_SECRET) {
      logger.warn("Unauthorized cleanup attempt with invalid secret");
      return NextResponse.json(
        { error: "Unauthorized - invalid cleanup secret" },
        { status: 401 }
      );
    }

    logger.info("Triggering manual ephemeral message cleanup");
    const result = await cleanupExpiredMessages();

    return NextResponse.json({
      success: true,
      result,
      message: `Cleanup completed. ${result.totalDeleted} messages deleted.`,
    });
  } catch (error) {
    logger.error("Error in POST /api/ephemeral/cleanup:", error as Record<string, unknown>);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/ephemeral/cleanup - Get cleanup statistics and status
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    // Get logs
    if (action === "logs") {
      const roomId = searchParams.get("room_id");
      const limit = Number.parseInt(searchParams.get("limit") || "50");
      const offset = Number.parseInt(searchParams.get("offset") || "0");

      const logs = await getCleanupLogs({
        roomId: roomId || undefined,
        limit,
        offset,
      });

      return NextResponse.json({ logs });
    }

    // Get statistics
    const stats = await getCleanupStats();
    return NextResponse.json({ stats });
  } catch (error) {
    logger.error(
      "Error in GET /api/ephemeral/cleanup:",
      error as Record<string, unknown>
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
