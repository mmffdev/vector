import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleSessionCloseCode, WS_CLOSE_SESSION_REVOKED, WS_CLOSE_SESSION_IDLE_EXPIRED } from "@/app/lib/wsClose";
import { setHardLogoutCallback } from "@/app/lib/api";

// B16.8.12 — WS close-code → hardLogout reason mapping.
//
// When the WS session sweeper closes a connection because the issuing
// users_sessions row was revoked or went idle past SESSION_IDLE_TTL, the
// backend writes a close frame with a private 4xxx code:
//
//   4001 → "session_revoked"      → hardLogout("session_revoked")
//   4002 → "session_idle_expired" → hardLogout("session_idle_expired")
//
// Anything else is transient (e.g. 1006 abnormal close during refresh)
// and must fall through so the hook's existing reconnect path runs.
//
// This pins the mapping in one place so all WS-consuming hooks
// (useRealtimeSubscription, useTopologyHandoffs, future hooks) get the
// same behaviour by importing the helper rather than duplicating the
// 4001/4002 branch.

describe("handleSessionCloseCode", () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
    setHardLogoutCallback(async (reason: string) => {
      calls.push(reason);
    });
  });
  afterEach(() => {
    setHardLogoutCallback(null);
  });

  it("fires hardLogout('session_revoked') on code 4001 and returns true", () => {
    const handled = handleSessionCloseCode({ code: WS_CLOSE_SESSION_REVOKED } as CloseEvent);
    expect(handled).toBe(true);
    expect(calls).toEqual(["session_revoked"]);
  });

  it("fires hardLogout('session_idle_expired') on code 4002 and returns true", () => {
    const handled = handleSessionCloseCode({ code: WS_CLOSE_SESSION_IDLE_EXPIRED } as CloseEvent);
    expect(handled).toBe(true);
    expect(calls).toEqual(["session_idle_expired"]);
  });

  it("returns false on transient codes (1006 / 4401 / 1000) and does not fire hardLogout", () => {
    expect(handleSessionCloseCode({ code: 1006 } as CloseEvent)).toBe(false);
    expect(handleSessionCloseCode({ code: 4401 } as CloseEvent)).toBe(false);
    expect(handleSessionCloseCode({ code: 1000 } as CloseEvent)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("returns true without firing when no hardLogout callback is registered (defensive)", () => {
    setHardLogoutCallback(null);
    // 4001 still classifies as terminal — caller should bail out of
    // reconnect logic even if AuthContext hasn't installed its callback
    // yet (e.g. WS opened before the provider mounted).
    expect(handleSessionCloseCode({ code: WS_CLOSE_SESSION_REVOKED } as CloseEvent)).toBe(true);
    expect(calls).toEqual([]);
  });
});
