/**
 * GET /api/escrow/[escrowId]
 *   Retrieve a single escrow record.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { EscrowService } from "@/lib/blockchain/escrow-service";

export async function GET(
  _request: NextRequest,
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

    const service = new EscrowService(supabase);
    const escrow = await service.getEscrow(escrowId);

    if (!escrow) {
      return NextResponse.json({ error: "Escrow not found" }, { status: 404 });
    }

    return NextResponse.json({ escrow });
  } catch (error: any) {
    console.error("[escrow] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
