import { type NextRequest, NextResponse } from "next/server";
import { terminateSession } from "@/lib/auth/session-store";
import { WALLET_ADDRESS_HEADER } from "@/lib/auth/wallet-jwt";

/**
 * DELETE /api/auth/sessions/[sessionId]
 * Terminates a specific session for the authenticated wallet.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const walletAddress = request.headers.get(WALLET_ADDRESS_HEADER);
    if (!walletAddress) {
      return NextResponse.json(
        { error: "Wallet address not found in request" },
        { status: 400 },
      );
    }

    const { sessionId } = await params;

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "Session ID is required" },
        { status: 400 },
      );
    }

    const terminated = await terminateSession(sessionId, walletAddress);
    if (!terminated) {
      return NextResponse.json(
        { error: "Session not found or does not belong to this wallet" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[sessions] DELETE /api/auth/sessions/[sessionId] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
