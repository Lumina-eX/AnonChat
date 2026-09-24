import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getTransactionReceiptsByOperation } from "@/lib/blockchain/transaction-receipts";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const operationId = new URL(request.url).searchParams.get("operationId")?.trim();
  if (!operationId || operationId.length > 64) {
    return NextResponse.json({ error: "operationId query parameter is required" }, { status: 400 });
  }

  try {
    const receipts = await getTransactionReceiptsByOperation(supabase, operationId);
    return NextResponse.json({ receipts });
  } catch (error) {
    console.error("[stellar/receipts] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch transaction receipts" }, { status: 500 });
  }
}