import { z } from "zod"

/** Default ceiling for signed-URL flow; keeps API metadata honest without streaming bytes through Next. */
export const DEFAULT_MAX_FILE_BYTES = 500 * 1024 * 1024

const SAFE_BUCKET = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$|^[a-z0-9]{1,63}$/i
const SHA256_HEX = /^[0-9a-f]{64}$/i

export function assertSafeObjectPath(path: string): void {
  if (path.length === 0 || path.length > 1024) {
    throw new Error("Invalid storage path length")
  }
  if (path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throw new Error("Invalid storage path")
  }
}

export const registerFileReferenceBodySchema = z.object({
  room_id: z.string().min(1).max(256),
  storage_bucket: z.string().min(1).max(63).regex(SAFE_BUCKET, "Invalid bucket name"),
  storage_object_path: z.string().min(1).max(1024),
  content_type: z.string().min(1).max(256).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  original_filename: z.string().min(1).max(255).optional(),
  sha256_checksum: z.string().regex(SHA256_HEX, "sha256 must be 64 hex chars").optional(),
})

export type RegisterFileReferenceBody = z.infer<typeof registerFileReferenceBodySchema>

export function validateRegisterMetadata(
  body: RegisterFileReferenceBody,
  maxBytes: number = DEFAULT_MAX_FILE_BYTES
): void {
  assertSafeObjectPath(body.storage_object_path)
  if (body.size_bytes !== undefined && body.size_bytes > maxBytes) {
    throw new Error(`size_bytes exceeds limit (${maxBytes})`)
  }
  if (body.content_type && !/^[\w.\-+]+$/.test(body.content_type)) {
    throw new Error("Invalid content_type")
  }
}
