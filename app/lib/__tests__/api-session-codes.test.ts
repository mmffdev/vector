import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError, apiSite, setApiToken, setRefreshCallback, setHardLogoutCallback } from "@/app/lib/api";
import { installFetchStub, restoreFetch, type FetchStub } from "./_fetchStub";

// B16.8.11 step 4 — wire-shape contract for session-state 401 routing.
//
// The backend (step 3) emits Problem.code = "session_revoked" or
// "session_idle_expired" on 401 responses when middleware rejects an
// otherwise-valid access token because the session was revoked or has
// gone idle past SESSION_IDLE_TTL. The frontend MUST:
//   1. Surface that `code` on the thrown ApiError so callers can branch
//      on machine-readable identity, not parse `detail` strings.
//   2. NOT trigger the silent refresh-and-retry on those codes — refresh
//      would also 401 (same revoked session) and the user would land in
//      an infinite loop. Instead, the 401 must propagate out so the
//      hard-logout flow can kick in.
//
// These tests pin both contracts. They fail BEFORE step 4's
// implementation lands; they pass after.

describe("ApiError surfaces Problem.code", () => {
  let stub: FetchStub;
  beforeEach(() => {
    stub = installFetchStub();
    setApiToken("dummy-access-token");
    setRefreshCallback(null); // disable silent refresh so we get the raw error
  });
  afterEach(() => {
    setApiToken(null);
    setRefreshCallback(null);
    restoreFetch();
  });

  it("extracts `code` from a Problem body so callers can branch on it", async () => {
    stub.queue.push({
      status: 401,
      body: {
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        code: "session_revoked",
        detail: "Your session was ended (signed out from another device or revoked by an admin). Please sign in again.",
        instance: "/_site/me/profile",
      },
    });

    let caught: unknown;
    try {
      await apiSite("/me/profile");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.status).toBe(401);
    // The contract: machine-readable code is on the ApiError, not buried
    // in the detail string.
    expect(err.code).toBe("session_revoked");
  });

  it("leaves `code` undefined when the Problem body omits it (back-compat)", async () => {
    stub.queue.push({
      status: 403,
      body: {
        type: "about:blank",
        title: "Forbidden",
        status: 403,
        detail: "You don't have permission to do that.",
        instance: "/_site/admin/something",
      },
    });

    let caught: unknown;
    try {
      await apiSite("/admin/something");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBeUndefined();
  });
});

describe("session_revoked / session_idle_expired skip silent refresh", () => {
  let stub: FetchStub;
  let refreshCalls: number;
  let hardLogoutCalls: string[];
  beforeEach(() => {
    stub = installFetchStub();
    setApiToken("dummy-access-token");
    refreshCalls = 0;
    hardLogoutCalls = [];
    setRefreshCallback(async () => {
      refreshCalls += 1;
    });
    setHardLogoutCallback(async (reason) => {
      hardLogoutCalls.push(reason);
    });
  });
  afterEach(() => {
    setApiToken(null);
    setRefreshCallback(null);
    setHardLogoutCallback(null);
    restoreFetch();
  });

  it("does NOT trigger refresh-and-retry on code=session_revoked", async () => {
    stub.queue.push({
      status: 401,
      body: {
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        code: "session_revoked",
        detail: "...",
        instance: "/_site/me/profile",
      },
    });

    await expect(apiSite("/me/profile")).rejects.toBeInstanceOf(ApiError);
    expect(refreshCalls).toBe(0); // refresh was NOT called
    expect(stub.calls).toHaveLength(1); // no retry fetch either
    expect(hardLogoutCalls).toEqual(["session_revoked"]); // hardLogout fired with reason
  });

  it("does NOT trigger refresh-and-retry on code=session_idle_expired", async () => {
    stub.queue.push({
      status: 401,
      body: {
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        code: "session_idle_expired",
        detail: "...",
        instance: "/_site/me/profile",
      },
    });

    await expect(apiSite("/me/profile")).rejects.toBeInstanceOf(ApiError);
    expect(refreshCalls).toBe(0);
    expect(stub.calls).toHaveLength(1);
    expect(hardLogoutCalls).toEqual(["session_idle_expired"]);
  });

  it("STILL triggers refresh-and-retry on a generic 401 (back-compat)", async () => {
    // Generic 401 (no code) — original silent-refresh path must still
    // fire. First call returns 401; refresh registers a "new token";
    // second call (retry) returns 200.
    stub.queue.push({
      status: 401,
      body: {
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "JWT expired",
        instance: "/_site/me/profile",
      },
    });
    stub.queue.push({ status: 200, body: { ok: true } });

    // Replace the no-op refresh with one that sets a new token so the
    // retry path can proceed (the production AuthContext does this via
    // applyLogin).
    setRefreshCallback(async () => {
      refreshCalls += 1;
      setApiToken("new-token-after-refresh");
    });

    const result = await apiSite<{ ok: boolean }>("/me/profile");
    expect(result.ok).toBe(true);
    expect(refreshCalls).toBe(1);
    expect(stub.calls).toHaveLength(2); // initial + retry
  });
});
