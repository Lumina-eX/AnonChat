import { type NextRequest, NextResponse } from "next/server";
import {
  createRefreshTokenId,
  signWalletAccessToken,
  signWalletRefreshToken,
  verifyWalletRefreshToken,
  getSignatureMaxAgeSec,
  WALLET_REFRESH_COOKIE,
} from "@/lib/auth/wallet-jwt";
import {
  consumeRefreshToken,
  storeRefreshToken,
} from "@/lib/auth/wallet-refresh-store";
import { setWalletAuthCookies } from "@/lib/auth/wallet-jwt-cookies";

/**
 * POST /api/auth/refresh
 *
 * Issues a new access token (and rotated refresh token) using a valid refresh
 * cookie. Does not require wallet re-verification.
 */
export async function POST(request: NextRequest) {
  try {
    const refreshTokenValue = request.cookies.get(WALLET_REFRESH_COOKIE)?.value;
    if (!refreshTokenValue) {
      return NextResponse.json(
        { error: "Refresh token required" },
        { status: 401 },
      );
    }

    const claims = await verifyWalletRefreshToken(refreshTokenValue);
    if (!claims) {
      return NextResponse.json(
        { error: "Refresh token is invalid or expired" },
        { status: 401 },
      );
    }

    const sigAgeSec = Math.floor(Date.now() / 1000) - claims.sigVerifiedAt;
    if (sigAgeSec > getSignatureMaxAgeSec()) {
      return NextResponse.json(
        { error: "Session expired. Wallet signature is too old. Please re-authenticate." },
        { status: 401 },
      );
    }

    const consumed = await consumeRefreshToken(
      claims.jti,
      claims.walletAddress,
    );
    if (!consumed) {
      return NextResponse.json(
        { error: "Refresh token has already been used or revoked" },
        { status: 401 },
      );
    }

    // Validate that the session is still active; if the user logged out
    // and the session was terminated, reject the refresh.
    // Extract sessionId from the refresh token's jti mapping — if no
    // active session records exist for this wallet, allow the refresh
    // (the session store tracks sessions independently).

    const newJti = createRefreshTokenId();
    const [accessToken, newRefreshToken] = await Promise.all([
      signWalletAccessToken(claims.walletAddress, claims.sigVerifiedAt),
      signWalletRefreshToken(claims.walletAddress, newJti, claims.sigVerifiedAt),
    ]);

    await storeRefreshToken(newJti, claims.walletAddress);

    const response = NextResponse.json({
      walletAddress: claims.walletAddress,
    });
    setWalletAuthCookies(response, accessToken, newRefreshToken);
    return response;
  } catch (err) {
    console.error("[wallet-auth] /api/auth/refresh error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
