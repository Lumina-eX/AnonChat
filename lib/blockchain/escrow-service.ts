/**
 * Escrow Lifecycle Service
 *
 * Abstracts all blockchain interactions for escrow operations behind a clean,
 * controller-friendly API.  Controllers never touch the Stellar SDK directly;
 * they call this service and receive typed result objects.
 *
 * Lifecycle:
 *   createEscrow  → status: "pending"
 *   fundEscrow    → status: "funded"   (depositor submits signed XDR)
 *   releaseEscrow → status: "released" (beneficiary or arbitrator)
 *   refundEscrow  → status: "refunded" (depositor, or after expiry)
 *   disputeEscrow → status: "disputed" (either party)
 *   resolveDispute→ status: "resolved" (arbitrator only)
 *
 * Design principles:
 *  - All blockchain calls are wrapped in try/catch; errors surface as typed
 *    EscrowServiceError values rather than thrown exceptions.
 *  - The service is stateless; persistence is delegated to the Supabase client
 *    passed in by the caller (dependency injection → easy to test/mock).
 *  - Blockchain submission is non-blocking where possible (graceful degradation).
 *  - Every operation is logged with a correlation ID.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  CreateEscrowParams,
  FundEscrowParams,
  ReleaseEscrowParams,
  RefundEscrowParams,
  DisputeEscrowParams,
  ResolveDisputeParams,
  EscrowRecord,
  EscrowOperationResult,
  EscrowServiceError,
} from "@/types/escrow";
import { loadStellarConfig, isConfigured, getExplorerUrl } from "./stellar-config";
import { logBlockchainOperation, generateCorrelationId } from "./logger";
import { buildGroupMemo } from "./memo-service";

// ── Internal helpers ──────────────────────────────────────────────────────────

function serviceError(
  code: EscrowServiceError["code"],
  message: string
): EscrowOperationResult {
  return { success: false, error: `[${code}] ${message}` };
}

/** Maps a raw Supabase row to a typed EscrowRecord */
function rowToRecord(row: any): EscrowRecord {
  return {
    id: row.id,
    groupId: row.group_id,
    status: row.status,
    parties: {
      depositor: row.depositor,
      beneficiary: row.beneficiary,
      arbitrator: row.arbitrator ?? undefined,
    },
    conditions: {
      amount: row.amount,
      asset: row.asset ?? "XLM",
      expiresAt: row.expires_at ?? undefined,
      memo: row.memo_value ?? undefined,
    },
    fundingTxHash: row.funding_tx_hash ?? null,
    settlementTxHash: row.settlement_tx_hash ?? null,
    memoValue: row.memo_value ?? null,
    disputeReason: row.dispute_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── EscrowService class ───────────────────────────────────────────────────────

export class EscrowService {
  constructor(private readonly supabase: SupabaseClient) {}

  // ── 1. Create ───────────────────────────────────────────────────────────────

  /**
   * Creates a new escrow record in the database (status: "pending").
   * No blockchain transaction is submitted at this stage.
   *
   * @param params - CreateEscrowParams
   */
  async createEscrow(params: CreateEscrowParams): Promise<EscrowOperationResult> {
    const correlationId = generateCorrelationId();
    const { groupId, parties, conditions } = params;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!groupId) return serviceError("VALIDATION_ERROR", "groupId is required");
    if (!parties.depositor) return serviceError("VALIDATION_ERROR", "depositor is required");
    if (!parties.beneficiary) return serviceError("VALIDATION_ERROR", "beneficiary is required");
    if (parties.depositor === parties.beneficiary) {
      return serviceError("VALIDATION_ERROR", "depositor and beneficiary must be different");
    }
    if (!conditions.amount || isNaN(parseFloat(conditions.amount))) {
      return serviceError("VALIDATION_ERROR", "amount must be a valid numeric string");
    }
    if (parseFloat(conditions.amount) <= 0) {
      return serviceError("VALIDATION_ERROR", "amount must be greater than zero");
    }

    // Validate Stellar public keys
    for (const [label, key] of [
      ["depositor", parties.depositor],
      ["beneficiary", parties.beneficiary],
      ...(parties.arbitrator ? [["arbitrator", parties.arbitrator]] : []),
    ] as [string, string][]) {
      try {
        StellarSdk.Keypair.fromPublicKey(key);
      } catch {
        return serviceError("VALIDATION_ERROR", `${label} is not a valid Stellar public key`);
      }
    }

    // Derive memo value for this group
    const { memoValue } = buildGroupMemo(groupId);

    logBlockchainOperation(
      "info",
      "Creating escrow record",
      { groupId, depositor: parties.depositor, amount: conditions.amount },
      correlationId
    );

    const { data, error } = await this.supabase
      .from("escrows")
      .insert({
        group_id: groupId,
        depositor: parties.depositor,
        beneficiary: parties.beneficiary,
        arbitrator: parties.arbitrator ?? null,
        amount: conditions.amount,
        asset: conditions.asset ?? "XLM",
        expires_at: conditions.expiresAt ?? null,
        memo_value: memoValue,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      logBlockchainOperation(
        "error",
        "Failed to insert escrow record",
        { groupId, error: { type: "DBError", message: error.message } },
        correlationId
      );
      return serviceError("BLOCKCHAIN_ERROR", error.message);
    }

    return { success: true, escrow: rowToRecord(data) };
  }

  // ── 2. Fund ─────────────────────────────────────────────────────────────────

  /**
   * Processes a signed XDR envelope from the depositor and submits it to
   * the Stellar network.  On success the escrow status moves to "funded".
   *
   * The caller is responsible for building and signing the transaction
   * (typically done client-side with the wallet kit).  This service only
   * submits and records the result.
   *
   * @param params - FundEscrowParams
   */
  async fundEscrow(params: FundEscrowParams): Promise<EscrowOperationResult> {
    const correlationId = generateCorrelationId();
    const { escrowId, signedXdr } = params;

    if (!signedXdr) return serviceError("VALIDATION_ERROR", "signedXdr is required");

    // Load escrow record
    const escrow = await this._loadEscrow(escrowId);
    if (!escrow) return serviceError("NOT_FOUND", `Escrow ${escrowId} not found`);
    if (escrow.status !== "pending") {
      return serviceError(
        "INVALID_STATUS",
        `Cannot fund escrow in status "${escrow.status}". Expected "pending".`
      );
    }

    if (!isConfigured()) {
      return serviceError("CONFIG_MISSING", "Stellar configuration not available");
    }

    const config = loadStellarConfig();
    if (!config) return serviceError("CONFIG_MISSING", "Failed to load Stellar configuration");

    logBlockchainOperation(
      "info",
      "Submitting funding transaction",
      { escrowId, groupId: escrow.groupId },
      correlationId
    );

    try {
      const server = new StellarSdk.Horizon.Server(config.horizonUrl);
      const tx = StellarSdk.TransactionBuilder.fromXDR(
        signedXdr,
        config.network === "testnet"
          ? StellarSdk.Networks.TESTNET
          : StellarSdk.Networks.PUBLIC
      );

      const result = await Promise.race([
        server.submitTransaction(tx),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Transaction submission timeout")),
            config.transactionTimeout
          )
        ),
      ]);

      // Persist funding tx hash and update status
      const { data, error } = await this.supabase
        .from("escrows")
        .update({ status: "funded", funding_tx_hash: result.hash })
        .eq("id", escrowId)
        .select()
        .single();

      if (error) {
        logBlockchainOperation(
          "error",
          "Escrow funded on-chain but DB update failed",
          { escrowId, transactionHash: result.hash, error: { type: "DBError", message: error.message } },
          correlationId
        );
        return serviceError("BLOCKCHAIN_ERROR", "On-chain success but DB update failed: " + error.message);
      }

      logBlockchainOperation(
        "info",
        "Escrow funded successfully",
        { escrowId, transactionHash: result.hash },
        correlationId
      );

      return {
        success: true,
        escrow: rowToRecord(data),
        transactionHash: result.hash,
        explorerUrl: getExplorerUrl(result.hash, config.network),
      };
    } catch (err: any) {
      logBlockchainOperation(
        "error",
        "Funding transaction failed",
        { escrowId, error: { type: err.name, message: err.message } },
        correlationId
      );
      return serviceError("BLOCKCHAIN_ERROR", err.message ?? "Transaction failed");
    }
  }

  // ── 3. Release ──────────────────────────────────────────────────────────────

  /**
   * Releases escrowed funds to the beneficiary.
   * Caller must be the beneficiary or the arbitrator.
   *
   * In this implementation the service submits a server-side payment from
   * the escrow account (source secret) to the beneficiary.  For a true
   * multi-sig escrow the XDR would be built here and returned for signing.
   *
   * @param params - ReleaseEscrowParams
   */
  async releaseEscrow(params: ReleaseEscrowParams): Promise<EscrowOperationResult> {
    const correlationId = generateCorrelationId();
    const { escrowId, callerPublicKey } = params;

    const escrow = await this._loadEscrow(escrowId);
    if (!escrow) return serviceError("NOT_FOUND", `Escrow ${escrowId} not found`);

    if (escrow.status !== "funded") {
      return serviceError(
        "INVALID_STATUS",
        `Cannot release escrow in status "${escrow.status}". Expected "funded".`
      );
    }

    // Authorization: beneficiary or arbitrator
    const isAuthorized =
      callerPublicKey === escrow.parties.beneficiary ||
      callerPublicKey === escrow.parties.arbitrator;

    if (!isAuthorized) {
      return serviceError(
        "UNAUTHORIZED",
        "Only the beneficiary or arbitrator may release funds"
      );
    }

    const txResult = await this._submitSettlementPayment(
      escrow.parties.beneficiary,
      escrow.conditions.amount,
      escrow.conditions.asset ?? "XLM",
      escrow.groupId,
      correlationId
    );

    if (!txResult.success) {
      return serviceError("BLOCKCHAIN_ERROR", txResult.error ?? "Settlement payment failed");
    }

    const { data, error } = await this.supabase
      .from("escrows")
      .update({ status: "released", settlement_tx_hash: txResult.transactionHash })
      .eq("id", escrowId)
      .select()
      .single();

    if (error) return serviceError("BLOCKCHAIN_ERROR", error.message);

    logBlockchainOperation(
      "info",
      "Escrow released",
      { escrowId, transactionHash: txResult.transactionHash },
      correlationId
    );

    return {
      success: true,
      escrow: rowToRecord(data),
      transactionHash: txResult.transactionHash,
      explorerUrl: txResult.explorerUrl,
    };
  }

  // ── 4. Refund ───────────────────────────────────────────────────────────────

  /**
   * Refunds escrowed funds back to the depositor.
   * Caller must be the depositor, or the escrow must have expired.
   *
   * @param params - RefundEscrowParams
   */
  async refundEscrow(params: RefundEscrowParams): Promise<EscrowOperationResult> {
    const correlationId = generateCorrelationId();
    const { escrowId, callerPublicKey } = params;

    const escrow = await this._loadEscrow(escrowId);
    if (!escrow) return serviceError("NOT_FOUND", `Escrow ${escrowId} not found`);

    if (escrow.status !== "funded") {
      return serviceError(
        "INVALID_STATUS",
        `Cannot refund escrow in status "${escrow.status}". Expected "funded".`
      );
    }

    // Authorization: depositor, or arbitrator after expiry
    const now = new Date();
    const expired =
      escrow.conditions.expiresAt != null &&
      new Date(escrow.conditions.expiresAt) < now;

    const isDepositor = callerPublicKey === escrow.parties.depositor;
    const isArbitratorAfterExpiry =
      callerPublicKey === escrow.parties.arbitrator && expired;

    if (!isDepositor && !isArbitratorAfterExpiry) {
      if (escrow.conditions.expiresAt && !expired) {
        return serviceError(
          "UNAUTHORIZED",
          "Escrow has not yet expired. Only the depositor may refund before expiry."
        );
      }
      return serviceError(
        "UNAUTHORIZED",
        "Only the depositor (or arbitrator after expiry) may refund"
      );
    }

    const txResult = await this._submitSettlementPayment(
      escrow.parties.depositor,
      escrow.conditions.amount,
      escrow.conditions.asset ?? "XLM",
      escrow.groupId,
      correlationId
    );

    if (!txResult.success) {
      return serviceError("BLOCKCHAIN_ERROR", txResult.error ?? "Refund payment failed");
    }

    const { data, error } = await this.supabase
      .from("escrows")
      .update({ status: "refunded", settlement_tx_hash: txResult.transactionHash })
      .eq("id", escrowId)
      .select()
      .single();

    if (error) return serviceError("BLOCKCHAIN_ERROR", error.message);

    logBlockchainOperation(
      "info",
      "Escrow refunded",
      { escrowId, transactionHash: txResult.transactionHash },
      correlationId
    );

    return {
      success: true,
      escrow: rowToRecord(data),
      transactionHash: txResult.transactionHash,
      explorerUrl: txResult.explorerUrl,
    };
  }

  // ── 5. Dispute ──────────────────────────────────────────────────────────────

  /**
   * Raises a dispute on a funded escrow.
   * Either party (depositor or beneficiary) may dispute.
   *
   * @param params - DisputeEscrowParams
   */
  async disputeEscrow(params: DisputeEscrowParams): Promise<EscrowOperationResult> {
    const correlationId = generateCorrelationId();
    const { escrowId, callerPublicKey, reason } = params;

    if (!reason || reason.trim() === "") {
      return serviceError("VALIDATION_ERROR", "A dispute reason is required");
    }

    const escrow = await this._loadEscrow(escrowId);
    if (!escrow) return serviceError("NOT_FOUND", `Escrow ${escrowId} not found`);

    if (escrow.status !== "funded") {
      return serviceError(
        "INVALID_STATUS",
        `Cannot dispute escrow in status "${escrow.status}". Expected "funded".`
      );
    }

    const isParty =
      callerPublicKey === escrow.parties.depositor ||
      callerPublicKey === escrow.parties.beneficiary;

    if (!isParty) {
      return serviceError("UNAUTHORIZED", "Only a party to the escrow may raise a dispute");
    }

    const { data, error } = await this.supabase
      .from("escrows")
      .update({ status: "disputed", dispute_reason: reason.trim() })
      .eq("id", escrowId)
      .select()
      .single();

    if (error) return serviceError("BLOCKCHAIN_ERROR", error.message);

    logBlockchainOperation(
      "info",
      "Escrow disputed",
      { escrowId, callerPublicKey, reason },
      correlationId
    );

    return { success: true, escrow: rowToRecord(data) };
  }

  // ── 6. Resolve dispute ──────────────────────────────────────────────────────

  /**
   * Resolves a disputed escrow.  Only the arbitrator may call this.
   *
   * Resolutions:
   *  - "release" : full amount to beneficiary
   *  - "refund"  : full amount to depositor
   *  - "split"   : beneficiarySharePercent% to beneficiary, rest to depositor
   *
   * @param params - ResolveDisputeParams
   */
  async resolveDispute(params: ResolveDisputeParams): Promise<EscrowOperationResult> {
    const correlationId = generateCorrelationId();
    const {
      escrowId,
      arbitratorPublicKey,
      resolution,
      beneficiarySharePercent,
    } = params;

    const escrow = await this._loadEscrow(escrowId);
    if (!escrow) return serviceError("NOT_FOUND", `Escrow ${escrowId} not found`);

    if (escrow.status !== "disputed") {
      return serviceError(
        "INVALID_STATUS",
        `Cannot resolve escrow in status "${escrow.status}". Expected "disputed".`
      );
    }

    if (!escrow.parties.arbitrator) {
      return serviceError(
        "UNAUTHORIZED",
        "This escrow has no arbitrator assigned"
      );
    }

    if (arbitratorPublicKey !== escrow.parties.arbitrator) {
      return serviceError("UNAUTHORIZED", "Only the designated arbitrator may resolve disputes");
    }

    if (resolution === "split") {
      if (
        beneficiarySharePercent == null ||
        beneficiarySharePercent < 0 ||
        beneficiarySharePercent > 100
      ) {
        return serviceError(
          "VALIDATION_ERROR",
          "beneficiarySharePercent must be 0–100 for a split resolution"
        );
      }
    }

    // Calculate amounts
    const totalAmount = parseFloat(escrow.conditions.amount);
    const asset = escrow.conditions.asset ?? "XLM";

    let beneficiaryAmount = 0;
    let depositorAmount = 0;

    if (resolution === "release") {
      beneficiaryAmount = totalAmount;
    } else if (resolution === "refund") {
      depositorAmount = totalAmount;
    } else {
      // split
      const share = (beneficiarySharePercent ?? 50) / 100;
      beneficiaryAmount = parseFloat((totalAmount * share).toFixed(7));
      depositorAmount = parseFloat((totalAmount - beneficiaryAmount).toFixed(7));
    }

    // Submit settlement payments
    let settlementTxHash: string | undefined;
    let explorerUrl: string | null | undefined;

    if (beneficiaryAmount > 0) {
      const r = await this._submitSettlementPayment(
        escrow.parties.beneficiary,
        beneficiaryAmount.toFixed(7),
        asset,
        escrow.groupId,
        correlationId
      );
      if (!r.success) return serviceError("BLOCKCHAIN_ERROR", r.error ?? "Beneficiary payment failed");
      settlementTxHash = r.transactionHash;
      explorerUrl = r.explorerUrl;
    }

    if (depositorAmount > 0) {
      const r = await this._submitSettlementPayment(
        escrow.parties.depositor,
        depositorAmount.toFixed(7),
        asset,
        escrow.groupId,
        correlationId
      );
      if (!r.success) return serviceError("BLOCKCHAIN_ERROR", r.error ?? "Depositor refund failed");
      if (!settlementTxHash) {
        settlementTxHash = r.transactionHash;
        explorerUrl = r.explorerUrl;
      }
    }

    const { data, error } = await this.supabase
      .from("escrows")
      .update({
        status: "resolved",
        settlement_tx_hash: settlementTxHash ?? null,
        dispute_resolution: resolution,
        beneficiary_share_percent: beneficiarySharePercent ?? null,
      })
      .eq("id", escrowId)
      .select()
      .single();

    if (error) return serviceError("BLOCKCHAIN_ERROR", error.message);

    logBlockchainOperation(
      "info",
      "Dispute resolved",
      { escrowId, resolution, settlementTxHash },
      correlationId
    );

    return {
      success: true,
      escrow: rowToRecord(data),
      transactionHash: settlementTxHash,
      explorerUrl,
    };
  }

  // ── 7. Query helpers ────────────────────────────────────────────────────────

  /**
   * Retrieves a single escrow by ID.
   */
  async getEscrow(escrowId: string): Promise<EscrowRecord | null> {
    return this._loadEscrow(escrowId);
  }

  /**
   * Lists all escrows for a given group.
   */
  async listEscrowsByGroup(groupId: string): Promise<EscrowRecord[]> {
    const { data, error } = await this.supabase
      .from("escrows")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false });

    if (error || !data) return [];
    return data.map(rowToRecord);
  }

  /**
   * Lists all escrows where the given wallet is depositor or beneficiary.
   */
  async listEscrowsByWallet(walletAddress: string): Promise<EscrowRecord[]> {
    const { data, error } = await this.supabase
      .from("escrows")
      .select("*")
      .or(`depositor.eq.${walletAddress},beneficiary.eq.${walletAddress}`)
      .order("created_at", { ascending: false });

    if (error || !data) return [];
    return data.map(rowToRecord);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _loadEscrow(escrowId: string): Promise<EscrowRecord | null> {
    const { data, error } = await this.supabase
      .from("escrows")
      .select("*")
      .eq("id", escrowId)
      .single();

    if (error || !data) return null;
    return rowToRecord(data);
  }

  /**
   * Submits a payment from the service account to a recipient.
   * The group ID is embedded in the memo field for traceability.
   */
  private async _submitSettlementPayment(
    recipient: string,
    amount: string,
    asset: string,
    groupId: string,
    correlationId: string
  ): Promise<{ success: boolean; transactionHash?: string; explorerUrl?: string | null; error?: string }> {
    if (!isConfigured()) {
      return { success: false, error: "Stellar configuration not available" };
    }

    const config = loadStellarConfig();
    if (!config) return { success: false, error: "Failed to load Stellar configuration" };

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

      const { memo } = buildGroupMemo(groupId);

      const stellarAsset =
        asset === "XLM" || asset === "native"
          ? StellarSdk.Asset.native()
          : (() => {
              const [code, issuer] = asset.split(":");
              return new StellarSdk.Asset(code, issuer);
            })();

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase:
          config.network === "testnet"
            ? StellarSdk.Networks.TESTNET
            : StellarSdk.Networks.PUBLIC,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: recipient,
            asset: stellarAsset,
            amount,
          })
        )
        .addMemo(memo)
        .setTimeout(30)
        .build();

      transaction.sign(sourceKeypair);

      const result = await Promise.race([
        server.submitTransaction(transaction),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Transaction submission timeout")),
            config.transactionTimeout
          )
        ),
      ]);

      logBlockchainOperation(
        "info",
        "Settlement payment submitted",
        { recipient, amount, asset, groupId, transactionHash: result.hash },
        correlationId
      );

      return {
        success: true,
        transactionHash: result.hash,
        explorerUrl: getExplorerUrl(result.hash, config.network),
      };
    } catch (err: any) {
      logBlockchainOperation(
        "error",
        "Settlement payment failed",
        { recipient, amount, asset, groupId, error: { type: err.name, message: err.message } },
        correlationId
      );
      return { success: false, error: err.message ?? "Payment failed" };
    }
  }
}
