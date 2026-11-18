/**
 * POST /api/stellar/transactions/audit-verify
 *
 * Triggers the transaction audit verification service for a given Stellar
 * transaction hash and expected AnonChat action.
 *
 * The endpoint is idempotent: calling it multiple times with the same
 * transactionHash + expectedAction pair returns the existing verified result
 * without creating a duplicate audit record.
 *
 * Authentication: requires a valid Supabase session.
 *
 * Request body:
 * {
 *   "transactionHash":       string   — 64-character hex Stellar tx hash (required)
 *   "expectedAction":        string   — AnonChatAction enum value (required)
 *   "groupId":               string?  — room ID for context (optional)
 *   "expectedMemo":          string?  — memo the transaction must contain (optional)
 *   "expectedSourceAccount": string?  — wallet address that must have signed the tx (optional)
 *   "correlationId":         string?  — trace ID for distributed logging (optional)
 * }
 *
 * Responses:
 *   200 — verification result (verified=true)
 *   400 — invalid input (bad hash, unknown action)
 *   401 — not authenticated
 *   422 — verification completed but verified=false (failed / unverifiable / mismatch)
 *   500 — unexpected server error
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidTransactionHash } from "@/lib/blockchain/transaction-verification";
import { verifyTransactionForAudit } from "@/lib/blockchain/transaction-audit-verification";
import type { AnonChatAction } from "@/types/blockchain";

const VALID_ACTIONS = new Set<AnonChatAction>([
  "group_creation",
  "group_join",
  "group_leave",
  "member_removal",
  "wallet_auth",
  "ownership_transfer",
  "audit_event",
]);

function isValidAction(value: unknown): value is AnonChatAction {
  return typeof value === "string" && VALID_ACTIONS.has(value as AnonChatAction);
}

type RequestBody = {
  transactionHash?: unknown;
  expectedAction?: unknown;
  groupId?: unknown;
  expectedMemo?: unknown;
  expectedSourceAccount?: unknown;
  correlationId?: unknown;
};

export async function POST(request: NextRequest) {
  // ── Authentication ─────────────────────────────────────────────────────────
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "Failed to initialise database client" }, { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const transactionHash =
    typeof body.transactionHash === "string" ? body.transactionHash.trim() : undefined;
  const expectedAction = body.expectedAction;

  // ── Input validation ───────────────────────────────────────────────────────
  if (!transactionHash) {
    return NextResponse.json(
      { error: "transactionHash is required" },
      { status: 400 },
    );
  }

  if (!isValidTransactionHash(transactionHash)) {
    return NextResponse.json(
      { error: "Invalid Stellar transaction hash — must be 64 hexadecimal characters" },
      { status: 400 },
    );
  }

  if (!isValidAction(expectedAction)) {
    return NextResponse.json(
      {
        error: "expectedAction is required and must be one of: " + [...VALID_ACTIONS].join(", "),
      },
      { status: 400 },
    );
  }

  const groupId =
    typeof body.groupId === "string" ? body.groupId.trim() || null : null;
  const expectedMemo =
    typeof body.expectedMemo === "string" ? body.expectedMemo.trim() || null : null;
  const expectedSourceAccount =
    typeof body.expectedSourceAccount === "string"
      ? body.expectedSourceAccount.trim() || null
      : null;
  const correlationId =
    typeof body.correlationId === "string" ? body.correlationId.trim() || undefined : undefined;

  // ── Run verification ───────────────────────────────────────────────────────
  try {
    const result = await verifyTransactionForAudit(
      {
        transactionHash,
        expectedAction,
        groupId,
        expectedMemo,
        expectedSourceAccount,
        correlationId,
      },
      { supabase },
    );

    if (!result.verified) {
      return NextResponse.json(
        {
          error:
            result.error ??
            `Transaction verification did not succeed (status: ${result.status})`,
          verification: result,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ verification: result }, { status: 200 });
  } catch (error) {
    console.error("[stellar/transactions/audit-verify] POST error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred during transaction verification" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/stellar/transactions/audit-verify?transactionHash=...&expectedAction=...
 *
 * Retrieves the stored audit verification record for a given (hash, action) pair
 * without triggering a new verification run.
 */
export async function GET(request: NextRequest) {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "Failed to initialise database client" }, { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const transactionHash = searchParams.get("transactionHash")?.trim();
  const expectedAction = searchParams.get("expectedAction");

  if (!transactionHash) {
    return NextResponse.json(
      { error: "transactionHash query parameter is required" },
      { status: 400 },
    );
  }

  if (!isValidTransactionHash(transactionHash)) {
    return NextResponse.json(
      { error: "Invalid Stellar transaction hash" },
      { status: 400 },
    );
  }

  if (!isValidAction(expectedAction)) {
    return NextResponse.json(
      {
        error: "expectedAction query parameter is required and must be a valid AnonChat action",
      },
      { status: 400 },
    );
  }

  try {
    const { data, error } = await (supabase as any)
      .from("transaction_audit_verifications")
      .select(
        "transaction_hash, network_identifier, ledger, ledger_close_time, source_account, " +
        "operation_count, operation_type, expected_action, group_id, status, verified, " +
        "retry_count, error_message, diagnostic_details, verified_at, created_at",
      )
      .eq("transaction_hash", transactionHash)
      .eq("expected_action", expectedAction)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return NextResponse.json(
        { error: "No audit verification record found for the provided hash and action" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      verification: {
        transactionHash: data.transaction_hash,
        networkIdentifier: data.network_identifier,
        ledger: data.ledger,
        ledgerCloseTime: data.ledger_close_time,
        sourceAccount: data.source_account,
        operationCount: data.operation_count,
        operationType: data.operation_type,
        expectedAction: data.expected_action,
        groupId: data.group_id,
        status: data.status,
        verified: data.verified,
        retryCount: data.retry_count,
        error: data.error_message,
        diagnosticDetails: data.diagnostic_details,
        verifiedAt: data.verified_at,
        createdAt: data.created_at,
      },
    });
  } catch (error) {
    console.error("[stellar/transactions/audit-verify] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch audit verification record" },
      { status: 500 },
    );
  }
}
