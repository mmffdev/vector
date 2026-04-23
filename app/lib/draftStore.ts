// Tiny IndexedDB wrapper for form-draft persistence.
// Single object store keyed by `${userId}:${formKey}:${scopeKey ?? '_'}`.
// All operations degrade to no-op resolves when IDB is unavailable
// (private/incognito mode, SSR, denied storage).

const DB_NAME = "vector-drafts";
const STORE = "forms";
const DB_VERSION = 1;

export const DRAFT_SCHEMA_VERSION = 1;

export interface DraftRecord<T = unknown> {
  formKey: string;
  scopeKey: string | null;
  values: T;
  savedAt: string;
  userId: string;
  schemaVersion: number;
}

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!idbAvailable()) {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | null> {
  return new Promise((resolve) => {
    openDB().then((db) => {
      if (!db) {
        resolve(null);
        return;
      }
      let store: IDBObjectStore;
      try {
        store = db.transaction(STORE, mode).objectStore(STORE);
      } catch {
        resolve(null);
        return;
      }
      const req = fn(store);
      if (!req) {
        resolve(null);
        return;
      }
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  });
}

export function draftKey(userId: string, formKey: string, scopeKey: string | null): string {
  return `${userId}:${formKey}:${scopeKey ?? "_"}`;
}

export async function readDraft<T>(
  userId: string,
  formKey: string,
  scopeKey: string | null,
): Promise<DraftRecord<T> | null> {
  const rec = await tx<DraftRecord<T>>("readonly", (s) => s.get(draftKey(userId, formKey, scopeKey)));
  if (!rec) return null;
  if (rec.schemaVersion !== DRAFT_SCHEMA_VERSION) return null;
  if (rec.userId !== userId) return null;
  return rec;
}

export async function writeDraft<T>(rec: DraftRecord<T>): Promise<void> {
  await tx("readwrite", (s) => s.put(rec, draftKey(rec.userId, rec.formKey, rec.scopeKey)));
}

export async function deleteDraft(
  userId: string,
  formKey: string,
  scopeKey: string | null,
): Promise<void> {
  await tx("readwrite", (s) => s.delete(draftKey(userId, formKey, scopeKey)));
}

// Purge every draft owned by the given userId. Used on logout so a draft
// authored by user A is never visible to user B on the same browser.
export async function purgeDraftsFor(userId: string): Promise<void> {
  const prefix = `${userId}:`;
  await new Promise<void>((resolve) => {
    openDB().then((db) => {
      if (!db) {
        resolve();
        return;
      }
      let store: IDBObjectStore;
      try {
        store = db.transaction(STORE, "readwrite").objectStore(STORE);
      } catch {
        resolve();
        return;
      }
      const req = store.openKeyCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const k = String(cursor.key);
        if (k.startsWith(prefix)) cursor.delete();
        cursor.continue();
      };
      req.onerror = () => resolve();
    });
  });
}
