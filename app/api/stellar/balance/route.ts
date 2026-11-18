/**
 * GET /api/stellar/balance
 *
 * Retrieves Horizon balances for a connected wallet and checks that XLM
 * covers the required fee before a transaction is submitted.
 *
 * Query parameters:
 *   - walletId: string (required) - Stellar public key (G...)
 *   - requiredFee: string (required) - XLM fee that must be covered
 *   - operationAmount: string (optional) - additional amount that must be covered
 *   - operationAsset: string (optional) - non-XLM asset for operationAmount; fees still use XLM
 */

import { type NextRequest, NextResponse } from "next/server";
import { isValidStellarAddress } from "@/lib/utils/stellar-address";
import { verifyWalletBalance } from "@/lib/blockchain/wallet-balance";

const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,7}))?$/;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const walletId = searchParams.get("walletId");
  const requiredFee = searchParams.get("requiredFee");
  const operationAmount = searchParams.get("operationAmount") || undefined;
  const operationAsset = searchParams.get("operationAsset") || undefined;

  if (!walletId) {
    return NextResponse.json({ error: "walletId query parameter is required" }, { status: 400 });
  }

  if (!isValidStellarAddress(walletId)) {
    return NextResponse.json({ error: "Invalid Stellar wallet address" }, { status: 400 });
  }

  if (!requiredFee || !AMOUNT_PATTERN.test(requiredFee)) {
    return NextResponse.json(
      { error: "requiredFee must be a non-negative XLM amount" },
      { status: 400 },
    );
  }

  if (operationAmount && !AMOUNT_PATTERN.test(operationAmount)) {
    return NextResponse.json(
      { error: "operationAmount must be a non-negative XLM amount" },
      { status: 400 },
    );
  }

  const result = await verifyWalletBalance({
    walletId,
    requiredFee,
    operationAmount,
    operationAsset,
  });

  const status = result.status === "ok" ? 200 : result.status === "insufficient_funds" ? 402 : 503;
  return NextResponse.json(result, { status });
}
