import { describe, it, expect } from "vitest";
import {
  getJoinRequestEligibility,
  isPendingJoinRequest,
  isValidJoinRequestStatus,
  JOIN_REQUEST_ELIGIBILITY_MESSAGES,
  mapJoinRequestRow,
  parseJoinRequestStatusFilter,
  validateJoinRequestMessage,
  type GroupJoinRequestRow,
} from "@/lib/groups/join-requests";

function makeRow(
  overrides: Partial<GroupJoinRequestRow> = {},
): GroupJoinRequestRow {
  return {
    id: "req-1",
    group_id: "room_1",
    user_id: "user-1",
    wallet_address: "G".repeat(56),
    status: "pending",
    message: "Please let me in",
    reviewed_by: null,
    reviewer_wallet: null,
    reviewed_at: null,
    created_at: "2026-10-12T15:00:00.000Z",
    updated_at: "2026-10-12T15:00:00.000Z",
    ...overrides,
  };
}

describe("group join request helpers", () => {
  describe("getJoinRequestEligibility", () => {
    it("allows a non-member to request access to a private group", () => {
      expect(
        getJoinRequestEligibility({
          isPrivate: true,
          isMember: false,
          hasPendingRequest: false,
        }),
      ).toBeNull();
    });

    it("rejects requests for public groups", () => {
      expect(
        getJoinRequestEligibility({
          isPrivate: false,
          isMember: false,
          hasPendingRequest: false,
        }),
      ).toBe("group_not_private");
    });

    it("rejects requests from existing members", () => {
      expect(
        getJoinRequestEligibility({
          isPrivate: true,
          isMember: true,
          hasPendingRequest: false,
        }),
      ).toBe("already_member");
    });

    it("rejects duplicate pending requests", () => {
      expect(
        getJoinRequestEligibility({
          isPrivate: true,
          isMember: false,
          hasPendingRequest: true,
        }),
      ).toBe("pending_request_exists");
    });

    it("exposes a user-facing message for every error code", () => {
      expect(JOIN_REQUEST_ELIGIBILITY_MESSAGES.group_not_private).toMatch(
        /private groups/i,
      );
      expect(JOIN_REQUEST_ELIGIBILITY_MESSAGES.already_member).toMatch(
        /already a member/i,
      );
      expect(JOIN_REQUEST_ELIGIBILITY_MESSAGES.pending_request_exists).toMatch(
        /pending join request/i,
      );
    });
  });

  describe("status handling", () => {
    it("validates known statuses", () => {
      expect(isValidJoinRequestStatus("pending")).toBe(true);
      expect(isValidJoinRequestStatus("approved")).toBe(true);
      expect(isValidJoinRequestStatus("rejected")).toBe(true);
      expect(isValidJoinRequestStatus("cancelled")).toBe(true);
      expect(isValidJoinRequestStatus("expired")).toBe(false);
      expect(isValidJoinRequestStatus(1)).toBe(false);
    });

    it("defaults the list filter to pending", () => {
      expect(parseJoinRequestStatusFilter(null)).toBe("pending");
      expect(parseJoinRequestStatusFilter("")).toBe("pending");
      expect(parseJoinRequestStatusFilter("bogus")).toBe("pending");
      expect(parseJoinRequestStatusFilter("all")).toBe("all");
      expect(parseJoinRequestStatusFilter("approved")).toBe("approved");
    });

    it("detects pending requests", () => {
      expect(isPendingJoinRequest("pending")).toBe(true);
      expect(isPendingJoinRequest("approved")).toBe(false);
    });
  });

  describe("validateJoinRequestMessage", () => {
    it("allows an omitted message", () => {
      expect(validateJoinRequestMessage(undefined)).toBeNull();
      expect(validateJoinRequestMessage(null)).toBeNull();
      expect(validateJoinRequestMessage("")).toBeNull();
    });

    it("accepts a short string and trims nothing implicitly", () => {
      expect(validateJoinRequestMessage("hello")).toBeNull();
    });

    it("rejects non-string values", () => {
      expect(validateJoinRequestMessage(42)).toMatch(/string/);
    });

    it("enforces the maximum length", () => {
      expect(validateJoinRequestMessage("a".repeat(501))).toMatch(/500/);
      expect(validateJoinRequestMessage("a".repeat(500))).toBeNull();
    });
  });

  describe("mapJoinRequestRow", () => {
    it("maps database columns to the API shape", () => {
      const mapped = mapJoinRequestRow(makeRow());

      expect(mapped).toEqual({
        id: "req-1",
        group_id: "room_1",
        requester_user_id: "user-1",
        wallet_address: "G".repeat(56),
        status: "pending",
        message: "Please let me in",
        reviewed_by: null,
        reviewer_wallet: null,
        reviewed_at: null,
        created_at: "2026-10-12T15:00:00.000Z",
        updated_at: "2026-10-12T15:00:00.000Z",
      });
      expect(mapped).not.toHaveProperty("user_id");
    });

    it("preserves reviewer metadata after review", () => {
      const mapped = mapJoinRequestRow(
        makeRow({
          status: "approved",
          reviewed_by: "mod-1",
          reviewer_wallet: "G".repeat(56),
          reviewed_at: "2026-10-12T16:00:00.000Z",
        }),
      );

      expect(mapped.status).toBe("approved");
      expect(mapped.reviewed_by).toBe("mod-1");
      expect(mapped.reviewed_at).toBe("2026-10-12T16:00:00.000Z");
    });
  });
});
