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
