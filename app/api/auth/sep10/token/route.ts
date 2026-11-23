/**
 * SEP-10 token endpoint.
 *
 * POST /api/auth/sep10/token  { "transaction": "<base64 XDR>", "account": "G..." }
 *
 * Validates the wallet-signed challenge transaction and, only after the
 * challenge and both signatures are verified, issues an application session
 * bound to the authenticated Stellar account.
 */
import { type NextRequest, NextResponse } from "next/server";
import {
  checkSep10RateLimit,
  consumeSep10Challenge,
  getCallerIp,
  getSep10RatePolicy,
  loadSep10Config,
  Sep10Error,
  verifySep10Challenge,
} from "@/lib/auth/sep10";
import { validateWalletAddressWithMessage } from "@/lib/auth/validation";
import { createSession } from "@/lib/auth/session-store";
import {
  createRefreshTokenId,
  getAccessTokenMaxAgeSec,
  signWalletAccessToken,
  signWalletRefreshToken,
} from "@/lib/auth/wallet-jwt";
import { storeRefreshToken } from "@/lib/auth/wallet-refresh-store";
import { setWalletAuthCookies } from "@/lib/auth/wallet-jwt-cookies";
import { logger } from "@/lib/logger";

type TokenBody = {
  transaction?: string;
  account?: string;
  walletAddress?: string;
};

function errorResponse(error: unknown): NextResponse {
  if (error instanceof Sep10Error) {
    switch (error.code) {
      case "server_not_configured":
        return NextResponse.json({ error: error.message }, { status: 503 });
      case "rate_limited":
        return NextResponse.json(
          { error: "Too many authentication requests. Please try again later." },
          { status: 429 },
        );
      case "challenge_replayed":
        return NextResponse.json(
          { error: "Challenge transaction has already been used." },
          { status: 401 },
        );
      default:
        // Do not leak verification internals to the caller.
        return NextResponse.json(
          { error: "Invalid or expired challenge transaction." },
          { status: 401 },
        );
    }
  }

  logger.error("sep10.token_error");
  return NextResponse.json(
    { error: "Authentication failed. Please try again." },
    { status: 401 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const config = loadSep10Config();
    if (!config) {
      throw new Sep10Error(
        "server_not_configured",
        "SEP-10 authentication is not configured on this server.",
      );
    }

    const allowed = await checkSep10RateLimit(
      `ip:${getCallerIp(request.headers)}`,
      getSep10RatePolicy(),
    );
    if (!allowed) {
      throw new Sep10Error("rate_limited", "Too many authentication requests.");
    }

    const body: TokenBody = await request.json().catch(() => ({}));
    const transaction = body.transaction;

    if (!transaction || typeof transaction !== "string") {
      return NextResponse.json(
        { error: "transaction is required" },
        { status: 400 },
      );
    }

    const expectedAccount = body.account ?? body.walletAddress;
    if (expectedAccount !== undefined) {
      const validationError = validateWalletAddressWithMessage(expectedAccount);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }
    }

    const verification = verifySep10Challenge(transaction, expectedAccount);

    const isFresh = await consumeSep10Challenge(
      verification.transactionHash,
      config.challengeTtlSec,
    );
    if (!isFresh) {
      logger.warn("sep10.replay_rejected", {
        wallet: `${verification.walletAddress.substring(0, 8)}...`,
        transactionHash: verification.transactionHash,
      });
      throw new Sep10Error(
        "challenge_replayed",
        "Challenge transaction has already been used.",
      );
    }

    const sessionId = await createSession({
      walletAddress: verification.walletAddress,
      userAgent: request.headers.get("user-agent") ?? undefined,
      ipAddress:
        request.headers.get("x-forwarded-for") ??
        request.headers.get("x-real-ip") ??
        undefined,
    });

    logger.info("sep10.authentication_succeeded", {
      wallet: `${verification.walletAddress.substring(0, 8)}...`,
      sessionId,
      homeDomain: config.homeDomain,
      transactionHash: verification.transactionHash,
    });

    const sigVerifiedAt = Math.floor(Date.now() / 1000);
    const jti = createRefreshTokenId();
    const [token, refreshToken] = await Promise.all([
      signWalletAccessToken(
        verification.walletAddress,
        sigVerifiedAt,
        sessionId,
      ),
      signWalletRefreshToken(verification.walletAddress, jti, sigVerifiedAt),
    ]);
    await storeRefreshToken(jti, verification.walletAddress);

    const response = NextResponse.json(
      {
        token,
        token_type: "Bearer",
        walletAddress: verification.walletAddress,
        sessionId,
        expires_in: getAccessTokenMaxAgeSec(),
      },
      { status: 200 },
    );
    setWalletAuthCookies(response, token, refreshToken);
    return response;
  } catch (error) {
    logger.warn("sep10.authentication_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return errorResponse(error);
  }
}
