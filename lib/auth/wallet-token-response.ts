import { NextResponse } from "next/server";
import {
  createRefreshTokenId,
  signWalletAccessToken,
  signWalletRefreshToken,
} from "@/lib/auth/wallet-jwt";
import { storeRefreshToken } from "@/lib/auth/wallet-refresh-store";
import { setWalletAuthCookies } from "@/lib/auth/wallet-jwt-cookies";

export async function buildWalletAuthResponse(
  walletAddress: string,
  body: Record<string, unknown>,
  status: number,
  sigVerifiedAt?: number,
  sessionId?: string,
): Promise<NextResponse> {
  const jti = createRefreshTokenId();
  const sigTime = sigVerifiedAt ?? Math.floor(Date.now() / 1000);
  const [accessToken, refreshToken] = await Promise.all([
    signWalletAccessToken(walletAddress, sigTime, sessionId),
    signWalletRefreshToken(walletAddress, jti, sigTime),
  ]);

  await storeRefreshToken(jti, walletAddress);

  const response = NextResponse.json(body, { status });
  setWalletAuthCookies(response, accessToken, refreshToken);
  return response;
}
