import { describe, it, expect, vi } from "vitest"
import { NextResponse } from "next/server"

// Mock resolveRoomOwnerWallet to return the room's owner_wallet field
vi.mock("../lib/auth/wallet-owner", () => ({
  resolveRoomOwnerWallet: async (supabase: any, room: any) => room.owner_wallet ?? null,
}))

import { requireGroupOwner } from "../lib/middleware/group-ownership"

describe("requireGroupOwner middleware", () => {
  it("authorizes when caller wallet matches owner_wallet", async () => {
    const mockSupabase: any = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { id: "room-1", owner_wallet: "GOWNER123", created_by: "user-1" }, error: null }) }),
        }),
      }),
    }

    const res = await requireGroupOwner({
      supabase: mockSupabase,
      groupId: "room-1",
      callerWallet: "GOWNER123",
    })

    expect(res).toHaveProperty("authorized", true)
    expect(res.ownerUserId).toBe("user-1")
  })

  it("returns 403 NextResponse when caller wallet does not match", async () => {
    const mockSupabase: any = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { id: "room-1", owner_wallet: "GOWNER123", created_by: "user-1" }, error: null }) }),
        }),
      }),
    }

    const res = await requireGroupOwner({
      supabase: mockSupabase,
      groupId: "room-1",
      callerWallet: "GOTHER456",
    })

    expect(res instanceof NextResponse).toBe(true)
    // @ts-ignore - NextResponse exposes status in runtime
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json).toEqual({ error: "Unauthorized", message: "You are not the owner of this group." })
  })
})
