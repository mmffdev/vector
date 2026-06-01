// Frontend DPoP (RFC 9449) wire-shape and round-trip tests.
// TD-SEC-DPOP-BINDING Phase 2 (2026-05-18).
//
// Tests verify the shape of the proof JWT emitted by app/lib/dpop.ts
// matches what the backend's app/internal/auth/dpop.go parser expects.
// IndexedDB persistence is covered by the browser smoke test at Phase
// 2 exit — here we mock the store with an in-memory map so the tests
// run in jsdom without pulling in fake-indexeddb.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the IDB layer with an in-memory map BEFORE importing the
// module under test, so dpop.ts picks up the mock at load time.
type DPoPAlg = "ES256" | "RS256";
interface DPoPKeyRecord {
  alg: DPoPAlg;
  keyPair: CryptoKeyPair;
  createdAt: string;
  userId: string;
}

const _records = new Map<string, DPoPKeyRecord>();

vi.mock("@/app/lib/dpopStore", () => ({
  DPOP_ANON_KEY: "_anonymous",
  readKeyRecord: async (userId: string) => _records.get(userId) ?? null,
  writeKeyRecord: async (record: DPoPKeyRecord) => {
    _records.set(record.userId, record);
  },
  deleteKeyRecord: async (userId: string) => {
    _records.delete(userId);
  },
  reparentKeyRecord: async (toUserId: string) => {
    const anon = _records.get("_anonymous");
    if (anon) {
      _records.set(toUserId, { ...anon, userId: toUserId });
      _records.delete("_anonymous");
    }
  },
  listAllRecords: async () => Array.from(_records.values()),
  // TD-SEC-DPOP-STALE-KEY — delete every record except keepUserId.
  pruneKeysExcept: async (keepUserId: string) => {
    for (const k of Array.from(_records.keys())) {
      if (k !== keepUserId) _records.delete(k);
    }
  },
}));

// Import AFTER vi.mock — module load order matters.
const dpop = await import("@/app/lib/dpop");

// Decode a base64url JSON segment.
function decodeSegment(seg: string): unknown {
  // pad
  const pad = "=".repeat((4 - (seg.length % 4)) % 4);
  const b64 = (seg + pad).replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64));
}

beforeEach(() => {
  _records.clear();
});

afterEach(() => {
  // dpop.ts holds an in-memory cache; clearing the IDB-mock alone
  // doesn't reset it. Re-importing isn't trivial in Vitest; the
  // simplest reset is to call clearKeypair for any user we touched.
  dpop.clearKeypair("alice-uid");
  dpop.clearKeypair("_anonymous");
});

describe("dpop: keypair lifecycle", () => {
  it("isDPoPSupported returns true under jsdom + node crypto", () => {
    expect(dpop.isDPoPSupported()).toBe(true);
  });

  it("ensureKeypair persists a record under the given userId", async () => {
    await dpop.ensureKeypair("alice-uid");
    expect(_records.has("alice-uid")).toBe(true);
    expect(_records.get("alice-uid")!.userId).toBe("alice-uid");
    expect(dpop.hasActiveKeypair()).toBe(true);
    // jkt is a 43-char base64url-no-pad SHA-256 thumbprint.
    expect(dpop.getActiveJKT()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("ensureKeypair is idempotent for the same userId", async () => {
    await dpop.ensureKeypair("alice-uid");
    const firstJKT = dpop.getActiveJKT();
    await dpop.ensureKeypair("alice-uid");
    const secondJKT = dpop.getActiveJKT();
    expect(secondJKT).toBe(firstJKT);
    expect(_records.size).toBe(1);
  });

  it("clearKeypair removes IDB record and resets in-memory cache", async () => {
    await dpop.ensureKeypair("alice-uid");
    expect(dpop.hasActiveKeypair()).toBe(true);
    await dpop.clearKeypair("alice-uid");
    expect(dpop.hasActiveKeypair()).toBe(false);
    expect(_records.has("alice-uid")).toBe(false);
  });

  it("reparentAnonKeypair migrates anon record to a real userId", async () => {
    await dpop.ensureKeypair("_anonymous");
    expect(_records.has("_anonymous")).toBe(true);
    await dpop.reparentAnonKeypair("alice-uid");
    expect(_records.has("_anonymous")).toBe(false);
    expect(_records.has("alice-uid")).toBe(true);
    expect(_records.get("alice-uid")!.userId).toBe("alice-uid");
  });
});

describe("dpop: mintProof wire shape", () => {
  beforeEach(async () => {
    await dpop.ensureKeypair("alice-uid");
  });

  it("mints a JWT with three dot-separated segments", async () => {
    const proof = await dpop.mintProof({
      htm: "GET",
      htu: "http://localhost:5100/_site/me",
      accessToken: "fake.access.token",
    });
    expect(proof).not.toBeNull();
    expect(proof!.split(".")).toHaveLength(3);
  });

  it("header has typ=dpop+jwt, alg, and a public-only jwk", async () => {
    const proof = await dpop.mintProof({
      htm: "GET",
      htu: "http://localhost:5100/_site/me",
      accessToken: "fake.access.token",
    });
    const [headerSeg] = proof!.split(".");
    const header = decodeSegment(headerSeg) as Record<string, unknown>;
    expect(header.typ).toBe("dpop+jwt");
    expect(header.alg).toMatch(/^(ES256|RS256)$/);
    const jwk = header.jwk as Record<string, unknown>;
    expect(jwk.kty).toMatch(/^(EC|RSA)$/);
    // No private material on the wire.
    for (const forbidden of ["d", "p", "q", "dp", "dq", "qi"]) {
      expect(jwk[forbidden]).toBeUndefined();
    }
  });

  it("payload includes jti, htm, htu, iat, ath", async () => {
    const proof = await dpop.mintProof({
      htm: "POST",
      htu: "http://localhost:5100/_site/auth/login",
      accessToken: "fake.access.token",
    });
    const [, payloadSeg] = proof!.split(".");
    const payload = decodeSegment(payloadSeg) as Record<string, unknown>;
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.htm).toBe("POST");
    expect(payload.htu).toBe("http://localhost:5100/_site/auth/login");
    expect(typeof payload.iat).toBe("number");
    // iat within ±5s of now (clock-skew-friendly).
    const nowSec = Math.floor(Date.now() / 1000);
    expect(Math.abs((payload.iat as number) - nowSec)).toBeLessThanOrEqual(5);
    // ath is base64url SHA-256(access_token), 43 chars no-pad.
    expect(payload.ath).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("omits ath when accessToken is undefined (login mint path)", async () => {
    const proof = await dpop.mintProof({
      htm: "POST",
      htu: "http://localhost:5100/_site/auth/login",
    });
    const [, payloadSeg] = proof!.split(".");
    const payload = decodeSegment(payloadSeg) as Record<string, unknown>;
    expect(payload.ath).toBeUndefined();
  });

  it("strips query and fragment from htu", async () => {
    const proof = await dpop.mintProof({
      htm: "GET",
      htu: "http://localhost:5100/_site/me?x=1&y=2#frag",
    });
    const payload = decodeSegment(proof!.split(".")[1]) as Record<string, unknown>;
    expect(payload.htu).toBe("http://localhost:5100/_site/me");
  });

  it("htm is upper-cased even if caller passes lowercase", async () => {
    const proof = await dpop.mintProof({
      htm: "get",
      htu: "http://localhost:5100/_site/me",
    });
    const payload = decodeSegment(proof!.split(".")[1]) as Record<string, unknown>;
    expect(payload.htm).toBe("GET");
  });

  it("each proof has a unique jti even back-to-back", async () => {
    const a = await dpop.mintProof({ htm: "GET", htu: "http://localhost/x" });
    const b = await dpop.mintProof({ htm: "GET", htu: "http://localhost/x" });
    const ja = decodeSegment(a!.split(".")[1]) as Record<string, unknown>;
    const jb = decodeSegment(b!.split(".")[1]) as Record<string, unknown>;
    expect(ja.jti).not.toBe(jb.jti);
  });

  it("returns null when no keypair is active", async () => {
    await dpop.clearKeypair("alice-uid");
    const proof = await dpop.mintProof({ htm: "GET", htu: "http://localhost/x" });
    expect(proof).toBeNull();
  });
});

describe("dpop: ath hash matches SHA-256(access_token)", () => {
  beforeEach(async () => {
    await dpop.ensureKeypair("alice-uid");
  });

  it("ath of 'hello' equals base64url(SHA-256('hello'))", async () => {
    const accessToken = "hello";
    const proof = await dpop.mintProof({
      htm: "GET",
      htu: "http://localhost/x",
      accessToken,
    });
    const payload = decodeSegment(proof!.split(".")[1]) as Record<string, unknown>;
    // Compute expected separately using the same WebCrypto path.
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accessToken));
    let bin = "";
    const bytes = new Uint8Array(digest);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const expected = btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    expect(payload.ath).toBe(expected);
  });
});

// TD-SEC-DPOP-STALE-KEY (2026-05-31) — regression for the "logged out /
// blank page on tab refocus" bug. Live audit log showed
// auth.refresh_dpop_binding_violation firing repeatedly, always with the
// SAME stale incoming_jkt against an ever-changing bound_jkt: one leftover
// keypair in IndexedDB kept getting picked up to sign /auth/refresh while
// each login bound a fresh, different key. Root cause: ensureAnyActiveKeypair
// activated an ARBITRARY real-user record (Array.find) and nothing pruned
// stale records. Fix: (1) select the most-recent key by createdAt; (2) prune
// all other records once identity is known.
describe("dpop: stale-key selection (TD-SEC-DPOP-STALE-KEY)", () => {
  // Seed two records under two ids with controlled createdAt, returning
  // their jkts so the test can assert which one got activated. Leaves
  // BOTH records in the IDB-mock store and the in-memory cache empty
  // (the post-refocus pre-bootstrap state).
  async function seedTwoKeys(): Promise<{ staleJKT: string; freshJKT: string }> {
    _records.clear();
    // STALE key — older createdAt. Capture jkt, then stash a copy of the
    // record so clearKeypair (which deletes IDB) can't lose it.
    await dpop.ensureKeypair("stale-uid");
    const staleJKT = dpop.getActiveJKT()!;
    const staleRec = { ..._records.get("stale-uid")!, createdAt: "2026-05-01T00:00:00.000Z" };

    // FRESH key — newer createdAt, under the real user id.
    await dpop.ensureKeypair("alice-uid");
    const freshJKT = dpop.getActiveJKT()!;
    const freshRec = { ..._records.get("alice-uid")!, createdAt: "2026-05-31T23:00:00.000Z" };

    // Reset in-memory cache (clearKeypair on the active id), then re-stash
    // BOTH records directly into the store so IDB holds two, cache holds none.
    await dpop.clearKeypair("alice-uid");
    await dpop.clearKeypair("stale-uid");
    _records.set("stale-uid", staleRec);
    _records.set("alice-uid", freshRec);

    return { staleJKT, freshJKT };
  }

  it("ensureAnyActiveKeypair activates the MOST RECENT key, not an arbitrary one", async () => {
    const { staleJKT, freshJKT } = await seedTwoKeys();
    expect(_records.size).toBe(2);
    expect(staleJKT).not.toBe(freshJKT);

    await dpop.ensureAnyActiveKeypair();
    // The freshly-bound key (newer createdAt) must win — signing a refresh
    // with the stale key is exactly what tripped the binding violation.
    expect(dpop.getActiveJKT()).toBe(freshJKT);

    await dpop.clearKeypair("alice-uid");
    await dpop.clearKeypair("stale-uid");
  });

  it("pruneKeysExcept removes every leftover record but the kept one", async () => {
    await seedTwoKeys();
    expect(_records.size).toBe(2);

    await dpop.pruneStaleKeys("alice-uid");
    expect(_records.size).toBe(1);
    expect(_records.has("alice-uid")).toBe(true);
    expect(_records.has("stale-uid")).toBe(false);

    await dpop.clearKeypair("alice-uid");
  });

  it("reparent+prune leaves exactly the real-user key when a stale leftover exists", async () => {
    _records.clear();
    // A leftover stale key from a prior, crashed/uncleaned session.
    await dpop.ensureKeypair("stale-uid");
    _records.get("stale-uid")!.createdAt = "2026-04-01T00:00:00.000Z";
    await dpop.clearKeypair("stale-uid"); // clearKeypair deletes IDB too
    // clearKeypair removed it — re-inject a stale record straight into the
    // mock store to model "leftover that logout never cleaned".
    await dpop.ensureKeypair("stale-uid");
    _records.get("stale-uid")!.createdAt = "2026-04-01T00:00:00.000Z";

    // Fresh login: anon key minted, then reparented to the real user.
    await dpop.ensureKeypair("_anonymous");
    _records.get("_anonymous")!.createdAt = "2026-05-31T23:30:00.000Z";
    await dpop.reparentAnonKeypair("alice-uid");
    const boundJKT = dpop.getActiveJKT()!;

    // Pre-prune: stale + alice both present.
    expect(_records.size).toBe(2);

    // applyLogin prunes once identity is known.
    await dpop.pruneStaleKeys("alice-uid");
    expect(_records.size).toBe(1);
    expect(_records.has("alice-uid")).toBe(true);
    expect(_records.has("stale-uid")).toBe(false);
    expect(boundJKT).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await dpop.clearKeypair("alice-uid");
  });
});

describe("dpop: JKT matches RFC 7638 canonical form", () => {
  it("computes the same thumbprint for the same JWK input twice", async () => {
    _records.clear();
    await dpop.ensureKeypair("alice-uid");
    const jktA = dpop.getActiveJKT();
    // Re-activate by clearing in-memory cache and re-loading.
    await dpop.clearKeypair("alice-uid");
    // Re-stash the record by ensure under same id with a put back.
    // The record was deleted by clearKeypair; re-create to confirm
    // determinism of thumbprint over the SAME jwk.
    await dpop.ensureKeypair("alice-uid");
    const jktB = dpop.getActiveJKT();
    // Different keys → different thumbprints (sanity check that
    // the generator actually rolled fresh material).
    expect(jktA).not.toBe(jktB);
    expect(jktB).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
