import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_CHANNEL_NAME,
  broadcastAuthEvent,
  subscribeAuthEvents,
  coordinatedRefresh,
  __setLocksForTest,
  type AuthChannelMessage,
} from "@/app/lib/authChannel";

describe("authChannel.unit envelope + pub/sub", () => {
  let received: AuthChannelMessage[];
  let unsub: () => void;
  beforeEach(() => {
    received = [];
    unsub = subscribeAuthEvents((m) => received.push(m));
  });
  afterEach(() => {
    unsub();
  });

  it("delivers a broadcast refreshed event to subscribers in another listener", async () => {
    const observer = new BroadcastChannel(AUTH_CHANNEL_NAME);
    const seen: AuthChannelMessage[] = [];
    observer.onmessage = (e) => seen.push(e.data as AuthChannelMessage);

    broadcastAuthEvent({ type: "refreshed", accessToken: "tok-123", userId: "u-1" });

    await new Promise((r) => setTimeout(r, 0));

    expect(seen).toEqual([{ type: "refreshed", accessToken: "tok-123", userId: "u-1" }]);
    observer.close();
  });

  it("delivers dpop-key-changed and logout shapes", async () => {
    const observer = new BroadcastChannel(AUTH_CHANNEL_NAME);
    const seen: AuthChannelMessage[] = [];
    observer.onmessage = (e) => seen.push(e.data as AuthChannelMessage);

    broadcastAuthEvent({ type: "dpop-key-changed", userId: "u-9" });
    broadcastAuthEvent({ type: "logout" });
    await new Promise((r) => setTimeout(r, 0));

    expect(seen).toEqual([
      { type: "dpop-key-changed", userId: "u-9" },
      { type: "logout" },
    ]);
    observer.close();
  });
});

describe("authChannel.unit coordinatedRefresh", () => {
  afterEach(() => {
    __setLocksForTest(undefined); // restore real navigator.locks
  });

  it("runs the doRefresh callback when it acquires the lock and no fresh token arrived", async () => {
    __setLocksForTest({
      request: async (_name: string, _opts: unknown, cb?: () => Promise<void>) => {
        await cb?.();
      },
    });

    let refreshRan = 0;
    await coordinatedRefresh({
      doRefresh: async () => { refreshRan += 1; },
      freshTokenArrived: () => false,
    });
    expect(refreshRan).toBe(1);
  });

  it("SKIPS doRefresh when a fresh token arrived while queued (another tab led)", async () => {
    __setLocksForTest({
      request: async (_name: string, _opts: unknown, cb?: () => Promise<void>) => {
        await cb?.();
      },
    });

    let refreshRan = 0;
    await coordinatedRefresh({
      doRefresh: async () => { refreshRan += 1; },
      freshTokenArrived: () => true,
    });
    expect(refreshRan).toBe(0);
  });

  it("falls back to running doRefresh directly when Web Locks is unavailable", async () => {
    __setLocksForTest(null);
    let refreshRan = 0;
    await coordinatedRefresh({
      doRefresh: async () => { refreshRan += 1; },
      freshTokenArrived: () => false,
    });
    expect(refreshRan).toBe(1);
  });
});

import { coordinatedRefresh as coordRefresh2, __setLocksForTest as setLocks2, readRotationMarker, bumpRotationMarker } from "@/app/lib/authChannel";

describe("authChannel.unit rotation marker (review finding #1)", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });
  afterEach(() => {
    setLocks2(undefined);
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("bumpRotationMarker advances the value monotonically", () => {
    expect(readRotationMarker()).toBeNull();
    bumpRotationMarker();
    const a = readRotationMarker();
    bumpRotationMarker();
    const b = readRotationMarker();
    expect(Number(b)).toBe(Number(a) + 1);
  });

  it("SKIPS doRefresh when the localStorage marker advanced even if freshTokenArrived() is false (async-race case)", async () => {
    setLocks2({
      request: async (_n: string, _o: unknown, cb?: () => Promise<void>) => {
        // Simulate a sibling rotating AFTER markerBefore was captured but
        // before our lock callback runs: bump the marker here.
        bumpRotationMarker();
        if (cb) await cb();
      },
    });
    const markerBefore = readRotationMarker(); // null
    let ran = 0;
    await coordRefresh2({
      markerBefore,
      freshTokenArrived: () => false, // in-memory signal MISSED the broadcast
      doRefresh: async () => { ran += 1; },
    });
    expect(ran).toBe(0); // localStorage marker caught it → no double rotation
  });

  it("RUNS doRefresh when neither signal indicates a sibling rotation", async () => {
    setLocks2({
      request: async (_n: string, _o: unknown, cb?: () => Promise<void>) => { if (cb) await cb(); },
    });
    const markerBefore = readRotationMarker();
    let ran = 0;
    await coordRefresh2({
      markerBefore,
      freshTokenArrived: () => false,
      doRefresh: async () => { ran += 1; },
    });
    expect(ran).toBe(1);
  });
});
