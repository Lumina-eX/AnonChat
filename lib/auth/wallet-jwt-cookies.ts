import { type NextResponse } from "next/server";
import {
  getAccessTokenMaxAgeSec,
  getRefreshTokenMaxAgeSec,
  WALLET_ACCESS_COOKIE,
  WALLET_REFRESH_COOKIE,
} from "@/lib/auth/wallet-jwt";

const isProduction = process.env.NODE_ENV === "production";

const baseCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax" as const,
  path: "/",
};

export function setWalletAuthCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string,
): void {
  response.cookies.set(WALLET_ACCESS_COOKIE, accessToken, {
    ...baseCookieOptions,
    maxAge: getAccessTokenMaxAgeSec(),
  });
  response.cookies.set(WALLET_REFRESH_COOKIE, refreshToken, {
    ...baseCookieOptions,
    maxAge: getRefreshTokenMaxAgeSec(),
  });
}

export function clearWalletAuthCookies(response: NextResponse): void {
  response.cookies.set(WALLET_ACCESS_COOKIE, "", {
    ...baseCookieOptions,
    maxAge: 0,
  });
  response.cookies.set(WALLET_REFRESH_COOKIE, "", {
    ...baseCookieOptions,
    maxAge: 0,
  });
}
