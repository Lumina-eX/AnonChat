import { z } from "zod"

/** Default ceiling for signed-URI flow; keeps API metadata honest without streaming bytes through Next. */
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

const MIME_TYPE = /^[a-z0-9][a-z0-9!#$%^&_.+-]{0,126}\/[a-z0-9][a-z0-9!#$%^&_.+-]{0,126}$/i

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/json",
  "application/octet-stream",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "audio/mpeg",
  "audio/ogg",
  "video/mp4",
  "video/webm",
])

const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f\u007f\u005c\/]/g

export function sanitizeFilename(filename: string): string {
  const cleaned = filename.replace(UNSAFE_FILENAME_CHARS, "").trim()
  if (cleaned.length === 0 || cleaned.length > 255) {
    throw new Error("Invalid filename")
  }
  if (cleaned === "." || cleaned === "..") {
    throw new Error("Invalid filename")
  }
  return cleaned
}

export function assertSupportedMimeType(mimeType: string): void {
  if (!MIME_TYPE.test(mimeType)) {
    throw new Error("Invalid MIME type")
  }
  if (!SUPPORTED_MIME_TYPES.has(mimeType.toLowerCase())) {
    throw new Error(`Unsupported MIME type (${mimeType})`)
  }
}

export const attachmentMetadataSchema = z.object({
  id: z.string().uuid(),
  message_id: z.string().min(1).max(256),
  group_id: z.string().min(1).max(256),
  uploader_id: z.string().min(1).max(256),
  original_filename: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(256),
  size_bytes: z.number().int().nonnegative(),
  uploaded_at: z.string().datetime(),
})

export type AttachmentMetadata = z.infer<typeof attachmentMetadataSchema>

export const createAttachmentMetadataBodySchema = z.object({
  message_id: z.string().min(1).max(256),
  group_id: z.string().min(1).max(256),
  original_filename: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(256),
  size_bytes: z.number().int().nonnegative(),
})

export type CreateAttachmentMetadataBody = z.infer<typeof createAttachmentMetadataBodySchema>

export function validateAttachmentMetadata(
  body: CreateAttachmentMetadataBody,
  maxBytes: number = DEFAULT_MAX_FILE_BYTES
): CreateAttachmentMetadataBody {
  const parsed = createAttachmentMetadataBodySchema.parse(body)
  const original_filename = sanitizeFilename(parsed.original_filename)
  assertSupportedMimeType(parsed.mime_type)
  if (parsed.size_bytes > maxBytes) {
    throw new Error(`size_bytes exceeds limit (${maxBytes})`)
  }
  return { ...parsed, original_filename }
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
  if (body.original_filename !== undefined) {
    sanitizeFilename(body.original_filename)
  }
}
