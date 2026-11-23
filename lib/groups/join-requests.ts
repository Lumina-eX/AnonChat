/**
 * Shared types and pure helpers for private group join requests.
 */

export type JoinRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export const JOIN_REQUEST_STATUSES: JoinRequestStatus[] = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
];

export interface GroupJoinRequestRow {
  id: string;
  group_id: string;
  user_id: string;
  wallet_address: string;
  status: JoinRequestStatus;
  message: string | null;
  reviewed_by: string | null;
  reviewer_wallet: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GroupJoinRequest {
  id: string;
  group_id: string;
  requester_user_id: string;
  wallet_address: string;
  status: JoinRequestStatus;
  message: string | null;
  reviewed_by: string | null;
  reviewer_wallet: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function isValidJoinRequestStatus(
  value: unknown,
): value is JoinRequestStatus {
  return (
    typeof value === "string" &&
    (JOIN_REQUEST_STATUSES as string[]).includes(value)
  );
}

export function isPendingJoinRequest(status: string): boolean {
  return status === "pending";
}

export interface CreateJoinRequestRpcRow extends GroupJoinRequestRow {
  group_name: string;
  group_owner_user_id: string | null;
}

export interface RejectJoinRequestRpcRow extends GroupJoinRequestRow {
  group_name: string;
  actor_role: string;
}

export type JoinRequestRpcError = {
  code?: string | null;
  message?: string | null;
};

export interface JoinRequestErrorResponse {
  status: number;
  error: string;
}

/**
 * Maps Postgres error codes raised by create_group_join_request to API
 * responses. Returns null for unexpected errors so callers can log them.
 */
export function mapCreateJoinRequestRpcError(
  error: JoinRequestRpcError,
): JoinRequestErrorResponse | null {
  switch (error.code) {
    case "42501":
      return { status: 401, error: "Unauthorized" };
    case "P0002":
      return { status: 404, error: "Group not found" };
    case "P0004":
      return {
        status: 409,
        error: JOIN_REQUEST_ELIGIBILITY_MESSAGES.group_not_private,
      };
    case "P0005":
      return {
        status: 409,
        error: JOIN_REQUEST_ELIGIBILITY_MESSAGES.already_member,
      };
    case "P0006":
    case "23505":
      return {
        status: 409,
        error: JOIN_REQUEST_ELIGIBILITY_MESSAGES.pending_request_exists,
      };
    case "P0007":
      return {
        status: 400,
        error: "Could not determine caller wallet address",
      };
    default:
      return null;
  }
}

/**
 * Maps Postgres error codes raised by the approve/reject functions to API
 * responses. Returns null for unexpected errors so callers can log them.
 */
export function mapReviewJoinRequestRpcError(
  error: JoinRequestRpcError,
): JoinRequestErrorResponse | null {
  switch (error.code) {
    case "42501":
      return {
        status: 403,
        error:
          "Forbidden. Only group owners and moderators can review join requests.",
      };
    case "P0002":
      return { status: 404, error: "Join request or group not found." };
    case "22023":
      return { status: 409, error: "Join request has already been reviewed." };
    default:
      return null;
  }
}

export type JoinRequestEligibilityError =
  | "group_not_private"
  | "already_member"
  | "pending_request_exists";

/**
 * Determines whether a user may create a join request for a group.
 * Returns null when eligible, otherwise a stable error code.
 */
export function getJoinRequestEligibility(params: {
  isPrivate: boolean;
  isMember: boolean;
  hasPendingRequest: boolean;
}): JoinRequestEligibilityError | null {
  if (!params.isPrivate) return "group_not_private";
  if (params.isMember) return "already_member";
  if (params.hasPendingRequest) return "pending_request_exists";
  return null;
}

export const JOIN_REQUEST_ELIGIBILITY_MESSAGES: Record<
  JoinRequestEligibilityError,
  string
> = {
  group_not_private: "Join requests are only available for private groups.",
  already_member: "You are already a member of this group.",
  pending_request_exists:
    "You already have a pending join request for this group.",
};

export const JOIN_REQUEST_STATUS_MESSAGES: Record<JoinRequestStatus, string> = {
  pending: "Your join request is pending review.",
  approved: "Your join request was approved.",
  rejected: "Your join request was rejected.",
  cancelled: "Your join request was cancelled.",
};

/**
 * Maps a database row into the API shape used by join-request endpoints.
 */
export function mapJoinRequestRow(
  row: GroupJoinRequestRow,
): GroupJoinRequest {
  return {
    id: row.id,
    group_id: row.group_id,
    requester_user_id: row.user_id,
    wallet_address: row.wallet_address,
    status: row.status,
    message: row.message,
    reviewed_by: row.reviewed_by,
    reviewer_wallet: row.reviewer_wallet,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Validates an optional request message. Returns an error message or null.
 */
export function validateJoinRequestMessage(
  message: unknown,
  maxLength = 500,
): string | null {
  if (message === undefined || message === null || message === "") {
    return null;
  }

  if (typeof message !== "string") {
    return "message must be a string";
  }

  if (message.length > maxLength) {
    return `message must be at most ${maxLength} characters`;
  }

  return null;
}

export function parseJoinRequestStatusFilter(
  value: string | null,
): JoinRequestStatus | "all" {
  if (!value) return "pending";
  if (value === "all") return "all";
  return isValidJoinRequestStatus(value) ? value : "pending";
}
