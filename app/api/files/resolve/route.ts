import { createClient } from "@/lib/supabase/server"
import { unsealReferenceToken } from "@/lib/encrypted-files/reference-token"
import { getActiveRoomMembership } from "@/lib/encrypted-files/room-access"
import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const bodySchema = z.object({
  reference_token: z.string().min(1),
})

const DEFAULT_TTL_SEC = 300

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const json = await request.json()
    const { reference_token } = bodySchema.parse(json)

    let payload
    try {
      payload = await unsealReferenceToken(reference_token)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid token"
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const { data: row, error: fetchErr } = await supabase
      .from("encrypted_file_references")
      .select(
        "id, room_id, user_id, storage_bucket, storage_object_path, content_type, size_bytes, original_filename, sha256_checksum, created_at"
      )
      .eq("id", payload.id)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!row) {
      return NextResponse.json({ error: "File reference not found" }, { status: 404 })
    }

    if (
      row.room_id !== payload.roomId ||
      row.storage_bucket !== payload.bucket ||
      row.storage_object_path !== payload.objectKey
    ) {
      console.warn("[encrypted-files] resolve: token payload mismatched stored row", { id: payload.id })
      return NextResponse.json({ error: "Invalid reference token" }, { status: 400 })
    }

    const membership = await getActiveRoomMembership(supabase, row.room_id, user.id)
    if (!membership) {
      return NextResponse.json({ error: "Forbidden. Active room membership required." }, { status: 403 })
    }

    const ttl = Number.parseInt(process.env.FILE_REFERENCE_SIGNED_URL_TTL_SEC || String(DEFAULT_TTL_SEC), 10)
    const ttlSec = Number.isFinite(ttl) && ttl > 0 && ttl <= 3600 ? ttl : DEFAULT_TTL_SEC

    const signed = await supabase.storage.from(row.storage_bucket).createSignedUrl(row.storage_object_path, ttlSec)

    if (signed.error) {
      console.error("[encrypted-files] resolve: signed URL error:", signed.error)
      return NextResponse.json(
        {
          file_reference: {
            id: row.id,
            room_id: row.room_id,
            content_type: row.content_type,
            size_bytes: row.size_bytes,
            original_filename: row.original_filename,
            sha256_checksum: row.sha256_checksum,
            created_at: row.created_at,
          },
          signed_url: null,
          signed_url_error: "Storage signing failed; check bucket policies and path.",
        },
        { status: 200 }
      )
    }

    return NextResponse.json({
      file_reference: {
        id: row.id,
        room_id: row.room_id,
        content_type: row.content_type,
        size_bytes: row.size_bytes,
        original_filename: row.original_filename,
        sha256_checksum: row.sha256_checksum,
        created_at: row.created_at,
      },
      signed_url: signed.data.signedUrl,
      expires_in: ttlSec,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: err.flatten() }, { status: 400 })
    }
    if (err instanceof Error && err.message.includes("FILE_REFERENCE_SECRET_KEY")) {
      console.error("[encrypted-files] resolve: encryption key misconfiguration")
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    }
    console.error("[encrypted-files] POST /api/files/resolve:", err)
    return NextResponse.json({ error: "Failed to resolve file reference" }, { status: 500 })
  }
}
