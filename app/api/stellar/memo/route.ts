/**
 * POST /api/stellar/memo
 * Submits a Stellar transaction with the group ID embedded in the memo field
 * and persists the groupId ↔ txHash mapping in the database.
 *
 * Body: { groupId: string, maxFee?: number }
 *
 * GET /api/stellar/memo?groupId=<id>
 * Returns all memo records for a group, with validation status.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { submitGroupMemoTransaction, getMemosByGroupId, validateMemoRecord } from "@/lib/blockchain/memo-service";
import { validateGroupIdExists, getMemoStrategyInfo } from "@/lib/blockchain/memo-validation";

// ── POST — submit a memo transaction ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { groupId, maxFee } = body as { groupId?: string; maxFee?: number };

    // Validate groupId exists
    const groupCheck = await validateGroupIdExists(groupId ?? "", supabase);
    if (!groupCheck.valid) return groupCheck.response;

    // Provide strategy info for transparency
    const strategyInfo = getMemoStrategyInfo(groupId!);

    // Submit the memo transaction
    const result = await submitGroupMemoTransaction(
      groupId!,
      supabase,
      user.id,
      maxFee
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? "Failed to submit memo transaction" },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        groupId,
        txHash: result.txHash,
        memoValue: result.memoValue,
        memoType: result.memoType,
        explorerUrl: result.explorerUrl,
        feeCharged: result.feeCharged,
        strategy: strategyInfo,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[stellar/memo] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── GET — retrieve memo records for a group ───────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const groupId = searchParams.get("groupId");

    if (!groupId) {
      return NextResponse.json(
        { error: "groupId query parameter is required" },
        { status: 400 }
      );
    }

    // Validate group exists
    const groupCheck = await validateGroupIdExists(groupId, supabase);
    if (!groupCheck.valid) return groupCheck.response;

    const records = await getMemosByGroupId(groupId, supabase);

    // Run in-memory validation on each record
    const validated = records.map((r) => ({
      ...r,
      validation: validateMemoRecord(r),
    }));

    return NextResponse.json({
      groupId,
      memos: validated,
      strategy: getMemoStrategyInfo(groupId),
    });
  } catch (error) {
    console.error("[stellar/memo] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
