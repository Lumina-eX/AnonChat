import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

vi.mock("@/lib/auth/wallet-authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/wallet-authorization")>();
  return { ...actual, verifyWalletAuthorization: vi.fn() };
});

vi.mock("@/lib/blockchain/audit", () => ({
  recordGroupAuditEvent: vi.fn(async () => null),
}));

vi.mock("@/lib/notifications/service", () => ({
  notifyJoinRequestReceived: vi.fn(async () => ({
    notification: null,
    delivered: true,
    deliveryError: null,
  })),
  notifyJoinRequestReviewed: vi.fn(async () => ({
    notification: null,
    delivered: true,
    deliveryError: null,
  })),
}));

import { createClient } from "@/lib/supabase/server";
import { verifyWalletAuthorization } from "@/lib/auth/wallet-authorization";
import { recordGroupAuditEvent } from "@/lib/blockchain/audit";
import {
  notifyJoinRequestReceived,
  notifyJoinRequestReviewed,
} from "@/lib/notifications/service";
import { POST as createJoinRequest } from "@/app/api/groups/[id]/join-requests/route";
import { POST as approveJoinRequest } from "@/app/api/join-requests/[requestId]/approve/route";
import { POST as rejectJoinRequest } from "@/app/api/join-requests/[requestId]/reject/route";

const createClientMock = vi.mocked(createClient);
const verifyMock = vi.mocked(verifyWalletAuthorization);
const auditMock = vi.mocked(recordGroupAuditEvent);
const notifyReceivedMock = vi.mocked(notifyJoinRequestReceived);
const notifyReviewedMock = vi.mocked(notifyJoinRequestReviewed);

const OWNER_ID = "owner-1";
const REQUESTER_ID = "requester-1";
const MODERATOR_ID = "moderator-1";
const OWNER_WALLET = "G".repeat(56);
const REQUESTER_WALLET = "A".repeat(56);

const requestRow = {
  id: "req-1",
  group_id: "room_1",
  user_id: REQUESTER_ID,
  wallet_address: REQUESTER_WALLET,
  status: "pending",
  message: "Please let me in",
  reviewed_by: null,
  reviewer_wallet: null,
  reviewed_at: null,
  created_at: "2026-11-20T10:00:00.000Z",
  updated_at: "2026-11-20T10:00:00.000Z",
};

function makeQuery(result: { data: unknown; error?: unknown }) {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    maybeSingle: async () => ({ data: result.data, error: result.error ?? null }),
  };
  return query;
}

function makeSupabase(params: {
  user?: { id: string } | null;
  tables?: Record<string, { data: unknown; error?: unknown }>;
  rpcResult?: { data: unknown; error?: unknown };
}) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: params.user ?? null },
        error: null,
      }),
    },
    from: vi.fn((table: string) =>
      makeQuery(params.tables?.[table] ?? { data: null }),
    ),
    rpc: vi.fn(() => ({
      maybeSingle: async () => ({
        data: params.rpcResult?.data ?? null,
        error: params.rpcResult?.error ?? null,
      }),
    })),
  };
}

function post(url: string, body: unknown = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const createParams = { params: Promise.resolve({ id: "room_1" }) };
const reviewParams = { params: Promise.resolve({ requestId: "req-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  verifyMock.mockResolvedValue({
    ok: true,
    walletAddress: OWNER_WALLET,
    nonce: "nonce-1",
  } as never);
});

describe("POST /api/groups/[id]/join-requests", () => {
  it("rejects unauthenticated requests without touching the database", async () => {
    const supabase = makeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase as never);

    const response = await createJoinRequest(
      post("/api/groups/room_1/join-requests", { message: "hi" }),
      createParams,
    );

    expect(response.status).toBe(401);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("creates a pending request and notifies the group owner", async () => {
    const supabase = makeSupabase({
      user: { id: REQUESTER_ID },
      rpcResult: {
        data: {
          ...requestRow,
          group_name: "Secret Club",
          group_owner_user_id: OWNER_ID,
        },
      },
    });
    createClientMock.mockResolvedValue(supabase as never);

    const response = await createJoinRequest(
      post("/api/groups/room_1/join-requests", { message: " Please let me in " }),
      createParams,
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.request).toMatchObject({
      id: "req-1",
      status: "pending",
      requester_user_id: REQUESTER_ID,
    });
    expect(body.request).not.toHaveProperty("user_id");

    expect(supabase.rpc).toHaveBeenCalledWith("create_group_join_request", {
      p_group_id: "room_1",
      p_message: " Please let me in ",
    });
    expect(notifyReceivedMock).toHaveBeenCalledWith(
      expect.anything(),
      OWNER_ID,
      "room_1",
      "Secret Club",
      REQUESTER_WALLET,
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "join_request_created" }),
    );
  });

  it("does not notify when the owner submits the request themself", async () => {
    const supabase = makeSupabase({
      user: { id: OWNER_ID },
      rpcResult: {
        data: {
          ...requestRow,
          user_id: OWNER_ID,
          group_name: "Secret Club",
          group_owner_user_id: OWNER_ID,
        },
      },
    });
    createClientMock.mockResolvedValue(supabase as never);

    const response = await createJoinRequest(
      post("/api/groups/room_1/join-requests"),
      createParams,
    );

    expect(response.status).toBe(201);
    expect(notifyReceivedMock).not.toHaveBeenCalled();
  });

  it("prevents duplicate pending requests", async () => {
    const supabase = makeSupabase({
      user: { id: REQUESTER_ID },
      rpcResult: {
        data: null,
        error: { code: "P0006", message: "duplicate" },
      },
    });
    createClientMock.mockResolvedValue(supabase as never);

    const response = await createJoinRequest(
      post("/api/groups/room_1/join-requests"),
      createParams,
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/pending join request/i);
  });

  it("rejects requests for public groups", async () => {
    const supabase = makeSupabase({
      user: { id: REQUESTER_ID },
      rpcResult: { data: null, error: { code: "P0004" } },
    });
    createClientMock.mockResolvedValue(supabase as never);

    const response = await createJoinRequest(
      post("/api/groups/room_1/join-requests"),
      createParams,
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/private groups/i);
  });

  it("rejects requests from existing members", async () => {
    const supabase = makeSupabase({
      user: { id: REQUESTER_ID },
      rpcResult: { data: null, error: { code: "P0005" } },
    });
    createClientMock.mockResolvedValue(supabase as never);

    const response = await createJoinRequest(
      post("/api/groups/room_1/join-requests"),
      createParams,
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/already a member/i);
  });

  it("validates the optional message before calling the RPC", async () => {
    const supabase = makeSupabase({ user: { id: REQUESTER_ID } });
    createClientMock.mockResolvedValue(supabase as never);

    const response = await createJoinRequest(
      post("/api/groups/room_1/join-requests", { message: "a".repeat(501) }),
      createParams,
    );

    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/join-requests/[requestId]/approve", () => {
  const approvalRpcRow = {
    request_id: "req-1",
    group_id: "room_1",
    requester_user_id: REQUESTER_ID,
    wallet_address: REQUESTER_WALLET,
    membership_id: "membership-1",
    group_name: "Secret Club",
    actor_role: "moderator",
  };

  it("approves a pending request and notifies the requester", async () => {
    const supabase = makeSupabase({
      user: { id: MODERATOR_ID },
      tables: {
        group_join_requests: { data: requestRow },
        profiles: { data: { id: MODERATOR_ID, wallet_address: OWNER_WALLET } },
      },
      rpcResult: { data: approvalRpcRow },
    });
    createClientMock.mockResolvedValue(supabase as never);

    const response = await approveJoinRequest(
      post("/api/join-requests/req-1/approve", {
        walletAddress: OWNER_WALLET,
        signature: "sig",
      }),
      reviewParams,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      status: "approved",
      membership_id: "membership-1",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("approve_group_join_request", {
      p_request_id: "req-1",
      p_actor_wallet: OWNER_WALLET,
    });
    expect(notifyReviewedMock).toHaveBeenCalledWith(
      expect.anything(),
      REQUESTER_ID,
      "room_1",
      "Secret Club",
      "approved",
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "join_request_approved",
        metadata: expect.objectContaining({ reviewer_role: "moderator" }),
      }),
    );
  });

  it("rejects already-reviewed requests before authorizing", async () => {
    const supabase = makeSupabase({
      user: { id: MODERATOR_ID },
      tables: {
        group_join_requests: { data: { ...requestRow, status: "rejected" } },
      },
    });
    createClientMock.mockResolvedValue(supabase as never);

    const response = await approveJoinRequest(
      post("/api/join-requests/req-1/approve", {
        walletAddress: OWNER_WALLET,
        signature: "sig",
      }),
      reviewParams,
    );

    expect(response.status).toBe(409);
    expect(verifyMock).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("forbids reviewers without an owner or moderator role", async () => {
    const supabase = makeSupabase({
      user: { id: "user-9" },
      tables: {
        group_join_requests: { data: requestRow },
        profiles: { data: { id: "user-9", wallet_address: OWNER_WALLET } },
      },
      rpcResult: { data: null, error: { code: "42501" } },
    });
    createClientMock.mockResolvedValue(supabase as never);

    const response = await approveJoinRequest(
      post("/api/join-requests/req-1/approve", {
        walletAddress: OWNER_WALLET,
        signature: "sig",
      }),
      reviewParams,
    );

    expect(response.status).toBe(403);
    expect(notifyReviewedMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "join_request_approved" }),
    );
  });

  it("returns a conflict when a concurrent approval already completed", async () => {
    const supabase = makeSupabase({
      user: { id: MODERATOR_ID },
      tables: {
        group_join_requests: { data: requestRow },
        profiles: { data: { id: MODERATOR_ID, wallet_address: OWNER_WALLET } },
      },
    });
    supabase.rpc
      .mockReturnValueOnce({
        maybeSingle: async () => ({ data: approvalRpcRow, error: null }),
      } as never)
      .mockReturnValueOnce({
        maybeSingle: async () => ({
          data: null,
          error: { code: "22023", message: "already reviewed" },
        }),
      } as never);
    createClientMock.mockResolvedValue(supabase as never);

    const first = await approveJoinRequest(
      post("/api/join-requests/req-1/approve", {
        walletAddress: OWNER_WALLET,
        signature: "sig",
      }),
      reviewParams,
    );
    const second = await approveJoinRequest(
      post("/api/join-requests/req-1/approve", {
        walletAddress: OWNER_WALLET,
        signature: "sig",
      }),
      reviewParams,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error).toMatch(/already been reviewed/i);
    expect(notifyReviewedMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/join-requests/[requestId]/reject", () => {
  const rejectedRpcRow = {
    ...requestRow,
    status: "rejected",
    reviewed_by: MODERATOR_ID,
    reviewer_wallet: OWNER_WALLET,
    reviewed_at: "2026-11-20T11:00:00.000Z",
    group_name: "Secret Club",
    actor_role: "owner",
  };

  it("rejects a pending request and notifies the requester", async () => {
    const supabase = makeSupabase({
      user: { id: OWNER_ID },
      tables: {
        group_join_requests: { data: requestRow },
        profiles: { data: { id: OWNER_ID, wallet_address: OWNER_WALLET } },
      },
      rpcResult: { data: rejectedRpcRow },
    });
    createClientMock.mockResolvedValue(supabase as never);

    const response = await rejectJoinRequest(
      post("/api/join-requests/req-1/reject", {
        walletAddress: OWNER_WALLET,
        signature: "sig",
        reason: "Not a fit",
      }),
      reviewParams,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.request.status).toBe("rejected");
    expect(supabase.rpc).toHaveBeenCalledWith("reject_group_join_request", {
      p_request_id: "req-1",
      p_actor_wallet: OWNER_WALLET,
    });
    expect(notifyReviewedMock).toHaveBeenCalledWith(
      expect.anything(),
      REQUESTER_ID,
      "room_1",
      "Secret Club",
      "rejected",
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "join_request_rejected",
        metadata: expect.objectContaining({ reason: "Not a fit" }),
      }),
    );
  });

  it("forbids unauthorized reviewers", async () => {
    const supabase = makeSupabase({
      user: { id: "user-9" },
      tables: {
        group_join_requests: { data: requestRow },
        profiles: { data: { id: "user-9", wallet_address: OWNER_WALLET } },
      },
      rpcResult: { data: null, error: { code: "42501" } },
    });
    createClientMock.mockResolvedValue(supabase as never);

    const response = await rejectJoinRequest(
      post("/api/join-requests/req-1/reject", {
        walletAddress: OWNER_WALLET,
        signature: "sig",
      }),
      reviewParams,
    );

    expect(response.status).toBe(403);
    expect(notifyReviewedMock).not.toHaveBeenCalled();
  });
});
