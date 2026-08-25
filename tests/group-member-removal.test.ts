import { describe, it, expect, vi } from "vitest"
import { NextResponse } from "next/server"

vi.mock("../lib/auth/wallet-owner", () => ({
  resolveRoomOwnerWallet: async (_supabase: any, room: any) => room.owner_wallet ?? null,
}))

vi.mock("../lib/groups/multisig", () => ({
  isMultisigOwner: async () => false,
}))

vi.mock("../lib/blockchain/audit", () => ({
  recordGroupAuditEvent: async () => ({
    eventId: "audit-1",
    eventType: "member_removed",
    transactionHash: null,
    status: "pending",
    explorerUrl: null,
    error: null,
  }),
}))

vi.mock("../lib/notifications/service", () => ({
  notifyMemberRemoved: async () => ({
    notification: { id: "n-1", type: "group_removed" },
    delivered: true,
    deliveryError: null,
  }),
}))

import { removeGroupMember } from "../lib/groups/member-removal"

function createMembershipMock({
  callerRole,
  targetRole,
  targetWallet = "GUSER1",
  callerWallet = "GMOD12345",
  ownerWallet = "GOWNER123",
}: {
  callerRole: "owner" | "moderator" | "member"
  targetRole: "owner" | "moderator" | "member"
  targetWallet?: string
  callerWallet?: string
  ownerWallet?: string
}) {
  const roleByWallet: Record<string, { role: string }> = {
    [callerWallet]: { role: callerRole },
    [targetWallet]: { role: targetRole },
    [ownerWallet]: { role: "owner" },
  }

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "room-1", owner_wallet: ownerWallet, created_by: "owner-user" },
              error: null,
            }),
          }),
        }),
      }
    }

    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: targetRole === "owner" ? "owner-user" : "user-target" },
              error: null,
            }),
          }),
        }),
      }
    }

    if (table === "group_membership") {
      return {
        select: () => ({
          eq: (_column: string, value: string) => ({
            eq: (_column2: string, wallet: string) => ({
              maybeSingle: async () => ({
                data: roleByWallet[wallet] ?? null,
                error: null,
              }),
            }),
          }),
        }),
        delete: () => ({
          eq: () => ({
            eq: async () => ({ error: null }),
          }),
        }),
      }
    }

    if (table === "room_members") {
      return {
        update: (values: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => ({
              is: async () => ({ error: null }),
            }),
          }),
        }),
      }
    }

    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }
  })

  return { from }
}

describe("removeGroupMember", () => {
  it("allows moderators to remove a regular member", async () => {
    const supabase = createMembershipMock({
      callerRole: "moderator",
      targetRole: "member",
      callerWallet: "GMOD12345",
      targetWallet: "GUSER1",
    })

    const result = await removeGroupMember({
      supabase: supabase as any,
      groupId: "room-1",
      callerWallet: "GMOD12345",
      targetWallet: "GUSER1",
      actorUserId: "user-mod",
      groupName: "Alpha",
      adminAccess: true,
    })

    expect(result).toHaveProperty("success", true)
  })

  it("blocks moderators from removing the owner", async () => {
    const supabase = createMembershipMock({
      callerRole: "moderator",
      targetRole: "owner",
      callerWallet: "GMOD12345",
      targetWallet: "GOWNER123",
    })

    const result = await removeGroupMember({
      supabase: supabase as any,
      groupId: "room-1",
      callerWallet: "GMOD12345",
      targetWallet: "GOWNER123",
      actorUserId: "user-mod",
      groupName: "Alpha",
      adminAccess: true,
    })

    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
  })

  it("blocks regular members from removing others", async () => {
    const supabase = createMembershipMock({
      callerRole: "member",
      targetRole: "member",
      callerWallet: "GUSER1",
      targetWallet: "GOTHER1",
    })

    const result = await removeGroupMember({
      supabase: supabase as any,
      groupId: "room-1",
      callerWallet: "GUSER1",
      targetWallet: "GOTHER1",
      actorUserId: "user-member",
      groupName: "Alpha",
      adminAccess: false,
    })

    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
  })

  it("revokes room access when removing a member", async () => {
    let roomMembershipUpdateValue: unknown = null

    const base = createMembershipMock({
      callerRole: "moderator",
      targetRole: "member",
      callerWallet: "GMOD12345",
      targetWallet: "GUSER1",
    })

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        const mock = (base.from as any)(table)

        if (table === "room_members") {
          return {
            update: (values: Record<string, unknown>) => {
              roomMembershipUpdateValue = values.removed_at
              return {
                eq: () => ({
                  eq: () => ({
                    is: async () => ({ error: null }),
                  }),
                }),
              }
            },
          }
        }

        return mock
      }),
    }

    const result = await removeGroupMember({
      supabase: supabase as any,
      groupId: "room-1",
      callerWallet: "GMOD12345",
      targetWallet: "GUSER1",
      actorUserId: "user-mod",
      groupName: "Alpha",
      adminAccess: true,
    })

    expect(result).toHaveProperty("success", true)
    expect(roomMembershipUpdateValue).toBeTruthy()
  })
})
