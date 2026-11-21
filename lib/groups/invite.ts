import { randomUUID } from "crypto"
import { SupabaseClient } from "@supabase/supabase-js"

export type InviteValidationResult =
  | { valid: true; roomId: string; inviteCode: string }
  | { valid: false; status: 400 | 404 | 410 | 429 | 500; error: string }

type InviteRecord = {
  code: string
  room_id: string
  expires_at?: string | null
  max_uses?: number | null
  use_count?: number | null
  is_active?: boolean | null
}

export function generateInviteCode(): string {
  return randomUUID()
}

export function buildExpiresAt(expiresIn?: number): string | null {
  if (!expiresIn || expiresIn <= 0) return null
  return new Date(Date.now() + expiresIn * 1000).toISOString()
}

async function deactivateInvite(
  supabase: SupabaseClient,
  code: string,
  reason: string
): Promise<void> {
  const { error } = await supabase
    .from("invites")
    .update({
      is_active: false,
      deactivated_at: new Date().toISOString(),
      deactivation_reason: reason,
    })
    .eq("code", code)

  if (error) {
    console.warn(`[invite] Failed to deactivate invite ${code}:`, error)
    return
  }

  console.info(`[invite] Invite ${code} was deactivated because ${reason}`)
}

/**
 * Validates an invite code and returns the associated room ID on success.
 * Checks: existence, active state, time-based expiry, and usage-based expiry.
 */
export async function validateInviteCode(
  supabase: SupabaseClient,
  code: string
): Promise<InviteValidationResult> {
  if (!code || typeof code !== "string" || code.trim() === "") {
    return { valid: false, status: 400, error: "Invite code is required" }
  }

  const normalizedCode = code.trim()
  const { data: invite, error } = await supabase
    .from("invites")
    .select("code, room_id, expires_at, max_uses, use_count, is_active")
    .eq("code", normalizedCode)
    .maybeSingle()

  if (error) {
    console.error("[invite] DB error validating invite code:", error)
    return { valid: false, status: 500, error: "Failed to validate invite code" }
  }

  if (!invite) {
    return { valid: false, status: 404, error: "Invalid invite code" }
  }

  const inviteRecord = invite as InviteRecord

  if (inviteRecord.is_active === false) {
    return { valid: false, status: 410, error: "Invite code is no longer active" }
  }

  if (inviteRecord.expires_at && new Date(inviteRecord.expires_at) < new Date()) {
    await deactivateInvite(supabase, inviteRecord.code, "expired")
    return { valid: false, status: 410, error: "Invite code has expired" }
  }

  if (
    inviteRecord.max_uses !== null &&
    inviteRecord.max_uses !== undefined &&
    (inviteRecord.use_count ?? 0) >= inviteRecord.max_uses
  ) {
    await deactivateInvite(supabase, inviteRecord.code, "usage limit reached")
    return { valid: false, status: 410, error: "Invite code has reached its usage limit" }
  }

  return { valid: true, roomId: inviteRecord.room_id, inviteCode: inviteRecord.code }
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
