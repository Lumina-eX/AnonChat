/**
 * Retrieves a connected wallet's Horizon balances and checks that native XLM
 * covers the required fee (and operation amount, when it is also in XLM)
 * before a transaction is submitted.
 */

import { Horizon } from "@stellar/stellar-sdk";
import { getHorizonServerConfig } from "./stellar-history";
import { logBlockchainOperation } from "./logger";

const STROOPS_PER_XLM = BigInt(10_000_000);
const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 2000;
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,7}))?$/;

export interface HorizonBalanceRecord {
  balance: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

export interface AssetBalance {
  asset: string;
  amount: string;
}

export type WalletBalanceStatus = "ok" | "insufficient_funds" | "horizon_error";

export interface WalletBalanceResponse {
  walletId: string;
  balances: AssetBalance[];
  requiredFee: string;
  operationAmount: string;
  status: WalletBalanceStatus;
  error?: string;
}

export interface VerifyWalletBalanceInput {
  walletId: string;
  requiredFee: string;
  operationAmount?: string;
  /** Non-XLM asset code when the operation amount must be covered by that asset. Fees always use XLM. */
  operationAsset?: string;
  /** Preloaded Horizon balances. Skips the network fetch when present. */
  balances?: HorizonBalanceRecord[];
  maxAttempts?: number;
}

export interface WalletBalanceDeps {
  loadAccount?: (walletId: string) => Promise<{ balances?: HorizonBalanceRecord[] | null }>;
  sleep?: (ms: number) => Promise<void>;
}

function isNativeAsset(asset: string | undefined): boolean {
  if (!asset) return true;
  const normalized = asset.trim().toUpperCase();
  return normalized === "XLM" || normalized === "NATIVE";
}

export function parseXlmToStroops(amount: string): bigint | null {
  if (typeof amount !== "string") return null;
  const match = AMOUNT_PATTERN.exec(amount.trim());
  if (!match) return null;
  const [whole, fraction = ""] = amount.trim().split(".");
  const padded = (fraction + "0000000").slice(0, 7);
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(padded);
}

export function stroopsToXlm(stroops: bigint | string | number): string {
  const value = typeof stroops === "bigint" ? stroops : BigInt(String(stroops).split(".")[0]);
  const whole = value / STROOPS_PER_XLM;
  const fraction = (value % STROOPS_PER_XLM).toString().padStart(7, "0");
  return `${whole.toString()}.${fraction}`;
}

export function mapHorizonBalances(records: HorizonBalanceRecord[]): AssetBalance[] {
  const balances: AssetBalance[] = [];

  for (const record of records) {
    if (!record || record.asset_type === "liquidity_pool_shares") continue;
    if (typeof record.balance !== "string") continue;

    balances.push({
      asset: record.asset_type === "native" ? "XLM" : record.asset_code || record.asset_type,
      amount: record.balance,
    });
  }

  return balances;
}

function findBalance(balances: AssetBalance[], asset: string): string {
  const match = balances.find((entry) => entry.asset === asset);
  return match?.amount ?? "0";
}

function logBalanceCheck(result: WalletBalanceResponse): void {
  const level = result.status === "ok" ? "info" : result.status === "insufficient_funds" ? "warn" : "error";
  logBlockchainOperation(level, "Wallet balance check", {
    walletId: result.walletId,
    status: result.status,
    requiredFee: result.requiredFee,
    operationAmount: result.operationAmount,
    xlmBalance: findBalance(result.balances, "XLM"),
    error: result.error ? { type: result.status, message: result.error } : undefined,
  });
}

export function assessWalletBalance(input: {
  walletId: string;
  balances: HorizonBalanceRecord[];
  requiredFee: string;
  operationAmount?: string;
  operationAsset?: string;
}): WalletBalanceResponse {
  const operationAmount = input.operationAmount ?? "0";
  const balances = mapHorizonBalances(input.balances);
  const base = {
    walletId: input.walletId,
    balances,
    requiredFee: input.requiredFee,
    operationAmount,
  };

  const feeStroops = parseXlmToStroops(input.requiredFee);
  const operationStroops = parseXlmToStroops(operationAmount);
  if (feeStroops === null || operationStroops === null) {
    const result: WalletBalanceResponse = {
      ...base,
      status: "horizon_error",
      error: "Required fee and operation amount must be non-negative XLM amounts with at most 7 decimal places.",
    };
    logBalanceCheck(result);
    return result;
  }

  const xlmAvailable = parseXlmToStroops(findBalance(balances, "XLM")) ?? BigInt(0);
  const feeAssetIsNative = isNativeAsset(input.operationAsset);
  const xlmRequired = feeAssetIsNative ? feeStroops + operationStroops : feeStroops;

  if (xlmAvailable < xlmRequired) {
    const result: WalletBalanceResponse = {
      ...base,
      status: "insufficient_funds",
      error: "Insufficient XLM to cover the required fee.",
    };
    logBalanceCheck(result);
    return result;
  }

  if (!feeAssetIsNative && input.operationAsset) {
    const assetCode = input.operationAsset.trim();
    const assetAvailable = parseXlmToStroops(findBalance(balances, assetCode)) ?? BigInt(0);
    if (assetAvailable < operationStroops) {
      const result: WalletBalanceResponse = {
        ...base,
        status: "insufficient_funds",
        error: `Insufficient ${assetCode} to cover the operation amount.`,
      };
      logBalanceCheck(result);
      return result;
    }
  }

  const result: WalletBalanceResponse = { ...base, status: "ok" };
  logBalanceCheck(result);
  return result;
}

function isAccountNotFound(error: unknown): boolean {
  const candidate = error as { response?: { status?: number }; status?: number; name?: string };
  const status = candidate?.response?.status ?? candidate?.status;
  if (status === 404) return true;
  return (candidate?.name || "").toLowerCase().includes("notfound");
}

function isRetryableHorizonError(error: unknown): boolean {
  if (isAccountNotFound(error)) return false;

  const candidate = error as { message?: string; name?: string; response?: { status?: number }; status?: number };
  const message = (candidate?.message || "").toLowerCase();
  const name = (candidate?.name || "").toLowerCase();
  const status = candidate?.response?.status ?? candidate?.status;

  if (status === 429 || status === 502 || status === 503 || status === 504) return true;

  return (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("socket") ||
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("504") ||
    name.includes("timeouterror") ||
    name.includes("networkerror")
  );
}

function retryDelay(attempt: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

async function defaultLoadAccount(walletId: string): Promise<{ balances?: HorizonBalanceRecord[] | null }> {
  const { horizonUrl } = getHorizonServerConfig();
  const server = new Horizon.Server(horizonUrl);
  return server.loadAccount(walletId);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verifyWalletBalance(
  input: VerifyWalletBalanceInput,
  deps?: WalletBalanceDeps,
): Promise<WalletBalanceResponse> {
  const operationAmount = input.operationAmount ?? "0";

  if (input.balances) {
    return assessWalletBalance({
      walletId: input.walletId,
      balances: input.balances,
      requiredFee: input.requiredFee,
      operationAmount,
      operationAsset: input.operationAsset,
    });
  }

  const loadAccount = deps?.loadAccount ?? defaultLoadAccount;
  const sleep = deps?.sleep ?? defaultSleep;
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const account = await loadAccount(input.walletId);
      return assessWalletBalance({
        walletId: input.walletId,
        balances: account.balances ?? [],
        requiredFee: input.requiredFee,
        operationAmount,
        operationAsset: input.operationAsset,
      });
    } catch (error) {
      lastError = error;

      if (isAccountNotFound(error)) {
        const result: WalletBalanceResponse = {
          walletId: input.walletId,
          balances: [],
          requiredFee: input.requiredFee,
          operationAmount,
          status: "insufficient_funds",
          error: "Stellar account not found or unfunded, so the required fee cannot be covered.",
        };
        logBalanceCheck(result);
        return result;
      }

      const retryable = isRetryableHorizonError(error);
      if (!retryable || attempt >= maxAttempts) break;

      logBlockchainOperation("warn", "Retrying wallet balance fetch", {
        walletId: input.walletId,
        attempt,
        maxAttempts,
        error: {
          type: (error as { name?: string })?.name || "HorizonError",
          message: (error as { message?: string })?.message || "Horizon request failed",
        },
      });
      await sleep(retryDelay(attempt));
    }
  }

  const message = (lastError as { message?: string })?.message || "Horizon request failed";
  const result: WalletBalanceResponse = {
    walletId: input.walletId,
    balances: [],
    requiredFee: input.requiredFee,
    operationAmount,
    status: "horizon_error",
    error: `Unable to retrieve wallet balance from Horizon: ${message}`,
  };
  logBalanceCheck(result);
  return result;
}
