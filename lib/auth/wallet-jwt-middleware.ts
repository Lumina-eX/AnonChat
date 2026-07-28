import { NextRequest, NextResponse } from "next/server";
import {
  verifyWalletAccessToken,
  WALLET_ACCESS_COOKIE,
  WALLET_ADDRESS_HEADER,
} from "@/lib/auth/wallet-jwt";
import { getActiveSessions } from "@/lib/auth/session-service";

const PUBLIC_API_PREFIXES = [
  "/api/auth/nonce",
  "/api/auth/wallet-login",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/auth/sign-up",
  "/api/auth/sessions",
  "/api/stellar/",
  "/api/rooms/seed-test",
];

function isPublicApiPath(pathname: string, method: string): boolean {
  if (
    method === "GET" &&
    (pathname === "/api/rooms" ||
      /^\/api\/rooms\/[^/]+\/verify$/.test(pathname))
  ) {
    return true;
  }

  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

function extractAccessToken(request: NextRequest): string | undefined {
  const cookieToken = request.cookies.get(WALLET_ACCESS_COOKIE)?.value;
  if (cookieToken) return cookieToken;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim() || undefined;
  }

  return undefined;
}

type WalletApiAuthResult =
  | { ok: true; request: NextRequest }
  | { ok: false; response: NextResponse };

/**
 * Validates wallet JWT on protected API routes and forwards the wallet address
 * via x-wallet-address. Returns a 401 response when validation fails.
 *
 * When validateSession is true, also checks that an active session record
 * exists in the database for the wallet.
 */
export async function enforceWalletApiAuth(
  request: NextRequest,
  options?: { validateSession?: boolean },
): Promise<WalletApiAuthResult> {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/") || isPublicApiPath(pathname, request.method)) {
    return { ok: true, request };
  }

  const accessToken = extractAccessToken(request);
  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized. Valid wallet access token required." },
        { status: 401 },
      ),
    };
  }

  const claims = await verifyWalletAccessToken(accessToken);
  if (!claims) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized. Access token is invalid or expired." },
        { status: 401 },
      ),
    };
  }

  if (options?.validateSession) {
    const activeSessions = await getActiveSessions(claims.walletAddress);
    if (activeSessions.length === 0) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Unauthorized. No active session found. Please log in again." },
          { status: 401 },
        ),
      };
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(WALLET_ADDRESS_HEADER, claims.walletAddress);

  const enrichedRequest = new NextRequest(request.url, {
    headers: requestHeaders,
    method: request.method,
  });

  return { ok: true, request: enrichedRequest };
}
