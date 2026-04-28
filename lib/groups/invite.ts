import { randomUUID } from "crypto"
import { SupabaseClient } from "@supabase/supabase-js"

export type InviteValidationResult =
  | { valid: true; roomId: string; inviteCode: string }
  | { valid: false; status: 400 | 404 | 410 | 429 | 500; error: string }

export function generateInviteCode(): string {
  return randomUUID()
}

export function buildExpiresAt(expiresIn?: number): string | null {
  if (!expiresIn || expiresIn <= 0) return null
  return new Date(Date.now() + expiresIn * 1000).toISOString()
}

/**
 * Validates an invite code and returns the associated room ID on success.
 * Checks: existence, time-based expiry, and usage-based expiry.
 */
export async function validateInviteCode(
  supabase: SupabaseClient,
  code: string
): Promise<InviteValidationResult> {
  if (!code || typeof code !== "string" || code.trim() === "") {
    return { valid: false, status: 400, error: "Invite code is required" }
  }

  const { data: invite, error } = await supabase
    .from("invites")
    .select("code, room_id, expires_at, max_uses, use_count")
    .eq("code", code.trim())
    .maybeSingle()

  if (error) {
    console.error("[invite] DB error validating invite code:", error)
    return { valid: false, status: 500, error: "Failed to validate invite code" }
  }

  if (!invite) {
    return { valid: false, status: 404, error: "Invalid invite code" }
  }

  // Time-based expiration check
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return { valid: false, status: 410, error: "Invite code has expired" }
  }

  // Usage-based expiration check
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
    return { valid: false, status: 410, error: "Invite code has reached its usage limit" }
  }

  return { valid: true, roomId: invite.room_id, inviteCode: invite.code }
}

/**
 * Atomically increments the use_count for a given invite code.
 * Should be called after a successful group join.
 */
export async function incrementInviteUseCount(
  supabase: SupabaseClient,
  code: string
): Promise<void> {
  const { error } = await supabase.rpc("increment_invite_use_count", { invite_code: code })

  if (error) {
    // Non-fatal: log but don't block the join response
    console.error("[invite] Failed to increment use_count for code:", code, error)
  }
}
