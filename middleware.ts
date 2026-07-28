import { NextResponse, type NextRequest } from "next/server";
import {
  verifyWalletAccessToken,
  WALLET_ADDRESS_HEADER,
} from "@/lib/auth/wallet-jwt";
import { getActiveSessions } from "@/lib/auth/session-service";
import { updateSession } from "@/lib/supabase/proxy";
import { logger } from "@/lib/logger";

const PUBLIC_API_PREFIXES = [
  "/api/auth/nonce",
  "/api/auth/wallet-login",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/auth/sign-up",
  "/api/auth/sessions",
  "/api/stellar/",
  "/api/rooms/seed-test",
  "/api/ephemeral/",
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
  const cookieToken = request.cookies.get("wallet_access_token")?.value;
  if (cookieToken) return cookieToken;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim() || undefined;
  }

  return undefined;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (isPublicApiPath(pathname, request.method)) {
      return NextResponse.next();
    }

    const accessToken = extractAccessToken(request);
    if (!accessToken) {
      return NextResponse.json(
        { error: "Unauthorized. Valid wallet access token required." },
        { status: 401 },
      );
    }

    const claims = await verifyWalletAccessToken(accessToken);
    if (!claims) {
      return NextResponse.json(
        { error: "Unauthorized. Access token is invalid or expired." },
        { status: 401 },
      );
    }

    const activeSessions = await getActiveSessions(claims.walletAddress);
    if (activeSessions.length === 0) {
      return NextResponse.json(
        { error: "Unauthorized. No active session found. Please log in again." },
        { status: 401 },
      );
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(WALLET_ADDRESS_HEADER, claims.walletAddress);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};