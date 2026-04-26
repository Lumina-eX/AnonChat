/**
 * POST /api/escrow/[escrowId]/dispute
 * Raises a dispute on a funded escrow.
 * Either the initiator or beneficiary can call this.
 *
 * Body: { reason: string }
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { disputeEscrow } from "@/lib/blockchain/escrow-service";

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
    const { reason } = body as { reason?: string };

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json(
        { error: "reason is required and must be a non-empty string" },
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

    const result = await disputeEscrow({ escrowId, actorWallet, reason }, supabase);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ escrow: result.escrow });
  } catch (error) {
    console.error("[escrow/dispute] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
