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
