/**
 * GET /api/stellar/transactions/history
 *
 * Retrieves on-chain Stellar transaction history for a connected wallet address.
 *
 * Query Parameters:
 *   - walletAddress: string (required) - Stellar public key (G...)
 *   - cursor: string (optional) - Horizon paging token for pagination
 *   - limit: number (optional, default 15, max 50) - Items per page
 *   - filter: "anonchat" | "all" (optional, default "anonchat") - Transaction filter mode
 *   - order: "asc" | "desc" (optional, default "desc") - Sort order
 */

import { type NextRequest, NextResponse } from "next/server";
import { validateStellarAddress } from "@/lib/auth/validation";
import { fetchWalletTransactionHistory } from "@/lib/blockchain/stellar-history";
import {
  logBlockchainOperation,
  generateCorrelationId,
} from "@/lib/blockchain/logger";

export async function GET(request: NextRequest) {
  const correlationId = generateCorrelationId();
  const { searchParams } = new URL(request.url);

  const walletAddress = searchParams.get("walletAddress");
  const cursor = searchParams.get("cursor") || undefined;
  const limitParam = searchParams.get("limit");
  const filterParam = searchParams.get("filter");
  const orderParam = searchParams.get("order");

  if (!walletAddress) {
    return NextResponse.json(
      { error: "walletAddress query parameter is required" },
      { status: 400 },
    );
  }

  if (!validateStellarAddress(walletAddress)) {
    return NextResponse.json(
      { error: "Invalid Stellar wallet address format" },
      { status: 400 },
    );
  }

  let limit = 15;
  if (limitParam) {
    const parsedLimit = parseInt(limitParam, 10);
    if (!isNaN(parsedLimit) && parsedLimit > 0) {
      limit = Math.min(parsedLimit, 50);
    }
  }

  const filter = filterParam === "all" ? "all" : "anonchat";
  const order = orderParam === "asc" ? "asc" : "desc";

  logBlockchainOperation(
    "info",
    "Processing transaction history request",
    {
      walletAddress,
      limit,
      filter,
      order,
      hasCursor: Boolean(cursor),
    },
    correlationId,
  );

  try {
    const historyResponse = await fetchWalletTransactionHistory(walletAddress, {
      cursor,
      limit,
      filter,
      order,
    });

    return NextResponse.json(historyResponse, { status: 200 });
  } catch (error: any) {
    const status = error?.status || error?.response?.status;
    logBlockchainOperation(
      "error",
      "Failed to handle transaction history request",
      {
        walletAddress,
        error: {
          type: error?.name || "ApiError",
          message: error?.message || "Unknown error",
        },
      },
      correlationId,
    );

    return NextResponse.json(
      {
        error: error?.message || "Failed to retrieve Stellar transaction history",
      },
      { status: status === 429 || status === 503 ? status : 500 },
    );
  }
}
