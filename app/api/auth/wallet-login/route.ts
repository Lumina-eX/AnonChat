import { type NextRequest, NextResponse } from "next/server";
import { consumeNonce, verifyWalletSignature } from "@/lib/auth/stellar-verify";
import { createClient } from "@/lib/supabase/server";
import { deterministicPassword } from "@/lib/auth/password";
import { validateWalletAddressWithMessage } from "@/lib/auth/validation";

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
    const { walletAddress, signature } = body ?? {};

    // ── 1. Input validation ──────────────────────────────────────────────────
    // Validate wallet address format
    const walletValidationError = validateWalletAddressWithMessage(walletAddress);
    if (walletValidationError) {
      console.warn(`[wallet-auth] /api/auth/wallet-login validation failed: ${walletValidationError}`);
      return NextResponse.json(
        { error: walletValidationError },
        { status: 400 },
      );
    }

    // Validate signature is present
    if (!signature || typeof signature !== "string" || signature.trim() === "") {
      console.warn(`[wallet-auth] /api/auth/wallet-login validation failed: signature is required`);
      return NextResponse.json(
        { error: "signature is required" },
        { status: 400 },
      );
    }

    // ── 2. Consume the nonce (one-time use, expires after 5 min) ────────────
    const nonce = consumeNonce(walletAddress);
    if (!nonce) {
      console.warn(`[wallet-auth] /api/auth/wallet-login nonce not found or expired for wallet: ${walletAddress.substring(0, 8)}...`);
      return NextResponse.json(
        { error: "Nonce not found or expired. Request a new nonce." },
        { status: 401 },
      );
    }

    // ── 3. Verify the signature ──────────────────────────────────────────────
    const isValid = verifyWalletSignature(walletAddress, nonce, signature);
    if (!isValid) {
      console.warn(`[wallet-auth] /api/auth/wallet-login signature verification failed for wallet: ${walletAddress.substring(0, 8)}...`);
      return NextResponse.json(
        {
          error: "Signature verification failed. Wallet ownership not proved.",
        },
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
      return NextResponse.json(
        {
          session: signInData.session,
          user: signInData.user,
          walletAddress,
          isNewUser: false,
        },
        { status: 200 },
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
      return NextResponse.json(
        { error: "Authentication failed. Please try again." },
        { status: 401 },
      );
    }

    console.log(`[wallet-auth] /api/auth/wallet-login successful sign-up for wallet: ${walletAddress.substring(0, 8)}...`);
    return NextResponse.json(
      {
        session: signUpData.session,
        user: signUpData.user,
        walletAddress,
        isNewUser: true,
      },
      { status: 201 },
    );
  } catch (err: any) {
    console.error("[wallet-auth] /api/auth/wallet-login error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
