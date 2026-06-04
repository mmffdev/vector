import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/app/contexts/AuthContext";
import { installFetchStub, restoreFetch } from "@/app/lib/__tests__/_fetchStub";
import { __setLocksForTest, AUTH_CHANNEL_NAME, type AuthChannelMessage } from "@/app/lib/authChannel";
import { setApiToken, setHardLogoutCallback, getHardLogoutCallback } from "@/app/lib/api";

// REGRESSION (2026-06-04): the cross-tab coordinator broadcast a `logout`
// from BOTH voluntary logout() AND involuntary hardLogout(). hardLogout is
// the backend-driven path (WS idle-close code 4002, terminal-401), so an
// involuntary single-session death in ONE tab cascaded to a forced
// /login redirect in EVERY tab — "all browsers logged themselves out after
// a few minutes with no user action." The contract: voluntary logout
// propagates across tabs; involuntary hardLogout does NOT (each tab
// validates its own session on its next request — the backend is the gate
// per tab).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

let logoutFn: (() => Promise<void>) | null = null;
function Harness() {
  const { logout } = useAuth();
  logoutFn = logout;
  return null;
}

describe("AuthContext.no-cascade involuntary hardLogout does NOT broadcast", () => {
  let observed: AuthChannelMessage[];
  let observer: BroadcastChannel;
  beforeEach(() => {
    __setLocksForTest({
      request: async (_n: string, _o: unknown, cb?: () => Promise<void>) => { if (cb) await cb(); },
    });
    // Installed for side effects: stubs the /auth/logout POST that logout()
    // and hardLogout() fire, so the test doesn't hit a real network.
    installFetchStub();
    observed = [];
    // A sibling-tab observer: BroadcastChannel does not self-deliver, so a
    // second channel captures exactly what the provider posted.
    observer = new BroadcastChannel(AUTH_CHANNEL_NAME);
    observer.onmessage = (e) => observed.push(e.data as AuthChannelMessage);
  });
  afterEach(() => {
    __setLocksForTest(undefined);
    restoreFetch();
    setApiToken(null);
    setHardLogoutCallback(null);
    observer.close();
  });

  it("hardLogout() does NOT post a logout message to sibling tabs", async () => {
    render(<AuthProvider><Harness /></AuthProvider>);
    // AuthProvider registers hardLogout with api.ts on mount; grab it.
    const hardLogout = getHardLogoutCallback();
    expect(hardLogout).not.toBeNull();

    await act(async () => {
      await hardLogout!("session_idle_expired");
      await new Promise((r) => setTimeout(r, 0));
    });

    // The involuntary path must NOT broadcast logout — no cascade.
    expect(observed.filter((m) => m.type === "logout")).toHaveLength(0);
  });

  it("voluntary logout() STILL posts a logout message (intended propagation)", async () => {
    render(<AuthProvider><Harness /></AuthProvider>);
    expect(logoutFn).not.toBeNull();

    await act(async () => {
      await logoutFn!();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(observed.filter((m) => m.type === "logout")).toHaveLength(1);
  });
});
