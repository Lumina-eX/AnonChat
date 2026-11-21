import {
  FreighterModule,
  AlbedoModule,
  WalletNetwork,
  FREIGHTER_ID,
  ALBEDO_ID,
} from "@creit.tech/stellar-wallets-kit";
import { logBlockchainOperation } from "@/lib/blockchain/logger";

export type DetectedNetwork = "testnet" | "mainnet" | "unknown";

const SELECTED_WALLET_ID_KEY = "selectedWalletId";

function getSelectedWalletId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SELECTED_WALLET_ID_KEY);
}

export function getExpectedNetwork(): DetectedNetwork {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STELLAR_NETWORK) {
    const env = process.env.NEXT_PUBLIC_STELLAR_NETWORK.toLowerCase();
    if (env === "testnet" || env === "mainnet") {
      return env;
    }
  }
  return "mainnet";
}

export function isExpectedNetwork(network: DetectedNetwork): boolean {
  if (network === "unknown") return false;
  return network === getExpectedNetwork();
}

export function networkToPassphrase(network: DetectedNetwork): string {
  if (network === "testnet") return "Test SDF Network ; September 2015";
  if (network === "mainnet") return "Public Global Stellar Network ; September 2015";
  return "";
}

export async function detectWalletNetwork(): Promise<DetectedNetwork> {
  if (typeof window === "undefined") return "unknown";

  const walletId = getSelectedWalletId();
  if (!walletId) return "unknown";

  try {
    if (walletId === FREIGHTER_ID) {
      const module = new FreighterModule();
      const isAvailable = await module.isAvailable();
      if (!isAvailable) return "unknown";
      const { network } = await module.getNetwork();
      return normalizeNetwork(network);
    }

    if (walletId === ALBEDO_ID) {
      const module = new AlbedoModule();
      const isAvailable = await module.isAvailable();
      if (!isAvailable) return "unknown";
      const { network } = await module.getNetwork();
      return normalizeNetwork(network);
    }
  } catch (error) {
    logBlockchainOperation("warn", "Wallet network detection failed", {
      walletId,
      error: { type: "NetworkDetectionError", message: error instanceof Error ? error.message : String(error) },
    });
  }

  return "unknown";
}

export async function detectNetworkForWallet(walletId: string): Promise<DetectedNetwork> {
  if (typeof window === "undefined") return "unknown";

  try {
    if (walletId === FREIGHTER_ID) {
      const module = new FreighterModule();
      const isAvailable = await module.isAvailable();
      if (!isAvailable) return "unknown";
      const { network } = await module.getNetwork();
      return normalizeNetwork(network);
    }

    if (walletId === ALBEDO_ID) {
      const module = new AlbedoModule();
      const isAvailable = await module.isAvailable();
      if (!isAvailable) return "unknown";
      const { network } = await module.getNetwork();
      return normalizeNetwork(network);
    }
  } catch (error) {
    logBlockchainOperation("warn", "Wallet network detection failed", {
      walletId,
      error: { type: "NetworkDetectionError", message: error instanceof Error ? error.message : String(error) },
    });
  }

  return "unknown";
}

function normalizeNetwork(network: string): DetectedNetwork {
  const upper = network.toUpperCase();
  if (upper === "PUBLIC" || upper === "MAINNET") return "mainnet";
  if (upper === "TESTNET" || upper === "TEST" || upper === "TEST_NET") return "testnet";
  if (network.includes("Test SDF Network")) return "testnet";
  if (network.includes("Public Global")) return "mainnet";
  return "unknown";
}
