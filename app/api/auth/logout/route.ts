import { type NextRequest, NextResponse } from "next/server";
import {
  verifyWalletRefreshToken,
  verifyWalletAccessToken,
  WALLET_REFRESH_COOKIE,
  WALLET_ACCESS_COOKIE,
} from "@/lib/auth/wallet-jwt";
import { consumeRefreshToken } from "@/lib/auth/wallet-refresh-store";
import { clearWalletAuthCookies } from "@/lib/auth/wallet-jwt-cookies";
import { terminateSession } from "@/lib/auth/session-store";

/**
 * POST /api/auth/logout
 *
 * Clears wallet JWT cookies, revokes the refresh token when present,
 * and terminates the associated session.
 */
export async function POST(request: NextRequest) {
  try {
    const refreshTokenValue = request.cookies.get(WALLET_REFRESH_COOKIE)?.value;
    if (refreshTokenValue) {
      const claims = await verifyWalletRefreshToken(refreshTokenValue);
      if (claims) {
        await consumeRefreshToken(claims.jti, claims.walletAddress);
      }
    }

    // Terminate the session associated with the current access token
    const accessTokenValue = request.cookies.get(WALLET_ACCESS_COOKIE)?.value;
    if (accessTokenValue) {
      const accessClaims = await verifyWalletAccessToken(accessTokenValue);
      if (accessClaims?.sessionId && accessClaims?.walletAddress) {
        await terminateSession(accessClaims.sessionId, accessClaims.walletAddress);
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
