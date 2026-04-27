/**
 * POST /api/escrow/[escrowId]/refund
 *
 * Refunds escrowed funds to the depositor.
 * Caller must be the depositor, or the arbitrator after expiry.
 *
 * Body: { callerPublicKey: string }
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { EscrowService } from "@/lib/blockchain/escrow-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ escrowId: string }> }
) {
  const { escrowId } = await params;

  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { callerPublicKey } = body ?? {};
    if (!callerPublicKey || typeof callerPublicKey !== "string") {
      return NextResponse.json({ error: "callerPublicKey is required" }, { status: 400 });
    }

    const service = new EscrowService(supabase);
    const result = await service.refundEscrow({ escrowId, callerPublicKey });

    if (!result.success) {
      const status = result.error?.includes("[NOT_FOUND]")
        ? 404
        : result.error?.includes("[UNAUTHORIZED]")
        ? 403
        : result.error?.includes("[INVALID_STATUS]")
        ? 409
        : result.error?.includes("[EXPIRED]")
        ? 410
        : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({
      escrow: result.escrow,
      transactionHash: result.transactionHash,
      explorerUrl: result.explorerUrl,
    });
  } catch (error: any) {
    console.error("[escrow] refund error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
