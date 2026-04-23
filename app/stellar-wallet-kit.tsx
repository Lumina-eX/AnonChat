import {
  FREIGHTER_ID,
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  AlbedoModule,
  RabetModule,
  LobstrModule,
  HanaModule,
} from "@creit.tech/stellar-wallets-kit";

const SELECTED_WALLET_ID = "selectedWalletId";
const WALLET_CONNECTED = "walletConnected";
const disconnectListeners: Set<() => void> = new Set();

function getSelectedWalletId() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SELECTED_WALLET_ID);
}

function isWalletConnected() {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(WALLET_CONNECTED) === "true";
}

function clearWalletStorage() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SELECTED_WALLET_ID);
  localStorage.removeItem(WALLET_CONNECTED);
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
      selectedWalletId: getSelectedWalletId() ?? FREIGHTER_ID,
    });
  } catch (e) {
    console.error("Failed to initialize StellarWalletsKit:", e);
    return null;
  }

  return kit;
}

export async function signTransaction(...args: any[]) {
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
  if (!getSelectedWalletId() || !isWalletConnected()) return null;

  const kitInstance = getKit();
  if (!kitInstance) return null;

  try {
    const { address } = await kitInstance.getAddress();
    return address;
  } catch (e) {
    console.error("Failed to get public key:", e);
    return null;
  }
}

export async function autoReconnect() {
  if (!isWalletConnected() || !getSelectedWalletId()) return null;

  try {
    return await getPublicKey();
  } catch {
    clearWalletStorage();
    return null;
  }
}

export async function setWallet(walletId: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem(SELECTED_WALLET_ID, walletId);
    localStorage.setItem(WALLET_CONNECTED, "true");

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
    onWalletSelected: async (option: any) => {
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
