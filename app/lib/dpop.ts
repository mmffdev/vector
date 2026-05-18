// DPoP (RFC 9449) proof minting and keypair management — browser side.
// TD-SEC-DPOP-BINDING Phase 2 (2026-05-18).
//
// Lifecycle:
//   1. ensureKeypair(userId) — load existing CryptoKeyPair from
//      IndexedDB, or generate a fresh one. Tries ECDSA P-256 first
//      (compact ~230-byte proofs); falls back to RSA-2048 when the
//      runtime refuses to persist non-extractable EC keys (Firefox,
//      Safari). The private half is generated with extractable=false,
//      so even malicious in-page JS can sign with it but cannot
//      exfiltrate it.
//   2. mintProof(opts) — assembles the JWT (header { typ:"dpop+jwt",
//      alg, jwk } + payload { jti, htm, htu, iat, ath? }), signs with
//      the private key, returns the compact-serialised string. Each
//      call mints a unique jti so backend replay detection works.
//   3. clearKeypair(userId) — deletes the IDB record on logout, so a
//      following user doesn't inherit a binding.
//
// All exports are async because WebCrypto is async; the api.ts
// chokepoint awaits mintProof on every authed request. Cold-call cost
// is ~3-5 ms on a modern CPU (signing a ~200-byte payload); warm-call
// is similar because the same CryptoKey is reused.
//
// The corresponding backend validation library is
// backend/internal/auth/dpop.go (TD-SEC-DPOP-BINDING Phase 1).

import {
  DPOP_ANON_KEY,
  type DPoPAlg,
  type DPoPKeyRecord,
  deleteKeyRecord,
  listAllRecords,
  readKeyRecord,
  reparentKeyRecord,
  writeKeyRecord,
} from "./dpopStore";

// In-memory cache of the active keypair so mintProof doesn't hit
// IndexedDB on every request. Re-populated whenever ensureKeypair
// runs (login, boot, logout-then-login).
let _activeRecord: DPoPKeyRecord | null = null;
let _activeJWK: JsonWebKey | null = null;
let _activeJKT: string | null = null;

// ── public surface ──────────────────────────────────────────────────────────

export function isDPoPSupported(): boolean {
  // Only the WebCrypto half is load-bearing here. IndexedDB
  // availability is checked at the storage layer (dpopStore.ts) — if
  // it's not available the keypair lives only in-memory for the
  // session, which is enough for proof minting but means the user
  // re-binds on every reload. SSR has no crypto.subtle anyway, so
  // this check still short-circuits on the server.
  return typeof globalThis !== "undefined"
    && typeof globalThis.crypto !== "undefined"
    && typeof globalThis.crypto.subtle !== "undefined";
}

// ensureKeypair guarantees the in-memory cache holds a usable
// keypair for the given userId. If IDB has one, load it; if not,
// generate (preferring ECDSA, falling back to RSA when persistence of
// non-extractable EC keys fails) and persist. Idempotent — a second
// call with the same userId is a no-op.
export async function ensureKeypair(userId: string): Promise<void> {
  if (!isDPoPSupported()) {
    _activeRecord = null;
    _activeJWK = null;
    _activeJKT = null;
    return;
  }
  if (_activeRecord && _activeRecord.userId === userId) {
    return;
  }
  const existing = await readKeyRecord(userId);
  if (existing) {
    await setActive(existing);
    return;
  }
  const fresh = await generateAndStore(userId);
  if (fresh) {
    await setActive(fresh);
  }
}

// ensureAnyActiveKeypair is the bootstrap-path entry point: page
// reload found a session_alive cookie, we know there's a live
// session somewhere but we don't yet know which user it belongs to
// (that takes the /auth/refresh response). Find any keypair already
// in IDB and activate it; if none exists, generate an anon one.
// AuthContext.applyLogin will call reparentAnonKeypair afterwards if
// the user identity disagrees with the loaded record.
export async function ensureAnyActiveKeypair(): Promise<void> {
  if (!isDPoPSupported()) return;
  if (_activeRecord) return;
  const records = await listAllRecords();
  if (records.length > 0) {
    // Prefer a real-user record over the anon one (a leftover anon
    // record from an interrupted login flow should fall through to
    // regeneration on the next ensureKeypair call).
    const real = records.find((r) => r.userId !== DPOP_ANON_KEY);
    await setActive(real ?? records[0]);
    return;
  }
  const fresh = await generateAndStore(DPOP_ANON_KEY);
  if (fresh) await setActive(fresh);
}

// reparentAnonKeypair migrates the pre-login anonymous record under
// the real userId after the login response confirms identity. Called
// by AuthContext.applyLogin.
export async function reparentAnonKeypair(toUserId: string): Promise<void> {
  if (!isDPoPSupported()) return;
  await reparentKeyRecord(toUserId);
  // Force a reload from IDB so the in-memory cache picks up the new
  // userId on the record without us having to mutate it in place.
  const next = await readKeyRecord(toUserId);
  if (next) await setActive(next);
}

// clearKeypair drops the IndexedDB record and the in-memory cache for
// the given userId. Called by AuthContext.logout / hardLogout before
// the access token is cleared.
export async function clearKeypair(userId: string): Promise<void> {
  if (!isDPoPSupported()) return;
  await deleteKeyRecord(userId);
  if (_activeRecord && _activeRecord.userId === userId) {
    _activeRecord = null;
    _activeJWK = null;
    _activeJKT = null;
  }
}

// hasActiveKeypair tells api._fetch whether to bother awaiting
// mintProof. False on SSR, in private-mode IDB failure, or before the
// first ensureKeypair call.
export function hasActiveKeypair(): boolean {
  return _activeRecord !== null;
}

// getActiveJKT returns the RFC 7638 thumbprint of the currently
// active public key, suitable for sending to the backend during
// login so it can be stamped onto the session row and the access
// token's cnf claim. Returns null when no key is active.
export function getActiveJKT(): string | null {
  return _activeJKT;
}

export interface MintProofOpts {
  htm: string;       // HTTP method, uppercased internally
  htu: string;       // Full request URL — query/fragment stripped before signing
  accessToken?: string; // Present on all authed requests; absent on the login mint
}

// mintProof returns a freshly-signed DPoP-proof JWT string suitable
// for the `DPoP` header. Returns null if no keypair is active (the
// caller proceeds without the header — the backend's Phase 3
// middleware will then 401 the request, which is the intended
// failure mode for an unsigned authed call).
export async function mintProof(opts: MintProofOpts): Promise<string | null> {
  if (!_activeRecord || !_activeJWK) return null;

  const header = {
    typ: "dpop+jwt",
    alg: _activeRecord.alg,
    jwk: _activeJWK,
  };
  const payload: Record<string, unknown> = {
    jti: randomJTI(),
    htm: opts.htm.toUpperCase(),
    htu: stripHTUExtras(opts.htu),
    iat: Math.floor(Date.now() / 1000),
  };
  if (opts.accessToken) {
    payload.ath = await sha256Base64Url(opts.accessToken);
  }

  const signingInput =
    base64UrlEncodeJSON(header) + "." + base64UrlEncodeJSON(payload);
  const signature = await signWithKey(
    _activeRecord.keyPair.privateKey,
    _activeRecord.alg,
    signingInput,
  );
  return signingInput + "." + signature;
}

// ── internals ───────────────────────────────────────────────────────────────

async function setActive(record: DPoPKeyRecord): Promise<void> {
  _activeRecord = record;
  _activeJWK = await crypto.subtle.exportKey("jwk", record.keyPair.publicKey);
  // Strip implementation-specific JWK fields we don't want appearing
  // on the wire (alg/key_ops/ext can vary by browser and aren't part
  // of the RFC 7638 thumbprint inputs).
  _activeJWK = canonicaliseJWK(_activeJWK, record.alg);
  _activeJKT = await computeJKT(_activeJWK);
}

// generateAndStore generates a fresh keypair, tries to persist it,
// and returns the record on success. If neither algorithm survives
// IDB round-trip, returns null (caller should treat as "DPoP not
// available on this browser" and fall back to bearer-only).
async function generateAndStore(userId: string): Promise<DPoPKeyRecord | null> {
  // Try ECDSA P-256 first — preferred on Chrome (compact proofs,
  // <1 ms sign).
  let record = await tryAlg(userId, "ES256");
  if (record) return record;
  // Fall back to RSA-2048 — Firefox / Safari path.
  record = await tryAlg(userId, "RS256");
  return record;
}

// tryAlg generates a keypair of the given alg, attempts to persist
// it, and verifies persistence by reading it straight back. Returns
// the record on success, null on any failure (so the caller can
// fall through to the next alg).
async function tryAlg(userId: string, alg: DPoPAlg): Promise<DPoPKeyRecord | null> {
  let keyPair: CryptoKeyPair;
  try {
    if (alg === "ES256") {
      keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false, // non-extractable
        ["sign", "verify"],
      ) as CryptoKeyPair;
    } else {
      keyPair = await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]), // 65537
          hash: "SHA-256",
        },
        false, // non-extractable
        ["sign", "verify"],
      ) as CryptoKeyPair;
    }
  } catch {
    return null;
  }

  const record: DPoPKeyRecord = {
    alg,
    keyPair,
    createdAt: new Date().toISOString(),
    userId,
  };
  try {
    await writeKeyRecord(record);
  } catch {
    return null;
  }
  // Read-back probe: this is the Firefox/Safari ECDSA trap. The
  // engine accepts the put() and reports success, then the next
  // read returns null because non-extractable EC keys aren't
  // structured-cloneable. By checking now, before the next page
  // load, we can fall through to RSA on the spot.
  try {
    const back = await readKeyRecord(userId);
    if (!back || !back.keyPair || !back.keyPair.privateKey) {
      return null;
    }
    return back;
  } catch {
    return null;
  }
}

// canonicaliseJWK strips fields not required by RFC 7638 thumbprint
// computation so the JWK we put on the wire matches what the backend
// hashes. The backend's ComputeJKT only canonicalises the required
// members; if we include extras, the on-the-wire jwk and the
// backend-recomputed thumbprint of that jwk would still match (the
// backend hashes only required fields), but the wire payload is
// noisier than it needs to be.
function canonicaliseJWK(jwk: JsonWebKey, alg: DPoPAlg): JsonWebKey {
  if (alg === "ES256") {
    return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y } as JsonWebKey;
  }
  return { kty: "RSA", n: jwk.n, e: jwk.e } as JsonWebKey;
}

// computeJKT mirrors backend/internal/auth/dpop.go ComputeJKT exactly:
// SHA-256 over the canonical JSON of the required members, base64url
// no-padding. Hand-built JSON to guarantee key order matches the
// backend regardless of engine map iteration semantics.
async function computeJKT(jwk: JsonWebKey): Promise<string> {
  let canonical: string;
  if (jwk.kty === "EC") {
    canonical = `{"crv":${JSON.stringify(jwk.crv)},"kty":"EC","x":${JSON.stringify(jwk.x)},"y":${JSON.stringify(jwk.y)}}`;
  } else if (jwk.kty === "RSA") {
    canonical = `{"e":${JSON.stringify(jwk.e)},"kty":"RSA","n":${JSON.stringify(jwk.n)}}`;
  } else {
    throw new Error(`unsupported kty: ${jwk.kty}`);
  }
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return base64UrlFromBytes(new Uint8Array(buf));
}

// signWithKey produces the base64url-encoded compact JWS signature
// for the given signing input under the right algorithm. ECDSA needs
// the IEEE P1363 R||S concatenation (which is what WebCrypto returns
// already — DER conversion is NOT needed when paired with
// SubtleCrypto). RSA-PKCS1-v1_5 + SHA-256 maps directly to RS256.
async function signWithKey(
  privateKey: CryptoKey,
  alg: DPoPAlg,
  input: string,
): Promise<string> {
  const data = new TextEncoder().encode(input);
  let sig: ArrayBuffer;
  if (alg === "ES256") {
    sig = await crypto.subtle.sign(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      privateKey,
      data,
    );
  } else {
    sig = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      privateKey,
      data,
    );
  }
  return base64UrlFromBytes(new Uint8Array(sig));
}

// base64UrlEncodeJSON serialises a JSON-shaped value and returns its
// base64url-no-padding encoding. Used for compact-JWS header and
// payload segments.
function base64UrlEncodeJSON(value: unknown): string {
  const json = JSON.stringify(value);
  return base64UrlFromBytes(new TextEncoder().encode(json));
}

// base64UrlFromBytes encodes a Uint8Array as base64url without
// padding. We hand-implement to avoid pulling in a dependency for
// what is ~6 lines of straightforward string surgery.
function base64UrlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = (typeof btoa !== "undefined" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64"));
  return b64.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function sha256Base64Url(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return base64UrlFromBytes(new Uint8Array(buf));
}

// randomJTI returns a fresh RFC 4122 v4 UUID for the proof's jti
// claim. crypto.randomUUID is available in every browser that
// supports WebCrypto, so we don't need a polyfill here.
function randomJTI(): string {
  return crypto.randomUUID();
}

// stripHTUExtras drops query and fragment for the htu claim, mirroring
// stripHTUExtras in backend/internal/auth/dpop.go.
function stripHTUExtras(u: string): string {
  const i = u.search(/[?#]/);
  return i < 0 ? u : u.substring(0, i);
}

// Re-export the anon-key sentinel so AuthContext can pass it to
// ensureKeypair before the user identity is known.
export { DPOP_ANON_KEY };
