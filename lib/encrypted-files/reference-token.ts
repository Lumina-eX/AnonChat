/**
 * Opaque reference tokens: AES-256-GCM sealed payloads so clients never see raw bucket paths.
 * Requires FILE_REFERENCE_SECRET_KEY (32 bytes as hex or standard base64).
 */

export type ReferenceTokenPayloadV1 = {
  v: 1
  id: string
  roomId: string
  bucket: string
  objectKey: string
}

const AES_KEY_LENGTH = 32
const IV_LENGTH = 12

function requireKeyBytes(): Uint8Array {
  const raw = process.env.FILE_REFERENCE_SECRET_KEY?.trim()
  if (!raw) {
    throw new Error("FILE_REFERENCE_SECRET_KEY is not set")
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Uint8Array.from(Buffer.from(raw, "hex"))
  }
  const buf = Buffer.from(raw, "base64")
  if (buf.length !== AES_KEY_LENGTH) {
    throw new Error("FILE_REFERENCE_SECRET_KEY must decode to 32 bytes (AES-256)")
  }
  return new Uint8Array(buf)
}

let cachedKey: CryptoKey | null = null

async function getAesKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  const keyBytes = requireKeyBytes()
  cachedKey = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
  return cachedKey
}

export async function sealReferencePayload(payload: ReferenceTokenPayloadV1): Promise<string> {
  const key = await getAesKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const plain = new TextEncoder().encode(JSON.stringify(payload))
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plain as BufferSource
  )
  const cipher = new Uint8Array(cipherBuf)
  const out = new Uint8Array(iv.length + cipher.length)
  out.set(iv, 0)
  out.set(cipher, iv.length)
  return Buffer.from(out).toString("base64url")
}

export async function unsealReferenceToken(token: string): Promise<ReferenceTokenPayloadV1> {
  let combined: Buffer
  try {
    combined = Buffer.from(token, "base64url")
  } catch {
    throw new Error("Invalid reference token encoding")
  }
  if (combined.length < IV_LENGTH + 16) {
    throw new Error("Invalid reference token length")
  }
  const iv = combined.subarray(0, IV_LENGTH)
  const ciphertext = combined.subarray(IV_LENGTH)
  const key = await getAesKey()
  let plainBuf: ArrayBuffer
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ciphertext as BufferSource
    )
  } catch {
    throw new Error("Invalid or tampered reference token")
  }
  const parsed = JSON.parse(new TextDecoder().decode(plainBuf)) as ReferenceTokenPayloadV1
  if (parsed?.v !== 1 || typeof parsed.id !== "string") {
    throw new Error("Unsupported reference token payload")
  }
  return parsed
}
