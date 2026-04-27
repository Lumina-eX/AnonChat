/**
 * GET /api/escrow/by-group/[groupId]
 *
 * Lists all escrows for a given group.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { EscrowService } from "@/lib/blockchain/escrow-service";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;

  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const service = new EscrowService(supabase);
    const escrows = await service.listEscrowsByGroup(groupId);

    return NextResponse.json({ groupId, escrows });
  } catch (error: any) {
    console.error("[escrow] by-group error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
