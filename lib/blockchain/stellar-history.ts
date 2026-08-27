/**
 * Stellar Transaction History Service
 *
 * Retrieves, parses, and filters on-chain transactions for a connected wallet
 * using the Stellar Horizon API.
 */

import { Horizon } from "@stellar/stellar-sdk";
import {
  loadStellarConfig,
  getExplorerUrl,
} from "./stellar-config";
import { logBlockchainOperation, generateCorrelationId } from "./logger";
import type {
  StellarWalletTransaction,
  StellarTransactionHistoryResponse,
  TransactionHistoryOptions,
  AnonChatActionType,
  WalletTransactionStatus,
} from "@/types/blockchain";

const STROOPS_PER_XLM = 10_000_000;
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;
const ANONCHAT_MEMO_PATTERN = /^grp_[a-f0-9]{24}$/;
const ANONCHAT_ACTION_MEMO_PATTERN = /^aca_[a-z]_[a-z0-9_-]+$/i;

/**
 * Fallback public Horizon endpoints when explicit config is not set.
 */
const PUBLIC_HORIZON_ENDPOINTS = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
} as const;

/**
 * Resolves active network and Horizon URL.
 */
export function getHorizonServerConfig(): {
  network: "testnet" | "mainnet";
  horizonUrl: string;
} {
  const config = loadStellarConfig();
  if (config) {
    return {
      network: config.network,
      horizonUrl: config.horizonUrl,
    };
  }

  // Fallback to environment variables or defaults
  const envNetwork = (process.env.NEXT_PUBLIC_STELLAR_NETWORK ||
    process.env.STELLAR_NETWORK ||
    "testnet") as "testnet" | "mainnet";
  const network = envNetwork === "mainnet" ? "mainnet" : "testnet";
  const horizonUrl =
    process.env.STELLAR_HORIZON_URL ||
    process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ||
    PUBLIC_HORIZON_ENDPOINTS[network];

  return { network, horizonUrl };
}

/**
 * Determines whether a transaction is associated with AnonChat.
 */
export function isAnonChatTransaction(memo?: string | null): boolean {
  if (!memo || typeof memo !== "string") return false;
  const trimmed = memo.trim();
  return (
    ANONCHAT_MEMO_PATTERN.test(trimmed) ||
    ANONCHAT_ACTION_MEMO_PATTERN.test(trimmed) ||
    trimmed.startsWith("grp_")
  );
}

/**
 * Classifies the AnonChat action type based on memo and transaction properties.
 */
export function classifyActionType(
  memo: string | null,
  successful: boolean,
  operationCount: number,
): { actionType: AnonChatActionType; actionLabel: string } {
  if (isAnonChatTransaction(memo)) {
    const normalizedMemo = (memo || "").trim().toLowerCase();
    if (normalizedMemo.startsWith("aca_c_")) {
      return {
        actionType: "group_creation",
        actionLabel: "Group Action",
      };
    }
    if (normalizedMemo.startsWith("aca_j_")) {
      return {
        actionType: "audit_log",
        actionLabel: "Audit Event",
      };
    }
    if (normalizedMemo.startsWith("aca_m_")) {
      return {
        actionType: "metadata_anchor",
        actionLabel: "Metadata Anchor",
      };
    }
    if (normalizedMemo.startsWith("aca_p_")) {
      return {
        actionType: "payment",
        actionLabel: "Payment",
      };
    }
    if (normalizedMemo.startsWith("aca_x_")) {
      return {
        actionType: "contract_call",
        actionLabel: "Contract Call",
      };
    }
    return {
      actionType: "group_creation",
      actionLabel: "Group Anchoring / Audit",
    };
  }

  if (operationCount > 1) {
    return {
      actionType: "general",
      actionLabel: `Batch (${operationCount} ops)`,
    };
  }

  return {
    actionType: "general",
    actionLabel: successful ? "Stellar Transaction" : "Failed Transaction",
  };
}

function extractHorizonStatus(error: any): number | null {
  return (
    error?.response?.status ??
    error?.status ??
    error?.response?.statusCode ??
    null
  );
}

/**
 * Formats stroops into human-readable XLM string.
 */
export function formatStroopsToXlm(stroops: string | number): string {
  const stroopsNum = typeof stroops === "string" ? parseInt(stroops, 10) : stroops;
  if (isNaN(stroopsNum) || stroopsNum <= 0) return "0.0000100";
  const xlm = stroopsNum / STROOPS_PER_XLM;
  return xlm.toFixed(7);
}

/**
 * Parses raw Horizon transaction record into a normalized StellarWalletTransaction.
 */
export function parseHorizonTransaction(
  tx: any,
  network: "testnet" | "mainnet",
): StellarWalletTransaction {
  const hash = tx.hash || "";
  const ledger = (tx.ledger_attr || tx.ledger || 0) as number;
  const createdAt = tx.created_at || new Date().toISOString();
  const successful = Boolean(tx.successful);
  const status: WalletTransactionStatus = successful ? "successful" : "failed";
  const memo = tx.memo || null;
  const memoType = tx.memo_type || null;
  const isAnon = isAnonChatTransaction(memo);
  const operationCount = tx.operation_count || 1;
  const { actionType, actionLabel } = classifyActionType(memo, successful, operationCount);

  const feeChargedStroops = String(tx.fee_charged || "100");
  const feeChargedXlm = formatStroopsToXlm(feeChargedStroops);
  const sourceAccount = tx.source_account || "";
  const explorerUrl = getExplorerUrl(hash, network);
  const pagingToken = tx.paging_token || "";

  let errorMessage: string | null = null;
  if (!successful) {
    const resultCode =
      tx.result_codes?.transaction ||
      tx.result?.codes?.transaction ||
      tx.result_code ||
      null;
    errorMessage = resultCode
      ? `Transaction failed: ${resultCode}`
      : "Transaction failed on Stellar network";
  }

  return {
    id: tx.id || hash,
    hash,
    ledger,
    createdAt,
    status,
    successful,
    memo,
    memoType,
    isAnonChat: isAnon,
    actionType,
    actionLabel,
    feeChargedXlm,
    feeChargedStroops,
    sourceAccount,
    operationCount,
    explorerUrl,
    errorMessage,
    pagingToken,
  };
}

export function isRelevantAnonChatTransaction(tx: Pick<StellarWalletTransaction, "memo" | "isAnonChat" | "actionType">): boolean {
  return tx.isAnonChat && tx.actionType !== "general";
}

/**
 * Retrieves transaction history for a given wallet address from Stellar Horizon.
 */
export async function fetchWalletTransactionHistory(
  walletAddress: string,
  options: TransactionHistoryOptions = {},
): Promise<StellarTransactionHistoryResponse> {
  const correlationId = generateCorrelationId();
  const { network, horizonUrl } = getHorizonServerConfig();
  const limit = Math.min(Math.max(options.limit || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const order = options.order || "desc";
  const filter = options.filter || "anonchat";

  logBlockchainOperation(
    "info",
    "Fetching wallet transaction history from Horizon",
    {
      walletAddress,
      limit,
      order,
      filter,
      cursor: options.cursor || null,
      network,
    },
    correlationId,
  );

  try {
    const server = new Horizon.Server(horizonUrl);

    let query = server
      .transactions()
      .forAccount(walletAddress)
      .order(order)
      .limit(limit);

    if (options.cursor) {
      query = query.cursor(options.cursor);
    }

    const response = await query.call();
    const rawRecords = response.records || [];

    const parsedTransactions: StellarWalletTransaction[] = rawRecords.map((record) =>
      parseHorizonTransaction(record, network),
    );

    const filteredTransactions =
      filter === "anonchat"
        ? parsedTransactions.filter((tx) => isRelevantAnonChatTransaction(tx))
        : parsedTransactions;

    // Build cursor tokens for forward/backward navigation
    const nextCursor =
      rawRecords.length > 0 ? rawRecords[rawRecords.length - 1].paging_token : null;
    const prevCursor = rawRecords.length > 0 ? rawRecords[0].paging_token : null;

    logBlockchainOperation(
      "info",
      "Successfully fetched transaction history",
      {
        walletAddress,
        totalRaw: rawRecords.length,
        totalFiltered: filteredTransactions.length,
        network,
      },
      correlationId,
    );

    return {
      walletAddress,
      transactions: filteredTransactions,
      cursor: {
        next: rawRecords.length >= limit ? nextCursor : null,
        prev: options.cursor ? prevCursor : null,
      },
      network,
      totalReturned: filteredTransactions.length,
      isInactiveAccount: false,
    };
  } catch (error: any) {
    // Graceful handling for unfunded / inactive accounts (Horizon returns 404)
    const status = extractHorizonStatus(error);
    if (
      status === 404 ||
      error?.name === "NotFoundError" ||
      error?.message?.includes("404") ||
      error?.message?.includes("Resource Missing")
    ) {
      logBlockchainOperation(
        "info",
        "Account not yet funded or active on Stellar network",
        { walletAddress, network },
        correlationId,
      );

      return {
        walletAddress,
        transactions: [],
        cursor: { next: null, prev: null },
        network,
        totalReturned: 0,
        isInactiveAccount: true,
      };
    }

    if (status === 429 || status === 503) {
      const rateLimitedError = new Error(
        status === 429
          ? "Stellar Horizon is rate limiting requests. Please retry in a moment."
          : "Stellar Horizon is temporarily unavailable. Please retry in a moment.",
      ) as Error & { status?: number };
      rateLimitedError.status = status;
      throw rateLimitedError;
    }

    logBlockchainOperation(
      "error",
      "Failed to fetch transaction history from Horizon",
      {
        walletAddress,
        error: {
          type: error?.name || "HorizonError",
          message: error?.message || "Unknown error",
        },
        network,
      },
      correlationId,
    );

    throw error;
  }
}
