/**
 * Per-room TTL configuration
 *
 * GET  /api/rooms/[roomId]/ttl
 *   Returns the room's current default_ttl_seconds.
 *   Any authenticated room member can read this.
 *
 * PATCH /api/rooms/[roomId]/ttl
 *   Updates the room's default_ttl_seconds.
 *   Only the room creator is allowed to change this.
 *   Body: { "default_ttl_seconds": number | null }
 *     - number ≥ 1  → new messages in this room expire after N seconds
 *     - 0           → messages in this room are non-ephemeral by default
 *     - null        → inherit the system-wide default (EPHEMERAL_TTL_SECONDS)
 */

import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { EPHEMERAL_CONFIG } from "@/lib/ephemeral/config"
import { logCleanup } from "@/lib/ephemeral/logger"

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { roomId } = await params

    // Verify the caller is a member of this room
    const { data: membership } = await supabase
      .from("room_members")
      .select("id")
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: room, error } = await supabase
      .from("rooms")
      .select("id, default_ttl_seconds")
      .eq("id", roomId)
      .maybeSingle()

    if (error) throw error
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 })

    const effectiveTtl =
      room.default_ttl_seconds !== null && room.default_ttl_seconds !== undefined
        ? room.default_ttl_seconds
        : EPHEMERAL_CONFIG.defaultTtlSeconds

    return NextResponse.json({
      room_id: roomId,
      default_ttl_seconds: room.default_ttl_seconds ?? null,
      effective_ttl_seconds: effectiveTtl,
      system_default_ttl_seconds: EPHEMERAL_CONFIG.defaultTtlSeconds,
    })
  } catch (err) {
    console.error("[rooms/ttl] GET error:", err)
    return NextResponse.json({ error: "Failed to fetch TTL config" }, { status: 500 })
  }
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { roomId } = await params

    // Only the room creator may change TTL settings
    const { data: room, error: roomErr } = await supabase
      .from("rooms")
      .select("id, created_by")
      .eq("id", roomId)
      .maybeSingle()

    if (roomErr) throw roomErr
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 })
    if (room.created_by !== user.id) {
      return NextResponse.json(
        { error: "Forbidden. Only the room creator can change TTL settings." },
        { status: 403 },
      )
    }

    // Parse and validate body
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (typeof body !== "object" || body === null || !("default_ttl_seconds" in body)) {
      return NextResponse.json(
        { error: "Body must contain default_ttl_seconds (integer ≥ 0, or null to inherit system default)" },
        { status: 400 },
      )
    }

    const raw = (body as Record<string, unknown>).default_ttl_seconds

    let newTtl: number | null
    if (raw === null) {
      newTtl = null
    } else {
      const parsed = typeof raw === "number" ? Math.floor(raw) : parseInt(String(raw), 10)
      if (!Number.isFinite(parsed) || parsed < 0) {
        return NextResponse.json(
          { error: "default_ttl_seconds must be a non-negative integer or null" },
          { status: 400 },
        )
      }
      newTtl = parsed
    }

    const { error: updateErr } = await supabase
      .from("rooms")
      .update({ default_ttl_seconds: newTtl })
      .eq("id", roomId)

    if (updateErr) throw updateErr

    logCleanup("info", "Room TTL updated", {
      roomId,
      updatedBy: user.id,
      default_ttl_seconds: newTtl,
    })

    const effectiveTtl =
      newTtl !== null ? newTtl : EPHEMERAL_CONFIG.defaultTtlSeconds

    return NextResponse.json({
      success: true,
      room_id: roomId,
      default_ttl_seconds: newTtl,
      effective_ttl_seconds: effectiveTtl,
    })
  } catch (err) {
    console.error("[rooms/ttl] PATCH error:", err)
    return NextResponse.json({ error: "Failed to update TTL config" }, { status: 500 })
  }
}
