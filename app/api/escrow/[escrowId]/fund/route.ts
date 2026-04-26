/**
 * POST /api/escrow/[escrowId]/fund
 * Marks an escrow as funded after the initiator has sent funds on-chain.
 *
 * Body: { fundTxHash: string }
 *
 * The caller must have already submitted the Stellar payment transaction
 * and provide the resulting transaction hash.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fundEscrow } from "@/lib/blockchain/escrow-service";

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
    const { fundTxHash } = body as { fundTxHash?: string };

    if (!fundTxHash || typeof fundTxHash !== "string" || fundTxHash.trim() === "") {
      return NextResponse.json(
        { error: "fundTxHash is required" },
        { status: 400 }
      );
    }

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

    const result = await fundEscrow({ escrowId, fundTxHash, actorWallet }, supabase);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ escrow: result.escrow, txHash: result.txHash });
  } catch (error) {
    console.error("[escrow/fund] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
