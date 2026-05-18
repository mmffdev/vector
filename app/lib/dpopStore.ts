// IndexedDB store for DPoP (RFC 9449) signing keypairs.
//
// One record per userId. The record holds the WebCrypto CryptoKeyPair
// itself (not raw key material) — browsers serialise CryptoKey objects
// into IndexedDB by reference, and we generate the private half with
// `extractable: false` so the key can be SIGNED with but never
// EXPORTED. An XSS payload or a malicious extension can read this
// store but cannot exfiltrate the signing material; the strongest
// thing it could do is sign one extra request from the user's browser
// before logout clears it.
//
// Browser support per the plan:
//   - Chrome: store ECDSA P-256 keys (compact proofs).
//   - Firefox / Safari: fall back to RSA-2048 (those engines refuse
//     to serialise non-extractable EC private keys; the alg field on
//     the record carries the choice forward).
// The choice is made by app/lib/dpop.ts at generateKey time; this
// module just persists whatever it's given.
//
// Modelled on app/lib/draftStore.ts (TD-SEC-DPOP-BINDING Phase 2,
// 2026-05-18).

const DB_NAME = "vector-dpop";
const STORE = "keypairs";
const DB_VERSION = 1;

export type DPoPAlg = "ES256" | "RS256";

export interface DPoPKeyRecord {
  alg: DPoPAlg;
  keyPair: CryptoKeyPair;
  createdAt: string;
  userId: string;
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

// Pre-login the user has no userId yet, so the initial keypair lives
// under this sentinel key. AuthContext re-keys it under the real
// userId after successful auth.
export const DPOP_ANON_KEY = "_anonymous";

export async function readKeyRecord(userId: string): Promise<DPoPKeyRecord | null> {
  return tx<DPoPKeyRecord>("readonly", (s) => s.get(userId));
}

export async function writeKeyRecord(record: DPoPKeyRecord): Promise<void> {
  await tx("readwrite", (s) => s.put(record, record.userId));
}

// Reparent the anon record under the real userId post-auth. Done in
// one transaction so we don't briefly hold the keypair under both
// keys or, worse, lose it between calls. Falls back to no-op if IDB
// is unavailable — caller will regenerate on next load.
export async function reparentKeyRecord(toUserId: string): Promise<void> {
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
      const getReq = store.get(DPOP_ANON_KEY);
      getReq.onsuccess = () => {
        const rec = getReq.result as DPoPKeyRecord | undefined;
        if (!rec) {
          resolve();
          return;
        }
        const reparented: DPoPKeyRecord = { ...rec, userId: toUserId };
        const put = store.put(reparented, toUserId);
        put.onsuccess = () => {
          const del = store.delete(DPOP_ANON_KEY);
          del.onsuccess = () => resolve();
          del.onerror = () => resolve();
        };
        put.onerror = () => resolve();
      };
      getReq.onerror = () => resolve();
    });
  });
}

// Delete a specific user's record. Called by AuthContext on logout
// (and hardLogout) before clearing the in-memory access token.
export async function deleteKeyRecord(userId: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(userId));
}

// listAllRecords returns every keypair record currently stored. Used
// by ensureAnyActiveKeypair on page bootstrap when we know the user
// has a live session (session_alive cookie set) but haven't yet
// resolved the userId from the refresh response. The record carries
// the userId so the caller can match it to the eventual /auth/refresh
// response.
export async function listAllRecords(): Promise<DPoPKeyRecord[]> {
  return new Promise((resolve) => {
    openDB().then((db) => {
      if (!db) {
        resolve([]);
        return;
      }
      let store: IDBObjectStore;
      try {
        store = db.transaction(STORE, "readonly").objectStore(STORE);
      } catch {
        resolve([]);
        return;
      }
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as DPoPKeyRecord[]) ?? []);
      req.onerror = () => resolve([]);
    });
  });
}
