/**
 * GET /api/escrow/[escrowId]
 * Returns a single escrow record with its event history.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEscrow, getEscrowEvents } from "@/lib/blockchain/escrow-service";

export async function GET(
  _request: NextRequest,
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

    const result = await getEscrow(escrowId, supabase);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    const events = await getEscrowEvents(escrowId, supabase);

    return NextResponse.json({ escrow: result.escrow, events });
  } catch (error) {
    console.error("[escrow/[escrowId]] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
