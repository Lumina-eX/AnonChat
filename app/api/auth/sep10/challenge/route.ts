/**
 * SEP-10 challenge endpoint.
 *
 * GET  /api/auth/sep10/challenge?account=G...
 * POST /api/auth/sep10/challenge  { "account": "G..." }
 *
 * Returns a server-signed challenge transaction that the wallet must sign.
 */
import { type NextRequest, NextResponse } from "next/server";
import {
  buildSep10Challenge,
  checkSep10RateLimit,
  getCallerIp,
  Sep10Error,
} from "@/lib/auth/sep10";
import { validateWalletAddressWithMessage } from "@/lib/auth/validation";
import { logger } from "@/lib/logger";

function readAccount(request: NextRequest, body?: Record<string, unknown>): string {
  const fromBody =
    typeof body?.account === "string"
      ? body.account
      : typeof body?.walletAddress === "string"
        ? body.walletAddress
        : undefined;

  return fromBody ?? request.nextUrl.searchParams.get("account") ?? "";
}

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
      default:
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  logger.error("sep10.challenge_error");
  return NextResponse.json(
    { error: "Failed to generate challenge transaction" },
    { status: 500 },
  );
}

async function issueChallenge(request: NextRequest, body?: Record<string, unknown>) {
  try {
    const account = readAccount(request, body);
    const validationError = validateWalletAddressWithMessage(account);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const policy = undefined;
    const [ipAllowed, accountAllowed] = await Promise.all([
      checkSep10RateLimit(`ip:${getCallerIp(request.headers)}`, policy),
      checkSep10RateLimit(`account:${account}`, policy),
    ]);

    if (!ipAllowed || !accountAllowed) {
      throw new Sep10Error("rate_limited", "Too many authentication requests.");
    }

    const challenge = buildSep10Challenge(account);
    return NextResponse.json(challenge, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  return issueChallenge(request);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  return issueChallenge(request, body as Record<string, unknown> | undefined);
}
