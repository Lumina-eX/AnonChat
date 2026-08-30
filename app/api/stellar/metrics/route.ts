import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logBlockchainOperation, generateCorrelationId } from "@/lib/blockchain/logger";

export async function GET(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co";
    if (supabaseUrl.includes("dummy")) {
      return NextResponse.json({
        metrics: {
          totalAttempts: 0,
          successfulSubmissions: 0,
          failedAttempts: 0,
          duplicateDetections: 0,
          retriesNeeded: 0,
          averageAttemptsPerSuccess: 0,
          failureRate: 0,
          periodHours: 24,
        },
      });
    }

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Time window: last 24 hours
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Get all attempts in the time window
    const { data: attempts, error } = await supabase
      .from("stellar_transaction_attempts")
      .select("id, status, attempt_count, created_at, confirmed_at, failed_at")
      .gte("created_at", since);

    if (error) {
      logBlockchainOperation("error", "Failed to fetch metrics", {
        error: { type: "DatabaseError", message: error.message },
      }, correlationId);
      return NextResponse.json(
        { error: "Failed to fetch metrics" },
        { status: 500 }
      );
    }

    const totalAttempts = attempts?.length || 0;
    const successfulSubmissions = attempts?.filter((a) => a.status === "submitted").length || 0;
    const failedAttempts = attempts?.filter((a) => a.status === "failed").length || 0;
    const duplicateDetections = attempts?.filter((a) => a.status === "duplicate").length || 0;

    // Calculate retries needed (successful attempts with attempt_count > 1)
    const retriesNeeded =
      attempts?.filter((a) => a.status === "submitted" && a.attempt_count > 1).length || 0;

    // Average attempts per successful submission
    const successfulWithAttempts = attempts?.filter((a) => a.status === "submitted") || [];
    const averageAttemptsPerSuccess =
      successfulWithAttempts.length > 0
        ? successfulWithAttempts.reduce((sum, a) => sum + (a.attempt_count || 1), 0) /
          successfulWithAttempts.length
        : 0;

    // Failure rate (excluding duplicates)
    const nonDuplicateAttempts = totalAttempts - duplicateDetections;
    const failureRate =
      nonDuplicateAttempts > 0 ? (failedAttempts / nonDuplicateAttempts) * 100 : 0;

    return NextResponse.json({
      metrics: {
        totalAttempts,
        successfulSubmissions,
        failedAttempts,
        duplicateDetections,
        retriesNeeded,
        averageAttemptsPerSuccess: Math.round(averageAttemptsPerSuccess * 100) / 100,
        failureRate: Math.round(failureRate * 100) / 100,
        periodHours: 24,
      },
    });
  } catch (error: any) {
    logBlockchainOperation("error", "Failed to compute metrics", {
      error: { type: error.name || "UnknownError", message: error.message },
    }, correlationId);
    return NextResponse.json(
      { error: "Failed to compute metrics" },
      { status: 500 }
    );
  }
}
