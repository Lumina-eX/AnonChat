/**
 * Signed Message Verification Middleware
 *
 * Provides reusable server-side verification of wallet-signed messages
 * for protecting sensitive API actions beyond session auth.
 *
 * Usage in any route handler:
 *   const result = await verifySignedMessage(request);
 *   if (!result.ok) return result.response;
 *   // result.walletAddress is now available
 */

import { verifyWalletSignature } from "@/lib/auth/stellar-verify";
import { validateWalletAddressWithMessage } from "@/lib/auth/validation";
import { WALLET_ADDRESS_HEADER } from "@/lib/auth/wallet-jwt";

export interface SignedMessagePayload {
  /** Stellar public key of the signing wallet */
  walletAddress: string;
  /** The plaintext message that was signed */
  message: string;
  /** Hex-encoded Ed25519 signature */
  signature: string;
}

export type SignedMessageResult =
  | { ok: true; walletAddress: string }
  | { ok: false; response: Response };

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Verifies a wallet-signed message from a request body.
 *
 * Expects JSON body: { walletAddress, message, signature }
 *
 * Returns { ok: true, walletAddress } on success,
 * or { ok: false, response } with the appropriate error response.
 *
 * Does NOT consume a nonce — callers that need replay protection
 * should pair this with consumeNonce() from stellar-verify.ts.
 */
export async function verifySignedMessage(
  request: Request,
): Promise<SignedMessageResult> {
  let body: Partial<SignedMessagePayload>;

  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: jsonResponse({ error: "Invalid JSON body" }, 400),
    };
  }

  const { walletAddress, message, signature } = body ?? {};

  // ── Input validation ────────────────────────────────────────────────────────
  const walletError = validateWalletAddressWithMessage(walletAddress as string);
  if (walletError) {
    console.warn(`[signed-msg] validation failed: ${walletError}`);
    return {
      ok: false,
      response: jsonResponse({ error: walletError }, 400),
    };
  }

  if (!message || typeof message !== "string" || message.trim() === "") {
    console.warn("[signed-msg] validation failed: message is required");
    return {
      ok: false,
      response: jsonResponse({ error: "message is required" }, 400),
    };
  }

  if (!signature || typeof signature !== "string" || signature.trim() === "") {
    console.warn("[signed-msg] validation failed: signature is required");
    return {
      ok: false,
      response: jsonResponse({ error: "signature is required" }, 400),
    };
  }

  // ── Signature verification ──────────────────────────────────────────────────
  const isValid = verifyWalletSignature(
    walletAddress as string,
    message,
    signature,
  );
  if (!isValid) {
    console.warn(
      `[signed-msg] signature verification failed for wallet: ${(walletAddress as string).substring(0, 8)}...`,
    );
    return {
      ok: false,
      response: jsonResponse({ error: "Signature verification failed" }, 401),
    };
  }

  console.log(
    `[signed-msg] signature verified for wallet: ${(walletAddress as string).substring(0, 8)}...`,
  );

  return { ok: true, walletAddress: walletAddress as string };
}

/**
 * Extracts the authenticated wallet address from request headers.
 * Set by enforceWalletApiAuth() in wallet-jwt-middleware.ts.
 *
 * Use this in route handlers after JWT auth has already run.
 */
export function getWalletAddressFromRequest(request: Request): string | null {
  return request.headers.get(WALLET_ADDRESS_HEADER) ?? null;
}

/**
 * Audit log helper — call after any sensitive action.
 */
export function auditLog(
  action: string,
  walletAddress: string,
  details?: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      audit: true,
      action,
      wallet: `${walletAddress.substring(0, 8)}...`,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}
