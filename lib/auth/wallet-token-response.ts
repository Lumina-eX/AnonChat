import { NextResponse } from "next/server";
import {
  createRefreshTokenId,
  signWalletAccessToken,
  signWalletRefreshToken,
  getRefreshTokenMaxAgeSec,
} from "@/lib/auth/wallet-jwt";
import { storeRefreshToken } from "@/lib/auth/wallet-refresh-store";
import { setWalletAuthCookies } from "@/lib/auth/wallet-jwt-cookies";
import { createSession } from "@/lib/auth/session-service";
import { logger } from "@/lib/logger";

export async function buildWalletAuthResponse(
  walletAddress: string,
  body: Record<string, unknown>,
  status: number,
  metadata?: { userAgent?: string; ipAddress?: string },
): Promise<NextResponse> {
  const jti = createRefreshTokenId();
  const [accessToken, refreshToken] = await Promise.all([
    signWalletAccessToken(walletAddress),
    signWalletRefreshToken(walletAddress, jti),
  ]);

  await storeRefreshToken(jti, walletAddress);

  let sessionId: string | undefined;

  try {
    const expiresAt = new Date(
      Date.now() + getRefreshTokenMaxAgeSec() * 1000,
    );
    const session = await createSession({
      walletAddress,
      refreshTokenJti: jti,
      expiresAt,
      metadata,
    });
    sessionId = session.id;
    body.sessionId = session.id;
  } catch (err) {
    logger.error("session.creation_failed_on_login", {
      error: err instanceof Error ? err.message : String(err),
      walletAddress,
    });
  }

  const response = NextResponse.json(body, { status });
  setWalletAuthCookies(response, accessToken, refreshToken);
  return response;
}
