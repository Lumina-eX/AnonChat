import { describe, expect, it, vi } from "vitest"
import { buildExpiresAt, validateInviteCode } from "./invite"

function createSupabaseStub(invite: Record<string, unknown> | null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: invite, error: null }),
        }),
      }),
    }),
    rpc: vi.fn(),
  }
}

describe("invite expiration helpers", () => {
  it("builds an expiry timestamp for a valid TTL", () => {
    const expiresAt = buildExpiresAt(60)

    expect(expiresAt).toBeTruthy()
    expect(new Date(expiresAt!).getTime()).toBeGreaterThan(Date.now())
  })

  it("returns null for invalid expiration values", () => {
    expect(buildExpiresAt(0)).toBeNull()
    expect(buildExpiresAt(-10)).toBeNull()
    expect(buildExpiresAt(undefined)).toBeNull()
  })

  it("rejects invite codes that were explicitly deactivated", async () => {
    const supabase = createSupabaseStub({
      code: "abc123",
      room_id: "room-1",
      expires_at: null,
      max_uses: null,
      use_count: 0,
      is_active: false,
    }) as any

    const result = await validateInviteCode(supabase, "abc123")

    expect(result).toEqual({
      valid: false,
      status: 410,
      error: "Invite code is no longer active",
    })
  })

  it("rejects invite codes that have reached their usage limit", async () => {
    const supabase = createSupabaseStub({
      code: "abc123",
      room_id: "room-1",
      expires_at: null,
      max_uses: 2,
      use_count: 2,
      is_active: true,
    }) as any

    const result = await validateInviteCode(supabase, "abc123")

    expect(result).toEqual({
      valid: false,
      status: 410,
      error: "Invite code has reached its usage limit",
    })
  })
})
