/**
 * POST /api/stellar/memo/validate
 * Validates memo integrity for a given groupId + txHash pair.
 *
 * Body: { groupId: string, txHash: string }
 *
 * Returns whether the memo record exists, is linked to the correct group,
 * and passes integrity checks.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMemoByTxHash, validateMemoRecord } from "@/lib/blockchain/memo-service";
import {
  validateGroupIdExists,
  validateTxMemoRecord,
} from "@/lib/blockchain/memo-validation";

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
    const { groupId, txHash } = body as { groupId?: string; txHash?: string };

    // Validate groupId
    const groupCheck = await validateGroupIdExists(groupId ?? "", supabase);
    if (!groupCheck.valid) return groupCheck.response;

    // Validate txHash against DB record
    const txCheck = await validateTxMemoRecord(txHash ?? "", groupId!, supabase);
    if (!txCheck.valid) return txCheck.response;

    // Fetch the record and run full validation
    const record = await getMemoByTxHash(txHash!, supabase);
    if (!record) {
      return NextResponse.json(
        { error: "Memo record not found" },
        { status: 404 }
      );
    }

    const validation = validateMemoRecord(record);

    return NextResponse.json({
      valid: validation.isValid,
      groupId: validation.groupId,
      txHash: validation.txHash,
      memoValue: validation.memoValue,
      memoType: validation.memoType,
      verifiedAt: validation.verifiedAt,
    });
  } catch (error) {
    console.error("[stellar/memo/validate] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
