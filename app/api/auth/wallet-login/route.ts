import { type NextRequest, NextResponse } from "next/server";
import { consumeNonce, verifyWalletSignature } from "@/lib/auth/stellar-verify";
import { createClient } from "@/lib/supabase/server";
import { deterministicPassword } from "@/lib/auth/password";
import { validateWalletAddressWithMessage } from "@/lib/auth/validation";
import { buildWalletAuthResponse } from "@/lib/auth/wallet-token-response";
import { createSession } from "@/lib/auth/session-store";
import {
  verifySep10Challenge,
  type Sep10VerificationResult,
} from "@/lib/auth/sep10";
import { logAuthEvent } from "@/lib/auth/audit-log";
import { checkRateLimit } from "@/lib/auth/rate-limit";

/**
 * POST /api/auth/wallet-login
 * Body: { walletAddress: string, signature: string }
 *
 * Authenticates a user by verifying their wallet signature.
 * The signature must be created by signing the nonce with the wallet's private key.
 * 
 * Requirements: 1.1-1.6, 2.4, 3.1-3.4, 4.1-4.6, 5.1-5.6, 6.1-6.6, 7.1-7.5
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { walletAddress, signature, challengeXdr, networkPassphrase } = body ?? {};

    const ipAddress =
      request.headers.get("x-forwarded-for") ??
      request.headers.get("x-real-ip") ??
      undefined;
    const userAgent = request.headers.get("user-agent") ?? undefined;

    // ── 0. Rate limiting / abuse protection ──────────────────────────────────
    const rateLimit = await checkRateLimit({
      key: `wallet-login:${ipAddress ?? "unknown"}:${walletAddress ?? "unknown"}`,
      limit: 10,
      windowSeconds: 60,
    });
    if (!rateLimit.allowed) {
      logAuthEvent({
        event: "wallet_login_rate_limited",
        walletAddress,
        ipAddress,
        userAgent,
        success: false,
        reason: "rate_limited",
      });
      return NextResponse.json(
        { error: "Too many authentication attempts. Please try again later." },
        { status: 429 },
      );
    }

    // ── 1. Input validation ──────────────────────────────────────────────────
    // Validate wallet address format
    const walletValidationError = validateWalletAddressWithMessage(walletAddress);
    if (walletValidationError) {
      console.warn(`[wallet-auth] /api/auth/wallet-login validation failed: ${walletValidationError}`);
      logAuthEvent({
        event: "wallet_login_validation_failed",
        walletAddress,
        ipAddress,
        userAgent,
        success: false,
        reason: walletValidationError,
      });
      return NextResponse.json(
        { error: walletValidationError },
        { status: 400 },
      );
    }

    // Validate signature is present
    if (!signature || typeof signature !== "string" || signature.trim() === "") {
      console.warn(`[wallet-auth] /api/auth/wallet-login validation failed: signature is required`);
      logAuthEvent({
        event: "wallet_login_validation_failed",
        walletAddress,
        ipAddress,
        userAgent,
        success: false,
        reason: "signature_required",
      });
      return NextResponse.json(
        { error: "signature is required" },
        { status: 400 },
      );
    }

    // ── 2. SEP-10 challenge verification ─────────────────────────────────────
    // When a SEP-10 challenge transaction is supplied, validate it end-to-end:
    // structure, expiration, server signature, network passphrase, wallet
    // signature, and replay protections. Otherwise fall back to the legacy
    // nonce-based flow for backwards compatibility.
    let sep10Result: Sep10VerificationResult | null = null;
    if (challengeXdr) {
      sep10Result = await verifySep10Challenge({
        challengeXdr,
        walletAddress,
        signature,
        networkPassphrase,
      });
      if (!sep10Result.valid) {
        console.warn(
          `[wallet-auth] /api/auth/wallet-login SEP-10 verification failed for wallet: ${walletAddress.substring(0, 8)}... reason: ${sep10Result.reason}`,
        );
        logAuthEvent({
          event: "wallet_login_sep10_failed",
          walletAddress,
          ipAddress,
          userAgent,
          success: false,
          reason: sep10Result.reason,
        });
        return NextResponse.json(
          { error: "Challenge verification failed. Wallet ownership not proved." },
          { status: 401 },
        );
      }
    } else {
      // ── 2a. Legacy nonce flow (one-time use, expires after 5 min) ─────────
      const nonce = await consumeNonce(walletAddress);
      if (!nonce) {
        console.warn(`[wallet-auth] /api/auth/wallet-login nonce rejection: missing or expired for wallet: ${walletAddress.substring(0, 8)}...`);
        logAuthEvent({
          event: "wallet_login_nonce_failed",
          walletAddress,
          ipAddress,
          userAgent,
          success: false,
          reason: "nonce_missing_or_expired",
        });
        return NextResponse.json(
          { error: "Nonce not found or expired. Request a new nonce." },
          { status: 401 },
        );
      }

      // ── 3. Verify the signature ────────────────────────────────────────────
      const isValid = verifyWalletSignature(walletAddress, nonce, signature);
      if (!isValid) {
        console.warn(`[wallet-auth] /api/auth/wallet-login signature verification failed for wallet: ${walletAddress.substring(0, 8)}...`);
        logAuthEvent({
          event: "wallet_login_signature_failed",
          walletAddress,
          ipAddress,
          userAgent,
          success: false,
          reason: "invalid_wallet_signature",
        });
        return NextResponse.json(
          {
            error: "Signature verification failed. Wallet ownership not proved.",
          },
          { status: 401 },
        );
      }
    }

    // Ensure the authenticated account matches the expected wallet address.
    const authenticatedAccount =
      sep10Result?.account ?? walletAddress;
    if (authenticatedAccount !== walletAddress) {
      console.warn(`[wallet-auth] /api/auth/wallet-login account mismatch for wallet: ${walletAddress.substring(0, 8)}...`);
      logAuthEvent({
        event: "wallet_login_account_mismatch",
        walletAddress,
        ipAddress,
        userAgent,
        success: false,
        reason: "account_mismatch",
      });
      return NextResponse.json(
        { error: "Authenticated account does not match wallet address." },
        { status: 401 },
      );
    }

    // ── 4. Sign in / sign up via Supabase ────────────────────────────────────
    // Use a deterministic email and password keyed by the wallet address so
    // the same wallet always maps to the same Supabase user.
    const email = `${walletAddress.toLowerCase()}@wallet.anonchat.local`;
    const password = await deterministicPassword(walletAddress);

    const supabase = await createClient();

    // Try signing in first
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({ email, password });

    if (!signInError && signInData.session) {
      console.log(`[wallet-auth] /api/auth/wallet-login successful sign-in for wallet: ${walletAddress.substring(0, 8)}...`);
      const sigVerifiedAt = Math.floor(Date.now() / 1000);
      const sessionId = await createSession({
        walletAddress,
        userAgent,
        ipAddress,
      });
      logAuthEvent({
        event: "wallet_login_success",
        walletAddress,
        ipAddress,
        userAgent,
        success: true,
        method: sep10Result ? "sep10" : "nonce",
        sessionId,
      });
      return buildWalletAuthResponse(
        walletAddress,
        {
          session: signInData.session,
          user: signInData.user,
          walletAddress,
          isNewUser: false,
          sessionId,
        },
        200,
        sigVerifiedAt,
        sessionId,
      );
    }

    // First time — create the account
    console.log(`[wallet-auth] /api/auth/wallet-login creating new user for wallet: ${walletAddress.substring(0, 8)}...`);
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp(
      {
        email,
        password,
        options: {
          data: {
            wallet_address: walletAddress,
            username: `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`,
          },
          // No email confirmation needed — wallet signature is the proof
          emailRedirectTo: undefined,
        },
      },
    );

    if (signUpError) {
      console.error("[wallet-auth] /api/auth/wallet-login sign-up error:", signUpError.message);
      logAuthEvent({
        event: "wallet_login_signup_failed",
        walletAddress,
        ipAddress,
        userAgent,
        success: false,
        reason: "signup_error",
      });
      return NextResponse.json(
        { error: "Authentication failed. Please try again." },
        { status: 401 },
      );
    }

    console.log(`[wallet-auth] /api/auth/wallet-login successful sign-up for wallet: ${walletAddress.substring(0, 8)}...`);
    const sigVerifiedAt = Math.floor(Date.now() / 1000);
    const sessionId = await createSession({
      walletAddress,
      userAgent,
      ipAddress,
    });
    logAuthEvent({
      event: "wallet_login_signup_success",
      walletAddress,
      ipAddress,
      userAgent,
      success: true,
      method: sep10Result ? "sep10" : "nonce",
      sessionId,
    });
    return buildWalletAuthResponse(
      walletAddress,
      {
        session: signUpData.session,
        user: signUpData.user,
        walletAddress,
        isNewUser: true,
        sessionId,
      },
      201,
      sigVerifiedAt,
      sessionId,
    );
  } catch (err: any) {
    console.error("[wallet-auth] /api/auth/wallet-login error:", err);
    logAuthEvent({
      event: "wallet_login_error",
      success: false,
      reason: "internal_error",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
