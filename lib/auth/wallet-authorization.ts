/**
 * Reusable wallet authorization for sensitive API actions.
 *
 * Combines one-time nonce consumption with Ed25519 signature verification
 * to prove wallet ownership before destructive or privileged operations.
 *
 * Usage:
 *   const auth = await verifyWalletAuthorization({ walletAddress, signature }, "delete_group");
 *   if (!auth.ok) return auth.response;
 *   // auth.walletAddress and auth.nonce are available
 */

import { NextResponse } from "next/server";
import { consumeNonce, verifyWalletSignature } from "@/lib/auth/stellar-verify";
import { validateWalletAddressWithMessage } from "@/lib/auth/validation";
import { recordGroupAuditEvent } from "@/lib/blockchain/audit";

export type WalletAuthorizationResult =
  | { ok: true; walletAddress: string; nonce: string }
  | { ok: false; response: NextResponse };

export interface WalletAuthPayload {
  walletAddress?: string;
  signature?: string;
}

export interface WalletAuditContext {
  supabase: any;
  groupId?: string;
}

/**
 * Verifies wallet authorization via nonce + signature.
 * Returns standardized error responses for invalid or missing signatures.
 *
 * When `auditContext` is provided, every verification attempt (success or
 * failure) is recorded to the `group_audit_events` audit trail for
 * accountability and debugging.
 */
export async function verifyWalletAuthorization(
  payload: WalletAuthPayload,
  action?: string,
  auditContext?: WalletAuditContext,
): Promise<WalletAuthorizationResult> {
  const { walletAddress, signature } = payload;
  const logPrefix = action ? `[${action}]` : "[wallet-auth]";
  const address = walletAddress as string;

  const recordAudit = async (
    eventType: "wallet_verified" | "wallet_verification_failed",
    reason?: string,
  ) => {
    if (!auditContext?.groupId) return;

    await recordGroupAuditEvent({
      supabase: auditContext.supabase,
      groupId: auditContext.groupId,
      eventType,
      metadata: {
        action: action ?? "wallet_auth",
        walletAddress: address,
        ...(reason ? { reason } : {}),
        verifiedAt: new Date().toISOString(),
      },
    }).catch((e) =>
      console.warn(
        `${logPrefix} failed to record wallet verification audit event:`,
        e,
      ),
    );
  };

  const walletError = validateWalletAddressWithMessage(address);
  if (walletError) {
    console.warn(`${logPrefix} validation failed: ${walletError}`);
    await recordAudit("wallet_verification_failed", walletError);
    return {
      ok: false,
      response: NextResponse.json({ error: walletError }, { status: 400 }),
    };
  }

  if (!signature || typeof signature !== "string" || signature.trim() === "") {
    console.warn(`${logPrefix} validation failed: signature is required`);
    await recordAudit("wallet_verification_failed", "signature is required");
    return {
      ok: false,
      response: NextResponse.json({ error: "signature is required" }, { status: 400 }),
    };
  }

  const nonce = await consumeNonce(address);
  if (!nonce) {
    console.warn(
      `${logPrefix} nonce missing or expired for wallet: ${address.substring(0, 8)}...`,
    );
    await recordAudit(
      "wallet_verification_failed",
      "Nonce not found or expired. Request a new nonce first.",
    );
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Nonce not found or expired. Request a new nonce first." },
        { status: 401 },
      ),
    };
  }

  const isValid = verifyWalletSignature(address, nonce, signature);
  if (!isValid) {
    console.warn(
      `${logPrefix} signature verification failed for wallet: ${address.substring(0, 8)}...`,
    );
    await recordAudit(
      "wallet_verification_failed",
      "Signature verification failed. Wallet ownership could not be proved.",
    );
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Signature verification failed. Wallet ownership could not be proved.",
        },
        { status: 401 },
      ),
    };
  }

  console.log(
    `${logPrefix} wallet authorized: ${address.substring(0, 8)}...`,
  );

  await recordAudit("wallet_verified");

  return { ok: true, walletAddress: address, nonce };
}

/**
 * Resolves a wallet address from a Supabase user and optional profile row.
 */
export function resolveWalletFromUser(
  user: { email?: string | null },
  profile?: { wallet_address?: string | null } | null,
): string | null {
  if (profile?.wallet_address) {
    return profile.wallet_address;
  }

  if (user.email?.endsWith("@wallet.anonchat.local")) {
    return user.email.replace("@wallet.anonchat.local", "");
  }

  return null;
}

/**
 * Ensures the authenticated wallet matches the session user's wallet.
 */
export function ensureWalletMatchesUser(
  walletAddress: string,
  userWallet: string | null,
): NextResponse | null {
  if (!userWallet) {
    return NextResponse.json(
      { error: "Could not determine caller wallet address" },
      { status: 400 },
    );
  }

  if (walletAddress !== userWallet) {
    return NextResponse.json(
      { error: "Wallet address does not match authenticated user" },
      { status: 403 },
    );
  }

  return null;
}
