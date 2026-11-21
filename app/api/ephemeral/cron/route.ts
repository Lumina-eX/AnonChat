import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { cleanupExpiredMessages } from "@/lib/ephemeral-cleanup";

// Vercel Cron Route for ephemeral message cleanup
// Configure in vercel.json:
// {
//   "crons": [{
//     "path": "/api/ephemeral/cron",
//     "schedule": "0 */6 * * *"  // Every 6 hours
//   }]
// }
export async function GET(request: NextRequest) {
  // Verify request is from Vercel cron
  const authHeader = request.headers.get("Authorization");

  // Vercel sends requests with specific headers
  // For local testing, allow bypass, but in production require proper auth
  if (process.env.NODE_ENV === "production") {
    const vercelCronSecret = process.env.VERCEL_CRON_SECRET;
    if (!vercelCronSecret || authHeader !== `Bearer ${vercelCronSecret}`) {
      logger.warn("Unauthorized cron request");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }
  }

  try {
    logger.info("Vercel cron: Starting ephemeral message cleanup");

    const result = await cleanupExpiredMessages();

    logger.info("Vercel cron: Cleanup completed", { result });

    return NextResponse.json({
      success: true,
      message: "Ephemeral message cleanup completed",
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Error in cron job:", error as Record<string, unknown>);

    // Return 200 so cron doesn't retry, but log the error
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 200 } // Important: return 200 to prevent cron retry
    );
  }
}
