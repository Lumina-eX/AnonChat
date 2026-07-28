import { type NextRequest, NextResponse } from "next/server";
import { WALLET_ADDRESS_HEADER } from "@/lib/auth/wallet-jwt";
import {
  getActiveSessions,
  revokeAllSessions,
} from "@/lib/auth/session-service";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const walletAddress = request.headers.get(WALLET_ADDRESS_HEADER);
    if (!walletAddress) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const sessions = await getActiveSessions(walletAddress);

    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        createdAt: s.created_at,
        expiresAt: s.expires_at,
        lastActiveAt: s.last_active_at,
      })),
    });
  } catch (err) {
    logger.error("sessions.list_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const walletAddress = request.headers.get(WALLET_ADDRESS_HEADER);
    if (!walletAddress) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const count = await revokeAllSessions(walletAddress);

    return NextResponse.json({
      ok: true,
      revokedCount: count,
    });
  } catch (err) {
    logger.error("sessions.revoke_all_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}