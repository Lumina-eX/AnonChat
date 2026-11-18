import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import {
  isValidTransactionHash,
  verifyStellarTransaction,
} from "@/lib/blockchain/transaction-verification";
import { getTransactionExplorerUrl } from "@/lib/blockchain/stellar-service";
import type { SupabaseClientLike } from "@/lib/blockchain/stellar-service";

type VerificationRequestBody = {
  transactionHash?: string;
  groupActionEventId?: string | null;
  groupId?: string | null;
  expectedMemo?: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: VerificationRequestBody = await request.json().catch(() => ({}));
    const transactionHash = body.transactionHash?.trim();

    if (!transactionHash) {
      return NextResponse.json(
        { error: "transactionHash is required" },
        { status: 400 },
      );
    }

    if (!isValidTransactionHash(transactionHash)) {
      return NextResponse.json(
        { error: "Invalid Stellar transaction hash" },
        { status: 400 },
      );
    }

    if (
      body.groupActionEventId &&
      !UUID_PATTERN.test(body.groupActionEventId)
    ) {
      return NextResponse.json(
        { error: "groupActionEventId must be a valid UUID" },
        { status: 400 },
      );
    }

    const verification = await verifyStellarTransaction({
      supabase: supabase as unknown as SupabaseClientLike,
      transactionHash,
      groupActionEventId: body.groupActionEventId ?? null,
      groupId: body.groupId ?? null,
      expectedMemo: body.expectedMemo ?? null,
    });

    if (!verification.verified) {
      return NextResponse.json(
        {
          error: verification.error ?? "Stellar transaction verification failed",
          verification,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ verification }, { status: 200 });
  } catch (error) {
    console.error("[stellar/transactions/verify] POST error:", error);
    return NextResponse.json(
      { error: "Failed to verify Stellar transaction" },
      { status: 500 },
    );
  }
}

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
    const transactionHash = searchParams.get("transactionHash")?.trim();

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

    const { data, error } = await supabase
      .from("stellar_transaction_verifications")
      .select(
        "transaction_hash, group_action_event_id, group_id, status, verified, ledger, memo, error_message, verified_at",
      )
      .eq("transaction_hash", transactionHash)
      .order("verified_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return NextResponse.json(
        { error: "No verification result found for transactionHash" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      verification: {
        transactionHash: data.transaction_hash,
        groupActionEventId: data.group_action_event_id,
        groupId: data.group_id,
        status: data.status,
        verified: data.verified,
        ledger: data.ledger,
        memo: data.memo,
        error: data.error_message,
        verifiedAt: data.verified_at,
        explorerUrl: getTransactionExplorerUrl(data.transaction_hash),
      },
    });
  } catch (error) {
    console.error("[stellar/transactions/verify] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch Stellar transaction verification" },
      { status: 500 },
    );
  }
}
