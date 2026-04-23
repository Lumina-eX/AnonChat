import { NextResponse } from "next/server";
import { Horizon } from "@stellar/stellar-sdk";
import { loadStellarConfig, isConfigured } from "@/lib/blockchain/stellar-config";

export async function GET() {
  try {
    if (!isConfigured()) {
      return NextResponse.json(
        { error: "Stellar configuration not available" },
        { status: 503 }
      );
    }

    const config = loadStellarConfig();
    if (!config) {
      return NextResponse.json(
        { error: "Failed to load Stellar configuration" },
        { status: 500 }
      );
    }

    const server = new Horizon.Server(config.horizonUrl);
    
    // Fetch fee stats from the network
    const feeStats = await server.feeStats();
    
    // Use the 50th percentile of fee charged in the last 5 ledgers (or a reasonable default)
    // as our baseline for a reliable transaction, adding a small buffer if needed.
    const estimatedFee = feeStats.fee_charged.p50 || feeStats.last_ledger_base_fee;

    return NextResponse.json({
      estimatedFee,
      lastLedgerBaseFee: feeStats.last_ledger_base_fee,
      network: config.network
    });
  } catch (error) {
    console.error("[v0] GET /api/stellar/fee error:", error);
    return NextResponse.json(
      { error: "Failed to fetch Stellar network fee" },
      { status: 500 }
    );
  }
}
