import { type NextRequest, NextResponse } from "next/server";
import { generateNonce } from "@/lib/auth/stellar-verify";
import { validateWalletAddressWithMessage } from "@/lib/auth/validation";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { logAuthEvent } from "@/lib/auth/audit-log";

/**
 * POST /api/auth/nonce
 * Body: { walletAddress: string }
 *
 * Returns a one-time nonce the client must sign with their Stellar wallet.
 * The nonce is stored server-side and expires in 5 minutes.
 *
 * Requirements: 2.1, 2.2, 2.3, 5.1, 5.3, 5.4, 7.5
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    // Rate limit authentication endpoints to prevent abuse.
    const rateLimit = await checkRateLimit(request, "auth:nonce");
    if (!rateLimit.allowed) {
      await logAuthEvent({
        event: "nonce_rate_limited",
        requestId,
        metadata: { retryAfter: rateLimit.retryAfterSeconds },
      });
      return NextResponse.json(
        { error: "Too many authentication requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const body = await request.json();
    const { walletAddress } = body ?? {};

    // Validate wallet address using validation utility
    const validationError = validateWalletAddressWithMessage(walletAddress);
    if (validationError) {
      await logAuthEvent({
        event: "nonce_validation_failed",
        requestId,
        metadata: { reason: validationError },
      });
      return NextResponse.json(
        { error: validationError },
        { status: 400 },
      );
    }

    // Generate nonce with 5-minute expiration
    const nonce = await generateNonce(walletAddress);

    await logAuthEvent({
      event: "nonce_issued",
      requestId,
      walletAddress,
      metadata: { noncePrefix: nonce.slice(0, 8) },
    });

    return NextResponse.json({ nonce }, { status: 200 });
  } catch (err) {
    await logAuthEvent({
      event: "nonce_error",
      requestId,
      metadata: { reason: err instanceof Error ? err.message : "unknown" },
    });
    return NextResponse.json(
      { error: "Failed to generate nonce" },
      { status: 500 },
    );
  }
}
