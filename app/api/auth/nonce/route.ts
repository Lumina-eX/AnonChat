import { type NextRequest, NextResponse } from "next/server";
import { generateNonce } from "@/lib/auth/stellar-verify";
import { validateWalletAddressWithMessage } from "@/lib/auth/validation";

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
  try {
    const body = await request.json();
    const { walletAddress } = body ?? {};

    // Validate wallet address using validation utility
    const validationError = validateWalletAddressWithMessage(walletAddress);
    if (validationError) {
      console.warn(`[wallet-auth] /api/auth/nonce validation failed: ${validationError}`);
      return NextResponse.json(
        { error: validationError },
        { status: 400 },
      );
    }

    // Generate nonce with 5-minute expiration
    const nonce = generateNonce(walletAddress);
    
    console.log(`[wallet-auth] /api/auth/nonce generated nonce for wallet: ${walletAddress.substring(0, 8)}...`);

    return NextResponse.json({ nonce }, { status: 200 });
  } catch (err) {
    console.error("[wallet-auth] /api/auth/nonce error:", err);
    return NextResponse.json(
      { error: "Failed to generate nonce" },
      { status: 500 },
    );
  }
}
