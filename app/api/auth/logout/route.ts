import { type NextRequest, NextResponse } from "next/server";
import {
  verifyWalletRefreshToken,
  WALLET_REFRESH_COOKIE,
} from "@/lib/auth/wallet-jwt";
import { consumeRefreshToken } from "@/lib/auth/wallet-refresh-store";
import { clearWalletAuthCookies } from "@/lib/auth/wallet-jwt-cookies";
import { revokeSessionByJti } from "@/lib/auth/session-service";
import { logger } from "@/lib/logger";

/**
 * POST /api/auth/logout
 *
 * Clears wallet JWT cookies, revokes the refresh token when present,
 * and terminates the associated session record.
 */
export async function POST(request: NextRequest) {
  try {
    const refreshTokenValue = request.cookies.get(WALLET_REFRESH_COOKIE)?.value;
    if (refreshTokenValue) {
      const claims = await verifyWalletRefreshToken(refreshTokenValue);
      if (claims) {
        await consumeRefreshToken(claims.jti, claims.walletAddress);
        await revokeSessionByJti(claims.jti).catch((err) => {
          logger.warn("session.revoke_on_logout_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }

    const response = NextResponse.json({ ok: true });
    clearWalletAuthCookies(response);
    return response;
  } catch (err) {
    console.error("[wallet-auth] /api/auth/logout error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
