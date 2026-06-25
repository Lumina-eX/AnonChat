import {
  FREIGHTER_ID,
  ALBEDO_ID,
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  AlbedoModule,
  RabetModule,
  LobstrModule,
  HanaModule,
} from "@creit.tech/stellar-wallets-kit";
import {
  clearWalletSession,
  getPersistedWalletId,
  persistWalletSession,
} from "@/lib/wallet-session-storage";

export { FREIGHTER_ID, ALBEDO_ID };

const SELECTED_WALLET_ID = "selectedWalletId";
const disconnectListeners: Set<() => void> = new Set();

function getSelectedWalletIdSync() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SELECTED_WALLET_ID);
}

async function hydrateSelectedWalletId(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const persistedId = await getPersistedWalletId();
  if (!persistedId) return null;

  const current = getSelectedWalletIdSync();
  if (!current) {
    localStorage.setItem(SELECTED_WALLET_ID, persistedId);
  }

  return persistedId;
}

async function isWalletConnected() {
  if (typeof window === "undefined") return false;
  return (await getPersistedWalletId()) !== null;
}

async function clearWalletStorage() {
  if (typeof window === "undefined") return;

  localStorage.removeItem(SELECTED_WALLET_ID);
  await clearWalletSession();
}

let kit: StellarWalletsKit | null = null;

function getKit(): StellarWalletsKit | null {
  if (typeof window === "undefined") return null;
  if (kit) return kit;

  try {
    kit = new StellarWalletsKit({
      modules: [
        new FreighterModule(),
        new AlbedoModule(),
        new RabetModule(),
        new LobstrModule(),
        new HanaModule(),
      ],
      network: WalletNetwork.PUBLIC,
      selectedWalletId: getSelectedWalletIdSync() ?? FREIGHTER_ID,
    });
  } catch (e) {
    console.error("Failed to initialize StellarWalletsKit:", e);
    return null;
  }

  return kit;
}

export async function signTransaction(...args: unknown[]) {
  const kitInstance = getKit();
  if (!kitInstance) return null;
  // @ts-ignore
  return kitInstance.signTransaction(...args);
}

export async function signMessage(message: string): Promise<string> {
  const kitInstance = getKit();
  if (!kitInstance) return "";

  const { signedMessage } = await kitInstance.signMessage(message);

  // signedMessage is base64 string → convert to hex
  const decoded = Uint8Array.from(atob(signedMessage), (c) => c.charCodeAt(0));

  return Array.from(decoded)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getPublicKey() {
  if (typeof window === "undefined") return null;

  const selectedWalletId = await hydrateSelectedWalletId();
  if (!selectedWalletId || !(await isWalletConnected())) return null;

  const kitInstance = getKit();
  if (!kitInstance) return null;

  try {
    const { address } = await kitInstance.getAddress();
    return address;
  } catch (e) {
    console.error("Failed to get public key:", e);
    await clearWalletStorage();
    return null;
  }
}

export async function autoReconnect() {
  if (!(await isWalletConnected())) {
    return null;
  }

  await hydrateSelectedWalletId();

  try {
    return await getPublicKey();
  } catch {
    await clearWalletStorage();
    return null;
  }
}

export async function setWallet(walletId: string) {
  if (typeof window !== "undefined") {
    await persistWalletSession(walletId);
    localStorage.setItem(SELECTED_WALLET_ID, walletId);

    const kitInstance = getKit();
    if (!kitInstance) return;

    kitInstance.setWallet(walletId);
  }
}

export function onDisconnect(callback: () => void) {
  disconnectListeners.add(callback);
  return () => {
    disconnectListeners.delete(callback);
  };
}

export async function disconnect(callback?: () => Promise<void>) {
  if (typeof window !== "undefined") {
    clearWalletStorage();

    const kitInstance = getKit();
    if (!kitInstance) return;

    kitInstance.disconnect();

    disconnectListeners.forEach((listener) => listener());

    if (callback) await callback();
  }
}

export async function connect(callback?: () => Promise<void>) {
  if (typeof window === "undefined") return;

  const kitInstance = getKit();
  if (!kitInstance) return;

  await kitInstance.openModal({
    onWalletSelected: async (option: { id: string }) => {
      try {
        await setWallet(option.id);
        if (callback) await callback();
      } catch (e) {
        console.error(e);
      }

      return option.id;
    },
  });
}

/**
 * Connects directly to a specific wallet without opening the kit's modal.
 */
export async function connectToWallet(walletId: string, callback?: () => Promise<void>) {
  if (typeof window === "undefined") return;

  const kitInstance = getKit();
  if (!kitInstance) return;

  try {
    // Check if wallet is available
    if (walletId === FREIGHTER_ID) {
      const freighter = new FreighterModule();
      const isAvailable = await freighter.isAvailable();
      if (!isAvailable) {
        throw new Error("Freighter extension is not installed or enabled.");
      }
    }

    await setWallet(walletId);
    if (callback) await callback();
  } catch (e: unknown) {
    console.error(`Failed to connect to wallet ${walletId}:`, e);
    throw e;
  }
}

