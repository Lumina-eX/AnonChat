import { NextRequest, NextResponse } from "next/server";
import {
  verifyWalletAccessToken,
  getSignatureMaxAgeSec,
  WALLET_ACCESS_COOKIE,
  WALLET_ADDRESS_HEADER,
} from "@/lib/auth/wallet-jwt";
import { validateSession } from "@/lib/auth/session-store";

const PUBLIC_API_PREFIXES = [
  "/api/auth/nonce",
  "/api/auth/wallet-login",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/auth/sign-up",
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
 * Also validates that the session referenced in the JWT is still active.
 */
export async function enforceWalletApiAuth(
  request: NextRequest,
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

  const sigAgeSec = Math.floor(Date.now() / 1000) - claims.sigVerifiedAt;
  if (sigAgeSec > getSignatureMaxAgeSec()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Session expired. Wallet signature is too old. Please re-authenticate." },
        { status: 401 },
      ),
    };
  }

  // Validate session is still active (not terminated)
  if (claims.sessionId) {
    const session = await validateSession(claims.sessionId);
    if (!session) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Session has been terminated. Please re-authenticate." },
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
