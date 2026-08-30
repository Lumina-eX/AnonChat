/**
 * POST /api/auth/verify-ownership
 *
 * Proves wallet ownership for group actions without performing the action itself.
 * Clients call this before attempting sensitive operations to ensure the wallet
 * proof is valid, avoiding unnecessary retries on the action endpoint.
 *
 * Flow:
 *  1. Client requests a nonce via GET /api/auth/nonce  (or POST with { walletAddress })
 *  2. Client signs the nonce with their wallet's private key
 *  3. Client sends { walletAddress, signature, groupId?, action? } to this endpoint
 *  4. Server consumes the nonce (one-time use, 5-min TTL), verifies the signature
 *  5. Server records the verification attempt in the audit trail
 *  6. Returns { verified: true, walletAddress, verifiedAt } or an error
 *
 * Request body:
 * {
 *   walletAddress: string   // Stellar public key (56 chars, starts with G)
 *   signature: string       // Hex-encoded Ed25519 signature of the nonce
 *   groupId?: string        // Optional: group context for audit trail
 *   action?: string         // Optional: intended action for audit trail
 * }
 *
 * Response (200):
 * {
 *   verified: true,
 *   walletAddress: string,
 *   verifiedAt: string,     // ISO-8601 timestamp
 *   auditEventId?: string   // ID of the audit record (when groupId is provided)
 * }
 */

import { type NextRequest, NextResponse } from "next/server";
import { validateWalletAddressWithMessage } from "@/lib/auth/validation";
import {
  consumeNonce,
  verifyWalletSignature,
  generateNonce,
} from "@/lib/auth/stellar-verify";
import { recordGroupAuditEvent } from "@/lib/blockchain/audit";
import { createClient } from "@/lib/supabase/server";

type VerifyOwnershipBody = {
  walletAddress?: string;
  signature?: string;
  groupId?: string;
  action?: string;
  /** When true, generates a new nonce inline instead of requiring a separate call */
  generateNonce?: boolean;
};

export async function POST(request: NextRequest) {
  try {
    const body: VerifyOwnershipBody = await request.json().catch(() => ({}));
    const {
      walletAddress,
      signature,
      groupId,
      action = "verify_ownership",
      generateNonce: shouldGenerateNonce,
    } = body;

    // ── 1. Validate wallet address ──────────────────────────────────────────
    const walletError = validateWalletAddressWithMessage(
      walletAddress as string,
    );
    if (walletError) {
      console.warn(
        `[verify-ownership] validation failed: ${walletError}`,
      );
      return NextResponse.json({ error: walletError }, { status: 400 });
    }

    const address = walletAddress as string;

    // ── 2. Handle inline nonce generation ───────────────────────────────────
    if (shouldGenerateNonce) {
      const nonce = await generateNonce(address);
      console.log(
        `[verify-ownership] generated inline nonce for ${address.substring(0, 8)}...`,
      );
      return NextResponse.json({
        nonce,
        message: "Nonce generated. Sign this nonce with your wallet and resend with the signature.",
      });
    }

    // ── 3. Validate signature ──────────────────────────────────────────────
    if (
      !signature ||
      typeof signature !== "string" ||
      signature.trim() === ""
    ) {
      console.warn(
        `[verify-ownership] validation failed: signature is required`,
      );
      return NextResponse.json(
        { error: "signature is required" },
        { status: 400 },
      );
    }

    // ── 4. Consume the nonce (one-time use, 5-min TTL) ────────────────────
    const nonce = await consumeNonce(address);
    if (!nonce) {
      console.warn(
        `[verify-ownership] nonce missing or expired for ${address.substring(0, 8)}...`,
      );

      // Log failed attempt to audit trail when groupId is provided
      if (groupId) {
        const supabase = await createClient();
        await recordGroupAuditEvent({
          supabase,
          groupId,
          eventType: "wallet_verification_failed",
          metadata: {
            action,
            reason: "Nonce not found or expired. Request a new nonce first.",
            walletAddress: address,
          },
        }).catch((e) =>
          console.warn("[verify-ownership] failed to record audit event:", e),
        );
      }

      return NextResponse.json(
        {
          verified: false,
          error:
            "Nonce not found or expired. Request a new nonce first.",
        },
        { status: 401 },
      );
    }

    // ── 5. Verify the Ed25519 signature ─────────────────────────────────────
    const isValid = verifyWalletSignature(address, nonce, signature);
    if (!isValid) {
      console.warn(
        `[verify-ownership] signature verification failed for ${address.substring(0, 8)}...`,
      );

      // Log failed attempt to audit trail when groupId is provided
      if (groupId) {
        const supabase = await createClient();
        await recordGroupAuditEvent({
          supabase,
          groupId,
          eventType: "wallet_verification_failed",
          metadata: {
            action,
            reason:
              "Signature verification failed. Wallet ownership could not be proved.",
            walletAddress: address,
          },
        }).catch((e) =>
          console.warn("[verify-ownership] failed to record audit event:", e),
        );
      }

      return NextResponse.json(
        {
          verified: false,
          error:
            "Signature verification failed. Wallet ownership could not be proved.",
        },
        { status: 401 },
      );
    }

    // ── 6. Log successful verification to audit trail ───────────────────────
    const verifiedAt = new Date().toISOString();
    let auditEventId: string | null = null;

    if (groupId) {
      const supabase = await createClient();
      const auditEvent = await recordGroupAuditEvent({
        supabase,
        groupId,
        eventType: "wallet_verified",
        metadata: {
          action,
          verifiedAt,
          walletAddress: address,
        },
      }).catch((e) => {
        console.warn(
          "[verify-ownership] failed to record audit event:",
          e,
        );
        return null;
      });

      auditEventId = auditEvent?.eventId ?? null;
    }

    console.log(
      `[verify-ownership] wallet ownership proved for ${address.substring(0, 8)}... (action: ${action})`,
    );

    return NextResponse.json(
      {
        verified: true,
        walletAddress: address,
        verifiedAt,
        ...(auditEventId ? { auditEventId } : {}),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[verify-ownership] POST error:", err);
    return NextResponse.json(
      { error: "Failed to verify wallet ownership" },
      { status: 500 },
    );
  }
}