/**
 * Reusable wallet authorization for sensitive API actions.
 *
 * Combines one-time nonce consumption with Edd25519 signature verification
 * to prove wallet ownership before destructive or privileged operations.
 *
 * Supports Stellar SEP-10 challenge-transaction authentication in addition
 * to the legacy nonce+signature flow. When a SEP-10 challenge is supplied,
 * the full challenge is validated (server signature, expiration, network,
 * replay protection, wallet signature) and the authenticated account is
 * bound to the expected wallet address.
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
import {
  validateSep10Challenge,
  type Sep10ValidationOptions,
} from "@/lib/auth/sep10";

export type WalletAuthorizationResult =
  | { ok: true; walletAddress: string; nonce: string }
  | { ok: false; response: NextResponse };

export interface WalletAuthPayload {
  walletAddress?: string;
  signature?: string;
  /** SEP-10 challenge transaction XML (signed by the wallet). */
  challenge?: string;
  /** Optional explicit nonce for the legacy flow. */
  nonce?: string;
}

export interface WalletAuditContext {
  supabase: any;
  groupId?: string;
  /** Optional SEP-10 validation options (server account, netword, home domain). */
  sep10?: Sep10ValidationOptions;
}

/**
 * Verifies wallet authorization via nonce + signature or a SEP-10
 * challenge transaction. Returns standardized error responses for invalid
 * or missing signatures.
 *
 * When auditContext is provided, every verification attempt (success or
 * failure) is recorded to the group_audit_events audit trail for accountability
 * and debugging.
 */
export async function verifyWalletAuthorization(
  payload: WalletAuthPayload,
  action?: string,
  auditContext?: WalletAuditContext,
): Promise<WalletAuthorizationResult> {
  const { walletAddress, signature, challenge } = payload;
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
        method: challenge ? "sep10" : "nonce",
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
    console.warn("${logPrefix} validation failed: ${walletError}");
    await recordAudit("wallet_verification_failed", walletError);
    return {
      ok: false,
      response: NextResponse.json({ error: walletError }, { status: 400 }),
    };
  }

  // SEP-10 challenge flow: validate the full challenge transaction.
  if (challenge !== undefined) {
    if (typeof challenge !== "string" || challenge.trim() === "") {
      console.warn(`${logPrefix} validation failed: challenge is required`);
      await recordAudit("wallet_verification_failed", "challenge is required");
      return {
        ok: false,
        response: NextResponse.json(
          { error: "challenge is required" },
          { status: 400 },
        ),
      };
    }

    const sep10Result = validateSep10Challenge(challenge, {
      ...(auditContext?.sep10 ?? {}),
      expectedAccount: address,
    });

    if (!sep10Result.ok) {
      console.warn(
        `${logPrefix} SEP-10 challenge validation failed: ${sep10Result.reason}`,
      );
      await recordAudit("wallet_verification_failed", sep10Result.reason);
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Challenge verification failed." },
          { status: 401 },
        ),
      };
    }

    if (sep10Result.account !== address) {
      console.warn(
        `${logPrefix} SEP-10 account mismatch: ${sep10Result.account.substring(0, 8)}... != ${address.substring(0, 8)}...`,
      );
      await recordAudit(
        "wallet_verification_failed",
        "Challenge account does not match wallet address",
      );
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Wallet address does not match authenticated account" },
          { status: 403 },
        ),
      };
    }

    console.log(`${logPrefix} wallet authorized via SEP-10: ${address.substring(0, 8)}...`);
    await recordAudit("wallet_verified");
    return { ok: true, walletAddress: address, nonce: sep10Result.nonce };
  }

  // Legacy nonce + signature flow.
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
