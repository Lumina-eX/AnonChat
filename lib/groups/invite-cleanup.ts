import { createClient } from "@/lib/supabase/server";

export interface CleanupResult {
  success: boolean;
  cleaned_count: number;
  time_expired_count: number;
  usage_expired_count: number;
  details: string;
  error?: string;
}

/**
 * Cleans up expired invite codes from the database.
 * Can be run periodically (e.g., hourly via cron job or webhook).
 * 
 * @param roomId - Optional: limit cleanup to specific room
 * @param dryRun - Optional: if true, counts expired invites without logging
 * @returns Cleanup result with counts and details
 */
export async function cleanupExpiredInvites(
  roomId?: string,
  dryRun: boolean = false,
): Promise<CleanupResult> {
  try {
    const supabase = await createClient();

    const { data: result, error } = await supabase.rpc(
      "cleanup_expired_invites",
      {
        p_room_id: roomId || null,
        p_dry_run: dryRun,
      },
    );

    if (error) {
      console.error("[invite-cleanup] Database error:", error);
      return {
        success: false,
        cleaned_count: 0,
        time_expired_count: 0,
        usage_expired_count: 0,
        details: "Failed to clean up expired invites",
        error: error.message,
      };
    }

    const cleanupData = result?.[0] || {};
    const success = cleanupData.cleaned_count >= 0;

    if (success) {
      console.info(
        `[invite-cleanup] Successfully cleaned up ${cleanupData.cleaned_count} expired invites. ${cleanupData.details}`,
      );
    }

    return {
      success,
      cleaned_count: cleanupData.cleaned_count || 0,
      time_expired_count: cleanupData.time_expired_count || 0,
      usage_expired_count: cleanupData.usage_expired_count || 0,
      details: cleanupData.details || "No expired invites found",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[invite-cleanup] Unexpected error:", error);
    return {
      success: false,
      cleaned_count: 0,
      time_expired_count: 0,
      usage_expired_count: 0,
      details: "Unexpected error during cleanup",
      error: errorMessage,
    };
  }
}

/**
 * Gets expiration logs for audit/monitoring purposes
 * 
 * @param roomId - Optional: limit to specific room
 * @param limit - Number of recent logs to fetch (default: 50)
 * @returns Array of expiration log entries
 */
export async function getExpirationLogs(
  roomId?: string,
  limit: number = 50,
): Promise<Array<{
  id: string;
  invite_code: string;
  room_id: string;
  expiration_type: string;
  created_at: string;
  metadata: Record<string, unknown>;
}>> {
  try {
    const supabase = await createClient();

    let query = supabase
      .from("invite_expiration_logs")
      .select("id, invite_code, room_id, expiration_type, created_at, metadata")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (roomId) {
      query = query.eq("room_id", roomId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[invite-cleanup] Error fetching logs:", error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error("[invite-cleanup] Unexpected error fetching logs:", error);
    return [];
  }
}
