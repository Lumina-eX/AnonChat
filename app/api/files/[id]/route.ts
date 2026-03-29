import { createClient } from "@/lib/supabase/server"
import { getActiveRoomMembership } from "@/lib/encrypted-files/room-access"
import { type NextRequest, NextResponse } from "next/server"

/**
 * Metadata-only access for active room members (e.g. inline preview UIs without re-submitting a token).
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Invalid file reference id" }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: row, error } = await supabase
      .from("encrypted_file_references")
      .select(
        "id, room_id, content_type, size_bytes, original_filename, sha256_checksum, created_at"
      )
      .eq("id", id)
      .maybeSingle()

    if (error) throw error
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const membership = await getActiveRoomMembership(supabase, row.room_id, user.id)
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json({ file_reference: row })
  } catch (err) {
    console.error("[encrypted-files] GET /api/files/[id]:", err)
    return NextResponse.json({ error: "Failed to load file reference" }, { status: 500 })
  }
}
