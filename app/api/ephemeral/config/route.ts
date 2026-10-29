import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
  getRoomTTL,
  getGlobalTTL,
  cleanupExpiredMessages,
  getCleanupLogs,
  getCleanupStats,
} from "@/lib/ephemeral-cleanup";
import { EPHEMERAL_CONFIG } from "@/lib/ephemeral-config";

type EphemeralConfigResult = {
  room?: Record<string, unknown> | null;
  global?: Record<string, unknown>;
  constants?: {
    DEFAULT_TTL_SECONDS: number;
    MIN_TTL_SECONDS: number;
    MAX_TTL_SECONDS: number;
  };
};

type LoggableError = Record<string, unknown>;

function toLoggable(error: unknown): LoggableError {
  if (error !== null && typeof error === "object") {
    return error as LoggableError;
  }
  return { value: String(error) };
}

/**
 * GET /api/ephemeral/config - Get ephemeral message configuration
 * Query params:
 *  - room_id: Get config for specific room
 *  - type: 'global' | 'room' (default: both)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get("room_id");
    const type = searchParams.get("type") || "both";

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Check if user is admin (or room creator for room-specific config)
    if (roomId) {
      const { data: room } = await supabase
        .from("rooms")
        .select("created_by")
        .eq("id", roomId)
        .maybeSingle();

      if (!room || room.created_by !== user.id) {
        return NextResponse.json(
          { error: "Forbidden - only room creator can view config" },
          { status: 403 }
        );
      }
    }

    const result: EphemeralConfigResult = {};

    // Get room-specific config
    if ((type === "both" || type === "room") && roomId) {
      const { data: roomConfig, error: roomError } = await supabase
        .from("ephemeral_message_config")
        .select("*")
        .eq("room_id", roomId)
        .maybeSingle();

      if (roomError) {
        logger.error("Error fetching room config:", toLoggable(roomError));
      }

      result.room = roomConfig || null;
    }

    // Get global config
    if (type === "both" || type === "global") {
      const { data: globalConfig, error: globalError } = await supabase
        .from("global_ephemeral_config")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (globalError) {
        logger.error("Error fetching global config:", toLoggable(globalError));
      }

      result.global = globalConfig || {
        ttl_seconds: EPHEMERAL_CONFIG.DEFAULT_TTL_SECONDS,
      };
    }

    result.constants = {
      DEFAULT_TTL_SECONDS: EPHEMERAL_CONFIG.DEFAULT_TTL_SECONDS,
      MIN_TTL_SECONDS: EPHEMERAL_CONFIG.MIN_TTL_SECONDS,
      MAX_TTL_SECONDS: EPHEMERAL_CONFIG.MAX_TTL_SECONDS,
    };

    return NextResponse.json(result);
  } catch (error) {
    logger.error("Error in GET /api/ephemeral/config:", toLoggable(error));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ephemeral/config - Create or update configuration
 * Body:
 *  - room_id: string (optional, if provided updates room config)
 *  - ttl_seconds: number
 *  - enabled: boolean (optional, default: true)
 *  - is_global: boolean (if true, updates global config)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const rawBody: unknown = await request.json();
    const body: Record<string, unknown> =
      rawBody !== null && typeof rawBody === "object"
        ? (rawBody as Record<string, unknown>)
        : {};
    const room_id = typeof body.room_id === "string" ? body.room_id : undefined;
    const ttl_seconds =
      typeof body.ttl_seconds === "number" ? body.ttl_seconds : undefined;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
    const is_global = body.is_global === true;

    // Validate TTL
    if (!ttl_seconds || ttl_seconds < EPHEMERAL_CONFIG.MIN_TTL_SECONDS ||
        ttl_seconds > EPHEMERAL_CONFIG.MAX_TTL_SECONDS) {
      return NextResponse.json(
        {
          error: `TTL must be between ${EPHEMERAL_CONFIG.MIN_TTL_SECONDS} and ${EPHEMERAL_CONFIG.MAX_TTL_SECONDS} seconds`,
        },
        { status: 400 }
      );
    }

    // Global config update - admin only (for now, allow any authenticated user)
    if (is_global) {
      const { data, error } = await supabase
        .from("global_ephemeral_config")
        .update({
          ttl_seconds,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .select()
        .single();

      if (error) {
        logger.error("Error updating global config:", toLoggable(error));
        throw error;
      }

      logger.info(`Global ephemeral config updated by ${user.id}:`, {
        ttl_seconds,
      });
      return NextResponse.json(data);
    }

    // Room-specific config
    if (!room_id) {
      return NextResponse.json(
        { error: "room_id is required for room-specific config" },
        { status: 400 }
      );
    }

    // Check if user is room creator
    const { data: room } = await supabase
      .from("rooms")
      .select("created_by")
      .eq("id", room_id)
      .maybeSingle();

    if (!room || room.created_by !== user.id) {
      return NextResponse.json(
        { error: "Forbidden - only room creator can update config" },
        { status: 403 }
      );
    }

    // Upsert room config
    const { data, error } = await supabase
      .from("ephemeral_message_config")
      .upsert(
        {
          room_id,
          ttl_seconds,
          enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id" }
      )
      .select()
      .single();

    if (error) {
      logger.error("Error updating room config:", toLoggable(error));
      throw error;
    }

    logger.info(`Room ephemeral config updated:`, { room_id, ttl_seconds });
    return NextResponse.json(data);
  } catch (error) {
    logger.error("Error in POST /api/ephemeral/config:", toLoggable(error));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
