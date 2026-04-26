/**
 * POST /api/escrow/[escrowId]/release
 * Releases escrowed funds to the beneficiary.
 * Only the escrow initiator can call this.
 *
 * Body: { maxFee?: number }
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { releaseEscrow } from "@/lib/blockchain/escrow-service";

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

    const result = await releaseEscrow({ escrowId, actorWallet, maxFee }, supabase);

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
    console.error("[escrow/release] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
