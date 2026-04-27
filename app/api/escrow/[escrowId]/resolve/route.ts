/**
 * POST /api/escrow/[escrowId]/resolve
 *
 * Resolves a disputed escrow.  Only the designated arbitrator may call this.
 *
 * Body:
 *   {
 *     arbitratorPublicKey: string,
 *     resolution: "release" | "refund" | "split",
 *     beneficiarySharePercent?: number   // required when resolution === "split"
 *   }
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { EscrowService } from "@/lib/blockchain/escrow-service";
import { DisputeResolution } from "@/types/escrow";

const VALID_RESOLUTIONS: DisputeResolution[] = ["release", "refund", "split"];

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

    const { arbitratorPublicKey, resolution, beneficiarySharePercent } = body ?? {};

    if (!arbitratorPublicKey || typeof arbitratorPublicKey !== "string") {
      return NextResponse.json({ error: "arbitratorPublicKey is required" }, { status: 400 });
    }

    if (!VALID_RESOLUTIONS.includes(resolution)) {
      return NextResponse.json(
        { error: 'resolution must be "release", "refund", or "split"' },
        { status: 400 }
      );
    }

    if (resolution === "split") {
      if (
        beneficiarySharePercent == null ||
        typeof beneficiarySharePercent !== "number" ||
        beneficiarySharePercent < 0 ||
        beneficiarySharePercent > 100
      ) {
        return NextResponse.json(
          { error: "beneficiarySharePercent (0–100) is required for split resolution" },
          { status: 400 }
        );
      }
    }

    const service = new EscrowService(supabase);
    const result = await service.resolveDispute({
      escrowId,
      arbitratorPublicKey,
      resolution,
      beneficiarySharePercent,
    });

    if (!result.success) {
      const status = result.error?.includes("[NOT_FOUND]")
        ? 404
        : result.error?.includes("[UNAUTHORIZED]")
        ? 403
        : result.error?.includes("[INVALID_STATUS]")
        ? 409
        : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({
      escrow: result.escrow,
      transactionHash: result.transactionHash,
      explorerUrl: result.explorerUrl,
    });
  } catch (error: any) {
    console.error("[escrow] resolve error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
