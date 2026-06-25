const WALLET_SESSION_KEY = "anonchat_wallet_session_v1";
const WALLET_SESSION_DB_NAME = "anonchat_wallet_session_db";
const WALLET_SESSION_DB_VERSION = 1;
const WALLET_SESSION_KEY_STORE = "keys";
const WALLET_SESSION_CRYPTO_KEY_ID = "wallet-session-crypto-key";

interface StoredWalletSession {
  walletId: string;
  expiresAt: number;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.crypto !== "undefined";
}

function base64Encode(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; ++i) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64Decode(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; ++i) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function openWalletSessionDb(): Promise<IDBDatabase | null> {
  if (!isBrowser() || !window.indexedDB) return null;

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(WALLET_SESSION_DB_NAME, WALLET_SESSION_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WALLET_SESSION_KEY_STORE)) {
        db.createObjectStore(WALLET_SESSION_KEY_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStoredCryptoKey(): Promise<CryptoKey | null> {
  if (!isBrowser()) return null;
  const db = await openWalletSessionDb();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(WALLET_SESSION_KEY_STORE, "readonly");
    const store = transaction.objectStore(WALLET_SESSION_KEY_STORE);
    const request = store.get(WALLET_SESSION_CRYPTO_KEY_ID);

    request.onsuccess = () => {
      const jwk = request.result;
      if (!jwk) {
        resolve(null);
        return;
      }

      window.crypto.subtle.importKey("jwk", jwk, { name: "AES-GCM" }, true, ["encrypt", "decrypt"])
        .then(resolve)
        .catch(reject);
    };

    request.onerror = () => reject(request.error);
  });
}

async function storeCryptoKey(key: CryptoKey): Promise<void> {
  if (!isBrowser()) return;
  const db = await openWalletSessionDb();
  if (!db) return;

  const jwk = await window.crypto.subtle.exportKey("jwk", key);
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(WALLET_SESSION_KEY_STORE, "readwrite");
    const store = transaction.objectStore(WALLET_SESSION_KEY_STORE);
    const request = store.put(jwk, WALLET_SESSION_CRYPTO_KEY_ID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function ensureEncryptionKey(): Promise<CryptoKey | null> {
  if (!isBrowser()) return null;
  const existingKey = await getStoredCryptoKey();
  if (existingKey) return existingKey;

  const key = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  await storeCryptoKey(key);
  return key;
}

async function encryptSession(session: StoredWalletSession): Promise<string> {
  if (!isBrowser()) {
    return JSON.stringify(session);
  }

  const key = await ensureEncryptionKey();
  if (!key) {
    return JSON.stringify(session);
  }

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(session));
  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );

  return `${base64Encode(iv)}:${base64Encode(new Uint8Array(cipherBuffer))}`;
}

async function decryptSession(value: string): Promise<StoredWalletSession | null> {
  if (!isBrowser()) return null;

  const key = await getStoredCryptoKey();
  if (!key) return null;

  const [ivPart, cipherPart] = value.split(":");
  if (!ivPart || !cipherPart) return null;

  const iv = base64Decode(ivPart);
  const cipher = base64Decode(cipherPart);

  try {
    const plain = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipher,
    );
    const decoded = new TextDecoder().decode(plain);
    return JSON.parse(decoded) as StoredWalletSession;
  } catch {
    return null;
  }
}

async function readRawWalletSession(): Promise<string | null> {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(WALLET_SESSION_KEY);
}

async function writeRawWalletSession(value: string): Promise<void> {
  if (!isBrowser()) return;
  window.localStorage.setItem(WALLET_SESSION_KEY, value);
}

async function removeRawWalletSession(): Promise<void> {
  if (!isBrowser()) return;
  window.localStorage.removeItem(WALLET_SESSION_KEY);
}

export async function getStoredWalletSession(): Promise<StoredWalletSession | null> {
  const raw = await readRawWalletSession();
  if (!raw) return null;

  const session = await decryptSession(raw);
  if (session && session.expiresAt > Date.now()) return session;

  try {
    const fallback = JSON.parse(raw) as StoredWalletSession;
    if (fallback?.walletId && fallback.expiresAt > Date.now()) {
      return fallback;
    }
  } catch {
    // Ignore fallback parse failures.
  }

  await removeRawWalletSession();
  return null;
}

export async function getPersistedWalletId(): Promise<string | null> {
  const session = await getStoredWalletSession();
  return session?.walletId ?? null;
}

export async function persistWalletSession(walletId: string): Promise<void> {
  const session: StoredWalletSession = {
    walletId,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };

  try {
    const encrypted = await encryptSession(session);
    await writeRawWalletSession(encrypted);
  } catch {
    await writeRawWalletSession(JSON.stringify(session));
  }
}

export async function clearWalletSession(): Promise<void> {
  await removeRawWalletSession();
}
