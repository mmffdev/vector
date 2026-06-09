// cpAuth.test.ts — PLAT1.9 unit coverage for the CP relying-party module.
//
// Covers the parts that don't need a full browser navigation: the flag gate
// (default OFF, the safety property), the redirect-URI shape (points at the
// form_post bridge, never the client page), and that beginCpLogin is a no-op
// when the flag is off. The full redirect + token exchange is exercised live by
// the platform repo's e2e (products/stub-rp is the reference RP).

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

describe("cpAuth flag gate", () => {
  const ORIG = process.env.NEXT_PUBLIC_CP_AUTH_ENABLED;
  afterEach(() => {
    process.env.NEXT_PUBLIC_CP_AUTH_ENABLED = ORIG;
    vi.resetModules();
  });

  async function load() {
    return await import("@/app/lib/cpAuth");
  }

  test("cpAuthEnabled defaults OFF when the flag is unset", async () => {
    delete process.env.NEXT_PUBLIC_CP_AUTH_ENABLED;
    vi.resetModules();
    const { cpAuthEnabled } = await load();
    expect(cpAuthEnabled()).toBe(false);
  });

  test("cpAuthEnabled is OFF for arbitrary non-truthy values", async () => {
    for (const v of ["", "false", "0", "no", "off", "maybe"]) {
      process.env.NEXT_PUBLIC_CP_AUTH_ENABLED = v;
      vi.resetModules();
      const { cpAuthEnabled } = await load();
      expect(cpAuthEnabled(), `value=${v}`).toBe(false);
    }
  });

  test("cpAuthEnabled is ON only for true/1/yes (case-insensitive)", async () => {
    for (const v of ["true", "TRUE", "1", "yes", "Yes"]) {
      process.env.NEXT_PUBLIC_CP_AUTH_ENABLED = v;
      vi.resetModules();
      const { cpAuthEnabled } = await load();
      expect(cpAuthEnabled(), `value=${v}`).toBe(true);
    }
  });
});

describe("cpAuth redirect URI", () => {
  beforeEach(() => {
    // jsdom provides window.location; pin a deterministic origin.
    Object.defineProperty(window, "location", {
      value: { origin: "https://vector.example", assign: vi.fn() },
      writable: true,
    });
  });

  test("redirect URI targets the form_post bridge route, not the client page", async () => {
    vi.resetModules();
    const { cpRedirectUri } = await import("@/app/lib/cpAuth");
    // Must be the server route handler that receives the POST and bridges to the
    // client page (PLA-0053-clean) — NOT /cp/callback directly.
    expect(cpRedirectUri()).toBe("https://vector.example/api/cp/callback");
  });
});

describe("beginCpLogin safety", () => {
  test("is a no-op (no navigation) when the flag is OFF", async () => {
    delete process.env.NEXT_PUBLIC_CP_AUTH_ENABLED;
    vi.resetModules();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      value: { origin: "https://vector.example", assign },
      writable: true,
    });
    const { beginCpLogin } = await import("@/app/lib/cpAuth");
    await beginCpLogin();
    expect(assign).not.toHaveBeenCalled();
  });

  test("navigates to the CP /authorize with PKCE + form_post when ON", async () => {
    process.env.NEXT_PUBLIC_CP_AUTH_ENABLED = "true";
    process.env.NEXT_PUBLIC_CP_BASE_URL = "https://cp.example";
    vi.resetModules();
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      value: { origin: "https://vector.example", assign },
      writable: true,
    });
    const { beginCpLogin } = await import("@/app/lib/cpAuth");
    await beginCpLogin();
    expect(assign).toHaveBeenCalledOnce();
    const url = new URL(assign.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://cp.example/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("response_mode")).toBe("form_post");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toBe("https://vector.example/api/cp/callback");
  });
});

describe("refreshCpSession (PLAT1.12 CP-owned refresh)", () => {
  // Mock the IDB key store so the test doesn't need real IndexedDB. The keypair
  // is a real WebCrypto ES256 key so mintDpopProof signs successfully.
  vi.mock("@/app/lib/dpopStore", () => ({
    readKeyRecord: vi.fn(),
    writeKeyRecord: vi.fn(),
    pruneKeysExcept: vi.fn(),
  }));

  beforeEach(() => {
    process.env.NEXT_PUBLIC_CP_AUTH_ENABLED = "true";
    process.env.NEXT_PUBLIC_CP_BASE_URL = "https://cp.example";
    Object.defineProperty(window, "location", {
      value: { origin: "https://vector.example", assign: vi.fn() },
      writable: true,
    });
    sessionStorage.clear();
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns null when there is no stored refresh token", async () => {
    const { refreshCpSession } = await import("@/app/lib/cpAuth");
    const out = await refreshCpSession("user-1");
    expect(out).toBeNull();
  });

  test("rotates against the CP and returns the new access token", async () => {
    sessionStorage.setItem("vector.cp.refresh_token", "rt-old");
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
    );
    const store = await import("@/app/lib/dpopStore");
    (store.readKeyRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      alg: "ES256", keyPair, userId: "user-1", createdAt: "now",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "new-access", refresh_token: "rt-new" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { refreshCpSession } = await import("@/app/lib/cpAuth");
    const out = await refreshCpSession("user-1");
    expect(out).toBe("new-access");
    // The rotated refresh token replaced the old one.
    expect(sessionStorage.getItem("vector.cp.refresh_token")).toBe("rt-new");
    // The request hit the CP /token with grant_type=refresh_token + a DPoP proof.
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.DPoP).toBeTruthy();
    expect(opts.body).toContain("grant_type=refresh_token");
  });

  test("clears the dead token and returns null when the CP rejects the refresh", async () => {
    sessionStorage.setItem("vector.cp.refresh_token", "rt-dead");
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
    );
    const store = await import("@/app/lib/dpopStore");
    (store.readKeyRecord as ReturnType<typeof vi.fn>).mockResolvedValue({
      alg: "ES256", keyPair, userId: "user-1", createdAt: "now",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    const { refreshCpSession } = await import("@/app/lib/cpAuth");
    const out = await refreshCpSession("user-1");
    expect(out).toBeNull();
    expect(sessionStorage.getItem("vector.cp.refresh_token")).toBeNull();
  });
});
