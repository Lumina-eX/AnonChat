/**
 * Client-side draft message persistence.
 *
 * Unfinished composer text is stored in `localStorage` under `draft:<groupId>`
 * so it survives switching between groups and reloading the page. Drafts are
 * deliberately device-local: nothing is ever sent to the backend and there is no
 * cross-device sync.
 *
 * Every helper is SSR-safe and swallows storage failures (quota exceeded,
 * disabled/private-mode storage, corrupt JSON) so the composer never breaks
 * because of a best-effort draft.
 */

export const DRAFT_KEY_PREFIX = "draft:";

/** Value persisted for a single group draft. */
export interface DraftRecord {
  text: string;
  updatedAt: number;
}

type DraftListener = (draft: string) => void;

/** Active subscribers keyed by group id. */
const listenersByGroup = new Map<string, Set<DraftListener>>();

/** Storage key for a group draft, e.g. `draft:group-1`. */
export function draftStorageKey(groupId: string): string {
  return `${DRAFT_KEY_PREFIX}${groupId}`;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Accessing localStorage can throw in sandboxed iframes.
    return null;
  }
}

function notify(groupId: string, draft: string): void {
  const listeners = listenersByGroup.get(groupId);
  if (!listeners) return;
  for (const listener of Array.from(listeners)) {
    try {
      listener(draft);
    } catch {
      // A misbehaving subscriber must not break draft persistence.
    }
  }
}

/**
 * Read the saved draft for a group.
 * Returns an empty string when there is no draft, storage is unavailable, or
 * the stored value is corrupt.
 */
export function getDraft(groupId: string): string {
  if (!groupId) return "";

  const storage = getStorage();
  if (!storage) return "";

  try {
    const raw = storage.getItem(draftStorageKey(groupId));
    if (!raw) return "";

    const parsed = JSON.parse(raw) as Partial<DraftRecord> | null;
    return typeof parsed?.text === "string" ? parsed.text : "";
  } catch {
    // Corrupt JSON (or a non-JSON legacy value) — treat as "no draft".
    return "";
  }
}

/**
 * Persist a draft for a group.
 *
 * Blank text is intentionally ignored so an empty composer cannot overwrite an
 * existing draft; use {@link clearDraft} to remove a draft on purpose.
 *
 * @returns `true` when the value was written, `false` when it was skipped or
 * stored failed (drafts are best effort).
 */
export function setDraft(groupId: string, text: string): boolean {
  if (!groupId || !text.trim()) return false;

  const storage = getStorage();
  if (!storage) return false;

  try {
    const record: DraftRecord = { text, updatedAt: Date.now() };
    storage.setItem(draftStorageKey(groupId), JSON.stringify(record));
    notify(groupId, text);
    return true;
  } catch {
    // QuotaExceededError / disabled storage: keep the draft in memory only.
    return false;
  }
}

/** Remove the stored draft for a group. */
export function clearDraft(groupId: string): boolean {
  if (!groupId) return false;

  const storage = getStorage();
  if (!storage) return false;

  try {
    storage.removeItem(draftStorageKey(groupId));
    notify(groupId, "");
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribe to draft changes for a group. The listener receives the current
 * draft text (empty string after a clear) whenever it changes.
 *
 * @returns An unsubscribe function.
 */
export function subscribeDraft(
  groupId: string,
  listener: DraftListener,
): () => void {
  if (!groupId) return () => {};

  let listeners = listenersByGroup.get(groupId);
  if (!listeners) {
    listeners = new Set<DraftListener>();
    listenersByGroup.set(groupId, listeners);
  }
  listeners.add(listener);

  return () => {
    const current = listenersByGroup.get(groupId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listenersByGroup.delete(groupId);
  };
}

/** Remove every stored draft. Intended for testing and hard resets. */
export function clearAllDrafts(): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Ignore storage errors — nothing else we can do here.
  }

  for (const groupId of Array.from(listenersByGroup.keys())) {
    notify(groupId, "");
  }
}
