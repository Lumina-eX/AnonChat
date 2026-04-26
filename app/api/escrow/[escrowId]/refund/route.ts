/**
 * POST /api/escrow/[escrowId]/refund
 * Refunds escrowed funds back to the initiator.
 *
 * Who can call this:
 *  - The beneficiary (at any time while funded)
 *  - The initiator (only after the escrow has expired)
 *
 * Body: { maxFee?: number }
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refundEscrow } from "@/lib/blockchain/escrow-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ escrowId: string }> }
) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { escrowId } = await params;

    const body = await request.json().catch(() => ({}));
    const { maxFee } = body as { maxFee?: number };

    // Resolve actor wallet from user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("wallet_address")
      .eq("id", user.id)
      .maybeSingle();

    const actorWallet = profile?.wallet_address as string | undefined;
    if (!actorWallet) {
      return NextResponse.json(
        { error: "No wallet address found for your account" },
        { status: 400 }
      );
    }

    const result = await refundEscrow({ escrowId, actorWallet, maxFee }, supabase);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      escrow: result.escrow,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      feeCharged: result.feeCharged,
    });
  } catch (error) {
    console.error("[escrow/refund] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
