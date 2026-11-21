import { describe, it, expect, vi } from "vitest"
import { NextResponse } from "next/server"

// Mock resolveRoomOwnerWallet to return the room's owner_wallet field
vi.mock("../lib/auth/wallet-owner", () => ({
  resolveRoomOwnerWallet: async (_supabase: any, room: any) => room.owner_wallet ?? null,
}))

// Mock isMultisigOwner to always return false unless explicitly set
vi.mock("../lib/groups/multisig", () => ({
  isMultisigOwner: async () => false,
}))

import { requireGroupRole } from "../lib/middleware/group-roles"
import type { GroupRole } from "../lib/middleware/group-roles"

// ── Helper to build a mock supabase client ─────────────────────────────────────

function makeMockSupabase(options: {
  roomData?: any
  roomError?: any
  membershipData?: any
  membershipError?: any
  profileData?: any
}) {
  const {
    roomData = { id: "room-1", owner_wallet: "GOWNER123", created_by: "user-1" },
    roomError = null,
    membershipData = null,
    membershipError = null,
    profileData = null,
  } = options

  return {
    from: vi.fn((table: string) => {
      if (table === "rooms") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: roomData, error: roomError }),
            }),
          }),
        }
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: profileData, error: null }),
            }),
          }),
        }
      }
      if (table === "group_membership") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: membershipData, error: membershipError }),
              }),
            }),
          }),
        }
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }
    }),
  }
}

describe("requireGroupRole middleware", () => {
  // ── Owner tests ──────────────────────────────────────────────────────────────

  it("authorizes owner when caller wallet matches owner_wallet", async () => {
    const mockSupabase = makeMockSupabase({
      roomData: { id: "room-1", owner_wallet: "GOWNER123", created_by: "user-1" },
    })

    const res = await requireGroupRole({
      supabase: mockSupabase,
      groupId: "room-1",
      minimumRole: "owner",
      callerWallet: "GOWNER123",
    })

    expect(res).toHaveProperty("authorized", true)
    expect((res as any).role).toBe("owner")
  })

  it("authorizes owner for any minimum role", async () => {
    const mockSupabase = makeMockSupabase({
      roomData: { id: "room-1", owner_wallet: "GOWNER123", created_by: "user-1" },
    })

    const res = await requireGroupRole({
      supabase: mockSupabase,
      groupId: "room-1",
      minimumRole: "member",
      callerWallet: "GOWNER123",
    })

    expect(res).toHaveProperty("authorized", true)
  })

  // ── Moderator tests ──────────────────────────────────────────────────────────

  it("authorizes moderator for moderator-level access", async () => {
    const mockSupabase = makeMockSupabase({
      roomData: { id: "room-1", owner_wallet: "GOWNER123", created_by: "user-1" },
      membershipData: { role: "moderator" },
    })

    const res = await requireGroupRole({
      supabase: mockSupabase,
      groupId: "room-1",
      minimumRole: "moderator",
      callerWallet: "GMOD12345",
    })

    expect(res).toHaveProperty("authorized", true)
    expect((res as any).role).toBe("moderator")
  })

  it("denies moderator for owner-level access", async () => {
    const mockSupabase = makeMockSupabase({
      roomData: { id: "room-1", owner_wallet: "GOWNER123", created_by: "user-1" },
      membershipData: { role: "moderator" },
    })

    const res = await requireGroupRole({
      supabase: mockSupabase,
      groupId: "room-1",
      minimumRole: "owner",
      callerWallet: "GMOD12345",
    })

    expect(res instanceof NextResponse).toBe(true)
    expect((res as NextResponse).status).toBe(403)
  })

  it("allows moderator to pass member-level check", async () => {
    const mockSupabase = makeMockSupabase({
      roomData: { id: "room-1", owner_wallet: "GOWNER123", created_by: "user-1" },
      membershipData: { role: "moderator" },
    })

    const res = await requireGroupRole({
      supabase: mockSupabase,
      groupId: "room-1",
      minimumRole: "member",
      callerWallet: "GMOD12345",
    })

    expect(res).toHaveProperty("authorized", true)
    expect((res as any).role).toBe("moderator")
  })

  // ── Member tests ─────────────────────────────────────────────────────────────

  it("authorizes member for member-level access", async () => {
    const mockSupabase = makeMockSupabase({
      roomData: { id: "room-1", owner_wallet: "GOWNER123", created_by: "user-1" },
      membershipData: { role: "member" },
    })

    const res = await requireGroupRole({
      supabase: mockSupabase,
      groupId: "room-1",
      minimumRole: "member",
      callerWallet: "GMEMBER99",
    })

    expect(res).toHaveProperty("authorized", true)
    expect((res as any).role).toBe("member")
  })

  it("denies member for moderator-level access", async () => {
    const mockSupabase = makeMockSupabase({
      roomData: { id: "room-1", owner_wallet: "GOWNER123", created_by: "user-1" },
      membershipData: { role: "member" },
    })

    const res = await requireGroupRole({
      supabase: mockSupabase,
      groupId: "room-1",
      minimumRole: "moderator",
      callerWallet: "GMEMBER99",
    })

    expect(res instanceof NextResponse).toBe(true)
    expect((res as NextResponse).status).toBe(403)
  })

  // ── Unauthorized / edge cases ────────────────────────────────────────────────

  it("returns 403 when caller is not a member", async () => {
    const mockSupabase = makeMockSupabase({
      roomData: { id: "room-1", owner_wallet: "GOWNER123", created_by: "user-1" },
      membershipData: null, // not a member
    })

    const res = await requireGroupRole({
      supabase: mockSupabase,
      groupId: "room-1",
      minimumRole: "member",
      callerWallet: "GSTRANGER",
    })

    expect(res instanceof NextResponse).toBe(true)
    expect((res as NextResponse).status).toBe(403)
    const json = await (res as NextResponse).json()
    expect(json.error).toBe("Unauthorized")
  })

  it("returns 404 when group is not found", async () => {
    const mockSupabase = makeMockSupabase({
      roomData: null,
    })

    const res = await requireGroupRole({
      supabase: mockSupabase,
      groupId: "nonexistent",
      minimumRole: "member",
      callerWallet: "GOWNER123",
    })

    expect(res instanceof NextResponse).toBe(true)
    expect((res as NextResponse).status).toBe(404)
  })

  it("returns 403 when caller identity cannot be resolved", async () => {
    const mockSupabase = makeMockSupabase({
      roomData: { id: "room-1", owner_wallet: "GOWNER123", created_by: "user-1" },
    })

    const res = await requireGroupRole({
      supabase: mockSupabase,
      groupId: "room-1",
      minimumRole: "member",
      // no callerWallet and no userId
    })

    expect(res instanceof NextResponse).toBe(true)
    expect((res as NextResponse).status).toBe(403)
  })

  // ── User ID resolution tests ─────────────────────────────────────────────────

  it("resolves role via userId -> profile -> group_membership", async () => {
    const mockSupabase = makeMockSupabase({
      roomData: { id: "room-1", owner_wallet: "GOWNER123", created_by: "user-1" },
      membershipData: { role: "moderator" },
      profileData: { wallet_address: "GMOD12345" },
    })

    const res = await requireGroupRole({
      supabase: mockSupabase,
      groupId: "room-1",
      minimumRole: "moderator",
      userId: "user-2",
    })

    expect(res).toHaveProperty("authorized", true)
    expect((res as any).role).toBe("moderator")
  })
})
