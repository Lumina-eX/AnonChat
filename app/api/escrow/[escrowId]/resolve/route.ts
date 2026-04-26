/**
 * POST /api/escrow/[escrowId]/resolve
 * Resolves a disputed escrow by releasing funds to either party.
 *
 * This endpoint is restricted to authenticated users with a resolver role.
 * In the current implementation, any authenticated user can resolve disputes
 * (suitable for testnet / MVP). For production, add role-based access control
 * or replace with DAO voting.
 *
 * Body: {
 *   releaseToInitiator: boolean,  // true → refund initiator, false → pay beneficiary
 *   maxFee?: number
 * }
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveDispute } from "@/lib/blockchain/escrow-service";

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
    const { releaseToInitiator, maxFee } = body as {
      releaseToInitiator?: boolean;
      maxFee?: number;
    };

    if (typeof releaseToInitiator !== "boolean") {
      return NextResponse.json(
        { error: "releaseToInitiator (boolean) is required" },
        { status: 400 }
      );
    }

    const result = await resolveDispute(
      {
        escrowId,
        resolverUserId: user.id,
        releaseToInitiator,
        maxFee,
      },
      supabase
    );

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
    console.error("[escrow/resolve] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
