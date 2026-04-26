/**
 * POST /api/escrow
 * Creates a new escrow record (status: pending).
 *
 * Body: {
 *   groupId: string,
 *   beneficiaryWallet: string,
 *   amountXlm: number,
 *   assetCode?: string,
 *   expiresAt?: string  // ISO-8601
 * }
 *
 * GET /api/escrow?groupId=<id>
 * Lists all escrows for a group.
 *
 * GET /api/escrow?wallet=<address>
 * Lists all escrows where the wallet is initiator or beneficiary.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createEscrow,
  listEscrowsByGroup,
  listEscrowsByWallet,
} from "@/lib/blockchain/escrow-service";
import { validateStellarAddress } from "@/lib/auth/validation";

// ── POST — create escrow ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { groupId, beneficiaryWallet, amountXlm, assetCode, expiresAt } = body as {
      groupId?: string;
      beneficiaryWallet?: string;
      amountXlm?: number;
      assetCode?: string;
      expiresAt?: string;
    };

    // Resolve initiator wallet from user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("wallet_address")
      .eq("id", user.id)
      .maybeSingle();

    const initiatorWallet = profile?.wallet_address as string | undefined;

    if (!initiatorWallet) {
      return NextResponse.json(
        { error: "No wallet address found for your account" },
        { status: 400 }
      );
    }

    // Input validation
    if (!groupId) {
      return NextResponse.json({ error: "groupId is required" }, { status: 400 });
    }

    if (!beneficiaryWallet || !validateStellarAddress(beneficiaryWallet)) {
      return NextResponse.json(
        { error: "beneficiaryWallet must be a valid Stellar address" },
        { status: 400 }
      );
    }

    if (!amountXlm || typeof amountXlm !== "number" || amountXlm <= 0) {
      return NextResponse.json(
        { error: "amountXlm must be a positive number" },
        { status: 400 }
      );
    }

    if (expiresAt && isNaN(Date.parse(expiresAt))) {
      return NextResponse.json(
        { error: "expiresAt must be a valid ISO-8601 datetime" },
        { status: 400 }
      );
    }

    const result = await createEscrow(
      {
        groupId,
        initiatorWallet,
        beneficiaryWallet,
        amountXlm,
        assetCode,
        expiresAt,
      },
      supabase
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ escrow: result.escrow }, { status: 201 });
  } catch (error) {
    console.error("[escrow] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── GET — list escrows ────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const groupId = searchParams.get("groupId");
    const wallet = searchParams.get("wallet");

    if (!groupId && !wallet) {
      return NextResponse.json(
        { error: "Provide either groupId or wallet query parameter" },
        { status: 400 }
      );
    }

    if (groupId) {
      const escrows = await listEscrowsByGroup(groupId, supabase);
      return NextResponse.json({ escrows });
    }

    if (wallet) {
      if (!validateStellarAddress(wallet)) {
        return NextResponse.json(
          { error: "wallet must be a valid Stellar address" },
          { status: 400 }
        );
      }
      const escrows = await listEscrowsByWallet(wallet, supabase);
      return NextResponse.json({ escrows });
    }
  } catch (error) {
    console.error("[escrow] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
