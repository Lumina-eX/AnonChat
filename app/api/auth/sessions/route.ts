import { type NextRequest, NextResponse } from "next/server";
import { listSessions, terminateAllSessions } from "@/lib/auth/session-store";
import { WALLET_ADDRESS_HEADER } from "@/lib/auth/wallet-jwt";

/**
 * GET /api/auth/sessions
 * Lists all active sessions for the authenticated wallet.
 */
export async function GET(request: NextRequest) {
  try {
    const walletAddress = request.headers.get(WALLET_ADDRESS_HEADER);
    if (!walletAddress) {
      return NextResponse.json(
        { error: "Wallet address not found in request" },
        { status: 400 },
      );
    }

    const sessions = await listSessions(walletAddress);

    return NextResponse.json({
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        createdAt: s.createdAt,
        lastActivityAt: s.lastActivityAt,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
      })),
    });
  } catch (err) {
    console.error("[sessions] GET /api/auth/sessions error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/auth/sessions
 * Terminates all sessions for the authenticated wallet (logout everywhere).
 */
export async function DELETE(request: NextRequest) {
  try {
    const walletAddress = request.headers.get(WALLET_ADDRESS_HEADER);
    if (!walletAddress) {
      return NextResponse.json(
        { error: "Wallet address not found in request" },
        { status: 400 },
      );
    }

    const count = await terminateAllSessions(walletAddress);

    return NextResponse.json({ ok: true, terminatedCount: count });
  } catch (err) {
    console.error("[sessions] DELETE /api/auth/sessions error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
