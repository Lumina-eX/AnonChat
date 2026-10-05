import { describe, it, expect, vi, beforeEach } from "vitest";
import { Account, Keypair } from "@stellar/stellar-sdk";
import {
  assessWalletBalance,
  mapHorizonBalances,
  parseXlmToStroops,
  stroopsToXlm,
  verifyWalletBalance,
} from "@/lib/blockchain/wallet-balance";
import { submitMetadataHash } from "@/lib/blockchain/stellar-service";

const TEST_WALLET = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const { loadAccount, submitTransaction } = vi.hoisted(() => ({
  loadAccount: vi.fn(),
  submitTransaction: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", async () => {
  const actual = await vi.importActual<typeof import("@stellar/stellar-sdk")>("@stellar/stellar-sdk");
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: class {
        loadAccount(...args: unknown[]) {
          return loadAccount(...args);
        }
        submitTransaction(...args: unknown[]) {
          return submitTransaction(...args);
        }
      },
    },
  };
});

vi.mock("@/lib/blockchain/stellar-config", () => ({
  isConfigured: () => true,
  loadStellarConfig: () => ({
    network: "testnet" as const,
    sourceSecret: process.env.TEST_STELLAR_SOURCE_SECRET ?? "",
    horizonUrl: "https://horizon-testnet.stellar.org",
    transactionTimeout: 5000,
  }),
  getExplorerUrl: () => "https://stellar.expert/explorer/testnet/tx/abc",
}));

const horizonBalances = [
  { asset_type: "native", balance: "25.5000000" },
  {
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: USDC_ISSUER,
    balance: "100.0000000",
  },
  { asset_type: "liquidity_pool_shares", balance: "5.0000000", liquidity_pool_id: "pool" },
];

describe("Stellar wallet balance verification", () => {
  beforeEach(() => {
    loadAccount.mockReset();
    submitTransaction.mockReset();
  });

  it("maps Horizon balances and keeps only spendable assets", () => {
    expect(mapHorizonBalances(horizonBalances)).toEqual([
      { asset: "XLM", amount: "25.5000000" },
      { asset: "USDC", amount: "100.0000000" },
    ]);
  });

  it("converts XLM and stroops without floating point drift", () => {
    expect(parseXlmToStroops("0.100")).toBe(1_000_000n);
    expect(parseXlmToStroops("0.0000001")).toBe(1n);
    expect(stroopsToXlm(100n)).toBe("0.0000100");
    expect(parseXlmToStroops("1.12345678")).toBeNull();
  });

  it("returns ok when XLM covers the fee and ignores other assets", () => {
    const result = assessWalletBalance({
      walletId: TEST_WALLET,
      balances: horizonBalances,
      requiredFee: "0.100",
      operationAmount: "0.0000001",
    });

    expect(result).toMatchObject({
      walletId: TEST_WALLET,
      balances: [
        { asset: "XLM", amount: "25.5000000" },
        { asset: "USDC", amount: "100.0000000" },
      ],
      requiredFee: "0.100",
      operationAmount: "0.0000001",
      status: "ok",
    });
    expect(result.error).toBeUndefined();
  });

  it("detects insufficient XLM even when other assets are funded", () => {
    const result = assessWalletBalance({
      walletId: TEST_WALLET,
      balances: [
        { asset_type: "native", balance: "0.0500000" },
        { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "100.0000000" },
      ],
      requiredFee: "0.100",
    });

    expect(result.status).toBe("insufficient_funds");
    expect(result.error).toBe("Insufficient XLM to cover the required fee.");
    expect(result.balances).toEqual([
      { asset: "XLM", amount: "0.0500000" },
      { asset: "USDC", amount: "100.0000000" },
    ]);
  });

  it("checks a non-XLM asset only when that asset is explicitly required", () => {
    const shortAsset = assessWalletBalance({
      walletId: TEST_WALLET,
      balances: horizonBalances,
      requiredFee: "0.100",
      operationAmount: "150",
      operationAsset: "USDC",
    });
    expect(shortAsset.status).toBe("insufficient_funds");
    expect(shortAsset.error).toBe("Insufficient USDC to cover the operation amount.");

    const covered = assessWalletBalance({
      walletId: TEST_WALLET,
      balances: horizonBalances,
      requiredFee: "0.100",
      operationAmount: "1",
    });
    expect(covered.status).toBe("ok");
  });

  it("retries retryable Horizon failures and then returns the balance", async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("timeout talking to horizon"), { name: "TimeoutError" }))
      .mockResolvedValueOnce({ balances: horizonBalances });

    const result = await verifyWalletBalance(
      { walletId: TEST_WALLET, requiredFee: "0.100", maxAttempts: 3 },
      { loadAccount: loader, sleep: async () => {} },
    );

    expect(loader).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("ok");
    expect(result.balances[0]).toEqual({ asset: "XLM", amount: "25.5000000" });
  });

  it("returns a Horizon error after retries are exhausted", async () => {
    const loader = vi.fn().mockRejectedValue(Object.assign(new Error("socket hang up"), { response: { status: 503 } }));

    const result = await verifyWalletBalance(
      { walletId: TEST_WALLET, requiredFee: "0.100", maxAttempts: 2 },
      { loadAccount: loader, sleep: async () => {} },
    );

    expect(loader).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("horizon_error");
    expect(result.error).toContain("Unable to retrieve wallet balance from Horizon");
    expect(result.balances).toEqual([]);
  });

  it("treats an unfunded account as insufficient funds and does not retry", async () => {
    const loader = vi.fn().mockRejectedValue(Object.assign(new Error("Not Found"), { response: { status: 404 } }));

    const result = await verifyWalletBalance(
      { walletId: TEST_WALLET, requiredFee: "0.100", maxAttempts: 3 },
      { loadAccount: loader, sleep: async () => {} },
    );

    expect(loader).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("insufficient_funds");
    expect(result.error).toContain("not found or unfunded");
  });
});

describe("balance gate before transaction submission", () => {
  beforeEach(() => {
    loadAccount.mockReset();
    submitTransaction.mockReset();
    const source = Keypair.random();
    process.env.TEST_STELLAR_SOURCE_SECRET = source.secret();
  });

  it("does not submit a transaction when XLM cannot cover the fee", async () => {
    const source = Keypair.fromSecret(process.env.TEST_STELLAR_SOURCE_SECRET as string);
    const account = new Account(source.publicKey(), "1000");
    (account as unknown as { balances: unknown[] }).balances = [
      { asset_type: "native", balance: "0.0000010" },
      { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "50.0000000" },
    ];
    loadAccount.mockResolvedValue(account);

    const result = await submitMetadataHash("room_1714000000000_abc123xyz", "ab".repeat(32));

    expect(result.success).toBe(false);
    expect(result.error).toBe("Insufficient XLM to cover the required fee.");
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("submits when the XLM balance covers the fee and anchor amount", async () => {
    const source = Keypair.fromSecret(process.env.TEST_STELLAR_SOURCE_SECRET as string);
    const account = new Account(source.publicKey(), "1000");
    (account as unknown as { balances: unknown[] }).balances = [
      { asset_type: "native", balance: "25.5000000" },
    ];
    loadAccount.mockResolvedValue(account);
    submitTransaction.mockResolvedValue({ hash: "tx-hash", ledger: 10, fee_charged: "100" });

    const result = await submitMetadataHash("room_1714000000000_abc123xyz", "ab".repeat(32));

    expect(result.success).toBe(true);
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });
});
