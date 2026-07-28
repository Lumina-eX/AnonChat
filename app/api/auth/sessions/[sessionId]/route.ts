import { type NextRequest, NextResponse } from "next/server";
import { WALLET_ADDRESS_HEADER } from "@/lib/auth/wallet-jwt";
import { revokeSession } from "@/lib/auth/session-service";
import { logger } from "@/lib/logger";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const walletAddress = request.headers.get(WALLET_ADDRESS_HEADER);
    if (!walletAddress) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { sessionId } = await params;
    const revoked = await revokeSession(sessionId);

    if (!revoked) {
      return NextResponse.json(
        { error: "Session not found or already revoked" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("sessions.revoke_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}