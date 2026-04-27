/**
 * POST /api/escrow
 *   Create a new escrow for a group.
 *
 * Body:
 *   {
 *     groupId: string,
 *     parties: { depositor: string, beneficiary: string, arbitrator?: string },
 *     conditions: { amount: string, asset?: string, expiresAt?: string },
 *     maxFee?: string
 *   }
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { EscrowService } from "@/lib/blockchain/escrow-service";
import { CreateEscrowParams } from "@/types/escrow";

export async function POST(request: NextRequest) {
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

    const { groupId, parties, conditions, maxFee } = body ?? {};

    if (!groupId || !parties || !conditions) {
      return NextResponse.json(
        { error: "groupId, parties, and conditions are required" },
        { status: 400 }
      );
    }

    const params: CreateEscrowParams = { groupId, parties, conditions, maxFee };
    const service = new EscrowService(supabase);
    const result = await service.createEscrow(params);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ escrow: result.escrow }, { status: 201 });
  } catch (error: any) {
    console.error("[escrow] POST /api/escrow error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
