import { createClient } from "@/lib/supabase/server"
import {
  registerFileReferenceBodySchema,
  validateRegisterMetadata,
} from "@/lib/encrypted-files/metadata"
import { getActiveRoomMembership } from "@/lib/encrypted-files/room-access"
import { sealReferencePayload } from "@/lib/encrypted-files/reference-token"
import { type NextRequest, NextResponse } from "next/server"
import { ZodError } from "zod"

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
    const body = registerFileReferenceBodySchema.parse(json)
    validateRegisterMetadata(body)

    const membership = await getActiveRoomMembership(supabase, body.room_id, user.id)
    if (!membership) {
      return NextResponse.json({ error: "Forbidden. Active room membership required." }, { status: 403 })
    }

    const insertRow = {
      room_id: body.room_id,
      user_id: user.id,
      storage_bucket: body.storage_bucket,
      storage_object_path: body.storage_object_path,
      content_type: body.content_type ?? null,
      size_bytes: body.size_bytes ?? null,
      original_filename: body.original_filename ?? null,
      sha256_checksum: body.sha256_checksum ?? null,
    }

    const { data, error } = await supabase
      .from("encrypted_file_references")
      .insert(insertRow)
      .select("id, room_id, content_type, size_bytes, original_filename, sha256_checksum, created_at")
      .maybeSingle()

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "This file reference is already registered for this room." },
          { status: 409 }
        )
      }
      throw error
    }

    if (!data) {
      return NextResponse.json({ error: "Failed to create file reference" }, { status: 500 })
    }

    const reference_token = await sealReferencePayload({
      v: 1,
      id: data.id,
      roomId: data.room_id,
      bucket: body.storage_bucket,
      objectKey: body.storage_object_path,
    })

    return NextResponse.json(
      {
        file_reference: data,
        reference_token,
      },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid request", details: err.flatten() }, { status: 400 })
    }
    if (err instanceof Error && err.message.includes("FILE_REFERENCE_SECRET_KEY")) {
      console.error("[encrypted-files] register: encryption key misconfiguration")
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    }
    if (err instanceof Error && err.message.startsWith("Invalid")) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error("[encrypted-files] POST /api/files/register:", err)
    return NextResponse.json({ error: "Failed to register file reference" }, { status: 500 })
  }
}
