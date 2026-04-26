/**
 * Escrow Lifecycle Service
 *
 * Abstracts all blockchain interactions for escrow operations away from
 * controllers. Each function follows the pattern:
 *   1. Validate inputs & current escrow state
 *   2. Execute on-chain operation (if required)
 *   3. Persist state change + event log in DB
 *   4. Return a clean EscrowResult
 *
 * Supported lifecycle:
 *   createEscrow → fundEscrow → releaseEscrow
 *                            ↘ refundEscrow
 *                            ↘ disputeEscrow → resolveDispute
 *
 * Design principles:
 *  - All blockchain logic lives here; controllers only call service functions
 *  - Graceful degradation: DB state is always updated even if on-chain fails
 *  - Modular: each lifecycle step is an independent, testable function
 *  - Extensible: dispute resolution can be upgraded to DAO voting later
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { SupabaseClient } from "@supabase/supabase-js";
import { loadStellarConfig, isConfigured, getExplorerUrl } from "./stellar-config";
import { logBlockchainOperation, generateCorrelationId } from "./logger";
import { buildGroupMemo } from "./memo";
import {
  EscrowRecord,
  EscrowResult,
  EscrowStatus,
  EscrowEventType,
  CreateEscrowInput,
  FundEscrowInput,
  ReleaseEscrowInput,
  RefundEscrowInput,
  DisputeEscrowInput,
  ResolveDisputeInput,
} from "@/types/escrow";

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Appends a row to the escrow_events audit log.
 * Non-fatal: errors are logged but do not throw.
 */
async function logEscrowEvent(
  supabase: SupabaseClient,
  escrowId: string,
  eventType: EscrowEventType,
  opts: {
    txHash?: string;
    actorWallet?: string;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const { error } = await supabase.from("escrow_events").insert({
    escrow_id: escrowId,
    event_type: eventType,
    tx_hash: opts.txHash ?? null,
    actor_wallet: opts.actorWallet ?? null,
    metadata: opts.metadata ?? {},
  });

  if (error) {
    console.error(`[EscrowService] Failed to log event '${eventType}' for escrow ${escrowId}:`, error.message);
  }
}

/**
 * Fetches an escrow record by ID. Returns null if not found.
 */
async function fetchEscrow(
  escrowId: string,
  supabase: SupabaseClient
): Promise<EscrowRecord | null> {
  const { data, error } = await supabase
    .from("escrows")
    .select("*")
    .eq("id", escrowId)
    .maybeSingle();

  if (error) {
    logBlockchainOperation("error", "Failed to fetch escrow", {
      escrowId,
      error: { type: "DBError", message: error.message },
    });
    return null;
  }

  return data as EscrowRecord | null;
}

/**
 * Asserts that an escrow is in one of the allowed statuses.
 * Returns an error result if the assertion fails.
 */
function assertStatus(
  escrow: EscrowRecord,
  allowed: EscrowStatus[]
): EscrowResult | null {
  if (!allowed.includes(escrow.status)) {
    return {
      success: false,
      error: `Escrow is in '${escrow.status}' status; expected one of: ${allowed.join(", ")}`,
    };
  }
  return null;
}

/**
 * Submits a Stellar payment transaction.
 * Used for release and refund operations.
 */
async function submitPayment(opts: {
  destinationPublicKey: string;
  amountXlm: string;
  groupId: string;
  memo?: StellarSdk.Memo;
  maxFee?: string | number;
}): Promise<{ success: boolean; txHash?: string; feeCharged?: string; error?: string }> {
  const correlationId = generateCorrelationId();

  if (!isConfigured()) {
    return { success: false, error: "Stellar configuration not available" };
  }

  const config = loadStellarConfig();
  if (!config) {
    return { success: false, error: "Failed to load Stellar configuration" };
  }

  try {
    const server = new StellarSdk.Horizon.Server(config.horizonUrl);
    const sourceKeypair = StellarSdk.Keypair.fromSecret(config.sourceSecret);
    const sourcePublicKey = sourceKeypair.publicKey();

    const account = await Promise.race([
      server.loadAccount(sourcePublicKey),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout loading account")), config.transactionTimeout)
      ),
    ]);

    const feeToUse = opts.maxFee ? opts.maxFee.toString() : StellarSdk.BASE_FEE;

    const builder = new StellarSdk.TransactionBuilder(account, {
      fee: feeToUse,
      networkPassphrase:
        config.network === "testnet"
          ? StellarSdk.Networks.TESTNET
          : StellarSdk.Networks.PUBLIC,
    }).addOperation(
      StellarSdk.Operation.payment({
        destination: opts.destinationPublicKey,
        asset: StellarSdk.Asset.native(),
        amount: opts.amountXlm,
      })
    );

    // Attach memo if provided, otherwise embed group ID
    const memo = opts.memo ?? buildGroupMemo(opts.groupId).memo;
    builder.addMemo(memo);

    const transaction = builder.setTimeout(30).build();
    transaction.sign(sourceKeypair);

    const result = await Promise.race([
      server.submitTransaction(transaction),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Transaction submission timeout")), config.transactionTimeout)
      ),
    ]);

    const feeCharged = (result as any).fee_charged?.toString() ?? feeToUse.toString();

    logBlockchainOperation(
      "info",
      "Payment transaction submitted",
      { groupId: opts.groupId, txHash: result.hash, feeCharged },
      correlationId
    );

    return { success: true, txHash: result.hash, feeCharged };
  } catch (error: any) {
    logBlockchainOperation(
      "error",
      "Payment transaction failed",
      {
        groupId: opts.groupId,
        error: { type: error.name ?? "UnknownError", message: error.message ?? "Unknown" },
      },
      correlationId
    );
    return { success: false, error: error.message ?? "Transaction failed" };
  }
}

// ── Public service functions ──────────────────────────────────────────────────

/**
 * Creates a new escrow record in the DB (status: "pending").
 * No on-chain transaction at this stage — funds are committed in fundEscrow().
 *
 * @param input    - Escrow creation parameters
 * @param supabase - Supabase client (service-role recommended)
 */
export async function createEscrow(
  input: CreateEscrowInput,
  supabase: SupabaseClient
): Promise<EscrowResult> {
  const correlationId = generateCorrelationId();

  // Basic input validation
  if (!input.groupId || !input.initiatorWallet || !input.beneficiaryWallet) {
    return { success: false, error: "groupId, initiatorWallet, and beneficiaryWallet are required" };
  }

  if (input.amountXlm <= 0) {
    return { success: false, error: "amountXlm must be greater than 0" };
  }

  if (input.initiatorWallet === input.beneficiaryWallet) {
    return { success: false, error: "initiatorWallet and beneficiaryWallet must be different" };
  }

  // Validate Stellar addresses
  try {
    StellarSdk.Keypair.fromPublicKey(input.initiatorWallet);
    StellarSdk.Keypair.fromPublicKey(input.beneficiaryWallet);
  } catch {
    return { success: false, error: "Invalid Stellar wallet address" };
  }

  // Verify group exists
  const { data: group, error: groupError } = await supabase
    .from("rooms")
    .select("id")
    .eq("id", input.groupId)
    .maybeSingle();

  if (groupError || !group) {
    return { success: false, error: `Group '${input.groupId}' not found` };
  }

  // Build the memo group ID reference
  const { memoValue } = buildGroupMemo(input.groupId);

  const { data, error } = await supabase
    .from("escrows")
    .insert({
      group_id: input.groupId,
      initiator_wallet: input.initiatorWallet,
      beneficiary_wallet: input.beneficiaryWallet,
      amount_xlm: input.amountXlm,
      asset_code: input.assetCode ?? "XLM",
      asset_issuer: input.assetIssuer ?? null,
      status: "pending" as EscrowStatus,
      memo_group_id: memoValue,
      expires_at: input.expiresAt ?? null,
    })
    .select()
    .single();

  if (error) {
    logBlockchainOperation(
      "error",
      "Failed to create escrow record",
      { groupId: input.groupId, error: { type: "DBError", message: error.message } },
      correlationId
    );
    return { success: false, error: "Failed to create escrow record" };
  }

  const escrow = data as EscrowRecord;

  await logEscrowEvent(supabase, escrow.id, "created", {
    actorWallet: input.initiatorWallet,
    metadata: {
      groupId: input.groupId,
      amountXlm: input.amountXlm,
      beneficiaryWallet: input.beneficiaryWallet,
    },
  });

  logBlockchainOperation(
    "info",
    "Escrow created",
    { escrowId: escrow.id, groupId: input.groupId, amountXlm: input.amountXlm },
    correlationId
  );

  return { success: true, escrow };
}

/**
 * Marks an escrow as funded after the initiator has sent funds on-chain.
 * The caller is responsible for submitting the funding transaction and
 * providing the resulting txHash.
 *
 * Status transition: pending → funded
 *
 * @param input    - Fund escrow parameters (includes the on-chain txHash)
 * @param supabase - Supabase client
 */
export async function fundEscrow(
  input: FundEscrowInput,
  supabase: SupabaseClient
): Promise<EscrowResult> {
  const correlationId = generateCorrelationId();

  const escrow = await fetchEscrow(input.escrowId, supabase);
  if (!escrow) {
    return { success: false, error: `Escrow '${input.escrowId}' not found` };
  }

  const statusError = assertStatus(escrow, ["pending"]);
  if (statusError) return statusError;

  if (escrow.initiator_wallet !== input.actorWallet) {
    return { success: false, error: "Only the escrow initiator can fund it" };
  }

  // Check expiry
  if (escrow.expires_at && new Date(escrow.expires_at) < new Date()) {
    return { success: false, error: "Escrow has expired and cannot be funded" };
  }

  const { data, error } = await supabase
    .from("escrows")
    .update({
      status: "funded" as EscrowStatus,
      fund_tx_hash: input.fundTxHash,
      funded_at: new Date().toISOString(),
    })
    .eq("id", input.escrowId)
    .select()
    .single();

  if (error) {
    return { success: false, error: "Failed to update escrow status" };
  }

  const updated = data as EscrowRecord;

  await logEscrowEvent(supabase, escrow.id, "funded", {
    txHash: input.fundTxHash,
    actorWallet: input.actorWallet,
    metadata: { amountXlm: escrow.amount_xlm },
  });

  logBlockchainOperation(
    "info",
    "Escrow funded",
    { escrowId: escrow.id, txHash: input.fundTxHash },
    correlationId
  );

  return { success: true, escrow: updated, txHash: input.fundTxHash };
}

/**
 * Releases escrowed funds to the beneficiary.
 * Submits a Stellar payment transaction from the service wallet to the beneficiary.
 *
 * Status transition: funded → released
 *
 * @param input    - Release parameters
 * @param supabase - Supabase client
 */
export async function releaseEscrow(
  input: ReleaseEscrowInput,
  supabase: SupabaseClient
): Promise<EscrowResult> {
  const correlationId = generateCorrelationId();

  const escrow = await fetchEscrow(input.escrowId, supabase);
  if (!escrow) {
    return { success: false, error: `Escrow '${input.escrowId}' not found` };
  }

  const statusError = assertStatus(escrow, ["funded"]);
  if (statusError) return statusError;

  // Only the initiator can release (or a resolver in dispute flow)
  if (escrow.initiator_wallet !== input.actorWallet) {
    return { success: false, error: "Only the escrow initiator can release funds" };
  }

  // Submit on-chain payment to beneficiary
  const payment = await submitPayment({
    destinationPublicKey: escrow.beneficiary_wallet,
    amountXlm: escrow.amount_xlm.toFixed(7),
    groupId: escrow.group_id,
    maxFee: input.maxFee,
  });

  if (!payment.success) {
    await logEscrowEvent(supabase, escrow.id, "error", {
      actorWallet: input.actorWallet,
      metadata: { operation: "release", error: payment.error },
    });
    return { success: false, error: payment.error };
  }

  const config = loadStellarConfig();
  const explorerUrl = config && payment.txHash
    ? getExplorerUrl(payment.txHash, config.network)
    : undefined;

  const { data, error } = await supabase
    .from("escrows")
    .update({
      status: "released" as EscrowStatus,
      release_tx_hash: payment.txHash,
      released_at: new Date().toISOString(),
    })
    .eq("id", input.escrowId)
    .select()
    .single();

  if (error) {
    logBlockchainOperation(
      "warn",
      "Escrow released on-chain but DB update failed",
      { escrowId: escrow.id, txHash: payment.txHash, error: { type: "DBError", message: error.message } },
      correlationId
    );
  }

  await logEscrowEvent(supabase, escrow.id, "released", {
    txHash: payment.txHash,
    actorWallet: input.actorWallet,
    metadata: { amountXlm: escrow.amount_xlm, beneficiaryWallet: escrow.beneficiary_wallet },
  });

  logBlockchainOperation(
    "info",
    "Escrow released",
    { escrowId: escrow.id, txHash: payment.txHash, beneficiary: escrow.beneficiary_wallet },
    correlationId
  );

  return {
    success: true,
    escrow: (data ?? escrow) as EscrowRecord,
    txHash: payment.txHash,
    explorerUrl,
    feeCharged: payment.feeCharged,
  };
}

/**
 * Refunds escrowed funds back to the initiator.
 * Submits a Stellar payment transaction from the service wallet to the initiator.
 *
 * Status transition: funded → refunded
 *
 * @param input    - Refund parameters
 * @param supabase - Supabase client
 */
export async function refundEscrow(
  input: RefundEscrowInput,
  supabase: SupabaseClient
): Promise<EscrowResult> {
  const correlationId = generateCorrelationId();

  const escrow = await fetchEscrow(input.escrowId, supabase);
  if (!escrow) {
    return { success: false, error: `Escrow '${input.escrowId}' not found` };
  }

  const statusError = assertStatus(escrow, ["funded"]);
  if (statusError) return statusError;

  // Beneficiary can request a refund, or the initiator can self-refund after expiry
  const isInitiator = escrow.initiator_wallet === input.actorWallet;
  const isBeneficiary = escrow.beneficiary_wallet === input.actorWallet;
  const isExpired = escrow.expires_at ? new Date(escrow.expires_at) < new Date() : false;

  if (!isBeneficiary && !(isInitiator && isExpired)) {
    return {
      success: false,
      error: isInitiator
        ? "Initiator can only self-refund after the escrow has expired"
        : "Only the beneficiary or the initiator (after expiry) can request a refund",
    };
  }

  // Submit on-chain payment back to initiator
  const payment = await submitPayment({
    destinationPublicKey: escrow.initiator_wallet,
    amountXlm: escrow.amount_xlm.toFixed(7),
    groupId: escrow.group_id,
    maxFee: input.maxFee,
  });

  if (!payment.success) {
    await logEscrowEvent(supabase, escrow.id, "error", {
      actorWallet: input.actorWallet,
      metadata: { operation: "refund", error: payment.error },
    });
    return { success: false, error: payment.error };
  }

  const config = loadStellarConfig();
  const explorerUrl = config && payment.txHash
    ? getExplorerUrl(payment.txHash, config.network)
    : undefined;

  const { data, error } = await supabase
    .from("escrows")
    .update({
      status: "refunded" as EscrowStatus,
      refund_tx_hash: payment.txHash,
      refunded_at: new Date().toISOString(),
    })
    .eq("id", input.escrowId)
    .select()
    .single();

  if (error) {
    logBlockchainOperation(
      "warn",
      "Escrow refunded on-chain but DB update failed",
      { escrowId: escrow.id, txHash: payment.txHash, error: { type: "DBError", message: error.message } },
      correlationId
    );
  }

  await logEscrowEvent(supabase, escrow.id, "refunded", {
    txHash: payment.txHash,
    actorWallet: input.actorWallet,
    metadata: { amountXlm: escrow.amount_xlm, initiatorWallet: escrow.initiator_wallet },
  });

  logBlockchainOperation(
    "info",
    "Escrow refunded",
    { escrowId: escrow.id, txHash: payment.txHash, initiator: escrow.initiator_wallet },
    correlationId
  );

  return {
    success: true,
    escrow: (data ?? escrow) as EscrowRecord,
    txHash: payment.txHash,
    explorerUrl,
    feeCharged: payment.feeCharged,
  };
}

/**
 * Raises a dispute on a funded escrow.
 * No on-chain transaction — marks the escrow for manual/DAO resolution.
 *
 * Status transition: funded → disputed
 *
 * @param input    - Dispute parameters
 * @param supabase - Supabase client
 */
export async function disputeEscrow(
  input: DisputeEscrowInput,
  supabase: SupabaseClient
): Promise<EscrowResult> {
  const correlationId = generateCorrelationId();

  const escrow = await fetchEscrow(input.escrowId, supabase);
  if (!escrow) {
    return { success: false, error: `Escrow '${input.escrowId}' not found` };
  }

  const statusError = assertStatus(escrow, ["funded"]);
  if (statusError) return statusError;

  // Either party can raise a dispute
  const isParticipant =
    escrow.initiator_wallet === input.actorWallet ||
    escrow.beneficiary_wallet === input.actorWallet;

  if (!isParticipant) {
    return { success: false, error: "Only escrow participants can raise a dispute" };
  }

  if (!input.reason || input.reason.trim().length === 0) {
    return { success: false, error: "A dispute reason is required" };
  }

  const { data, error } = await supabase
    .from("escrows")
    .update({
      status: "disputed" as EscrowStatus,
      dispute_reason: input.reason.trim(),
      disputed_at: new Date().toISOString(),
    })
    .eq("id", input.escrowId)
    .select()
    .single();

  if (error) {
    return { success: false, error: "Failed to update escrow status" };
  }

  await logEscrowEvent(supabase, escrow.id, "disputed", {
    actorWallet: input.actorWallet,
    metadata: { reason: input.reason },
  });

  logBlockchainOperation(
    "info",
    "Escrow disputed",
    { escrowId: escrow.id, actorWallet: input.actorWallet },
    correlationId
  );

  return { success: true, escrow: data as EscrowRecord };
}

/**
 * Resolves a disputed escrow by releasing funds to either party.
 * Submits the appropriate on-chain payment based on the resolver's decision.
 *
 * Status transition: disputed → resolved
 *
 * Extensibility note: the resolverUserId can be replaced with a DAO vote
 * result or multi-sig approval in future iterations.
 *
 * @param input    - Resolution parameters
 * @param supabase - Supabase client
 */
export async function resolveDispute(
  input: ResolveDisputeInput,
  supabase: SupabaseClient
): Promise<EscrowResult> {
  const correlationId = generateCorrelationId();

  const escrow = await fetchEscrow(input.escrowId, supabase);
  if (!escrow) {
    return { success: false, error: `Escrow '${input.escrowId}' not found` };
  }

  const statusError = assertStatus(escrow, ["disputed"]);
  if (statusError) return statusError;

  // Determine destination based on resolution decision
  const destinationWallet = input.releaseToInitiator
    ? escrow.initiator_wallet
    : escrow.beneficiary_wallet;

  const payment = await submitPayment({
    destinationPublicKey: destinationWallet,
    amountXlm: escrow.amount_xlm.toFixed(7),
    groupId: escrow.group_id,
    maxFee: input.maxFee,
  });

  if (!payment.success) {
    await logEscrowEvent(supabase, escrow.id, "error", {
      metadata: { operation: "resolve", error: payment.error },
    });
    return { success: false, error: payment.error };
  }

  const config = loadStellarConfig();
  const explorerUrl = config && payment.txHash
    ? getExplorerUrl(payment.txHash, config.network)
    : undefined;

  // Determine final status based on where funds went
  const finalStatus: EscrowStatus = input.releaseToInitiator ? "refunded" : "released";
  const txField = input.releaseToInitiator ? "refund_tx_hash" : "release_tx_hash";
  const timestampField = input.releaseToInitiator ? "refunded_at" : "released_at";

  const { data, error } = await supabase
    .from("escrows")
    .update({
      status: "resolved" as EscrowStatus,
      [txField]: payment.txHash,
      [timestampField]: new Date().toISOString(),
      resolved_by: input.resolverUserId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", input.escrowId)
    .select()
    .single();

  if (error) {
    logBlockchainOperation(
      "warn",
      "Dispute resolved on-chain but DB update failed",
      { escrowId: escrow.id, txHash: payment.txHash, error: { type: "DBError", message: error.message } },
      correlationId
    );
  }

  await logEscrowEvent(supabase, escrow.id, "resolved", {
    txHash: payment.txHash,
    metadata: {
      resolverUserId: input.resolverUserId,
      releaseToInitiator: input.releaseToInitiator,
      destinationWallet,
    },
  });

  logBlockchainOperation(
    "info",
    "Dispute resolved",
    {
      escrowId: escrow.id,
      txHash: payment.txHash,
      destinationWallet,
      finalStatus,
    },
    correlationId
  );

  return {
    success: true,
    escrow: (data ?? escrow) as EscrowRecord,
    txHash: payment.txHash,
    explorerUrl,
    feeCharged: payment.feeCharged,
  };
}

/**
 * Retrieves a single escrow record by ID.
 *
 * @param escrowId - UUID of the escrow
 * @param supabase - Supabase client
 */
export async function getEscrow(
  escrowId: string,
  supabase: SupabaseClient
): Promise<EscrowResult> {
  const escrow = await fetchEscrow(escrowId, supabase);
  if (!escrow) {
    return { success: false, error: `Escrow '${escrowId}' not found` };
  }
  return { success: true, escrow };
}

/**
 * Lists all escrows for a given group, ordered by creation date (newest first).
 *
 * @param groupId  - The room/group ID
 * @param supabase - Supabase client
 */
export async function listEscrowsByGroup(
  groupId: string,
  supabase: SupabaseClient
): Promise<EscrowRecord[]> {
  const { data, error } = await supabase
    .from("escrows")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (error) {
    logBlockchainOperation("error", "Failed to list escrows by group", {
      groupId,
      error: { type: "DBError", message: error.message },
    });
    return [];
  }

  return (data ?? []) as EscrowRecord[];
}

/**
 * Lists all escrows where the given wallet is either initiator or beneficiary.
 *
 * @param walletAddress - Stellar public key
 * @param supabase      - Supabase client
 */
export async function listEscrowsByWallet(
  walletAddress: string,
  supabase: SupabaseClient
): Promise<EscrowRecord[]> {
  const { data, error } = await supabase
    .from("escrows")
    .select("*")
    .or(`initiator_wallet.eq.${walletAddress},beneficiary_wallet.eq.${walletAddress}`)
    .order("created_at", { ascending: false });

  if (error) {
    logBlockchainOperation("error", "Failed to list escrows by wallet", {
      error: { type: "DBError", message: error.message },
    });
    return [];
  }

  return (data ?? []) as EscrowRecord[];
}

/**
 * Retrieves the full event history for an escrow.
 *
 * @param escrowId - UUID of the escrow
 * @param supabase - Supabase client
 */
export async function getEscrowEvents(
  escrowId: string,
  supabase: SupabaseClient
) {
  const { data, error } = await supabase
    .from("escrow_events")
    .select("*")
    .eq("escrow_id", escrowId)
    .order("created_at", { ascending: true });

  if (error) {
    logBlockchainOperation("error", "Failed to fetch escrow events", {
      escrowId,
      error: { type: "DBError", message: error.message },
    });
    return [];
  }

  return data ?? [];
}
