# Multi-Tab / Multi-Window Auth Coordination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let multiple tabs/windows of the same browser profile share one Vector session instead of logging each other out, with zero backend changes.

**Architecture:** A new client-side module (`app/lib/authChannel.ts`) elects a single "leader" tab to perform each refresh via the Web Locks API, then broadcasts the result over a same-origin BroadcastChannel so waiting tabs adopt the token instead of re-rotating the shared single-use refresh cookie. The same channel propagates DPoP-key-change and logout events. All server-side controls (rotation, revoke-all theft detection, DPoP binding) are untouched.

**Tech Stack:** TypeScript, Next.js 14 (App Router), React, Web Locks API, BroadcastChannel API, Vitest (jsdom).

**Design spec:** [docs/superpowers/specs/2026-06-04-multi-tab-auth-coordination-design.md](../specs/2026-06-04-multi-tab-auth-coordination-design.md)

---

## File structure

- **Create:** `app/lib/authChannel.ts` — owns the BroadcastChannel singleton, the Web-Locks refresh coordinator, the typed message envelope, and the fallback path. Single responsibility: cross-tab auth coordination.
- **Create:** `app/lib/__tests__/authChannel.test.ts` — unit tests for the coordinator branch logic and message envelope.
- **Modify:** `app/contexts/AuthContext.tsx` — route `refresh()` through the coordinator; broadcast on key-change/logout; subscribe to channel events on mount.
- **Create:** `app/contexts/__tests__/AuthContext.multitab.test.tsx` — integration: concurrent refresh → one network POST; channel events handled.
- **Modify:** `docs/c_tech_debt.md` — update `TD-SEC-DPOP-STALE-KEY` to note the live-tab path is now covered.

---

## Conventions to follow (from the existing codebase)

- Tests use Vitest globals (`describe/it/expect/beforeEach/afterEach`) and the shared `installFetchStub`/`restoreFetch` helper from `app/lib/__tests__/_fetchStub.ts`.
- `@/` path alias maps to repo root (see `vitest.config.ts`).
- Run a single test file: `npm test -- app/lib/__tests__/authChannel.test.ts`
- Run the whole suite: `npm test`
- Type check: `npm run typecheck`
- Comments explain *why*, matching the dense-comment style of `api.ts` / `dpop.ts`.

---

## Task 1: The coordination module — message envelope + channel singleton

**Files:**
- Create: `app/lib/authChannel.ts`
- Test: `app/lib/__tests__/authChannel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/__tests__/authChannel.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_CHANNEL_NAME,
  broadcastAuthEvent,
  subscribeAuthEvents,
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
    // BroadcastChannel does NOT deliver to the same posting context, so we
    // open a second channel to observe what was posted.
    const observer = new BroadcastChannel(AUTH_CHANNEL_NAME);
    const seen: AuthChannelMessage[] = [];
    observer.onmessage = (e) => seen.push(e.data as AuthChannelMessage);

    broadcastAuthEvent({ type: "refreshed", accessToken: "tok-123", userId: "u-1" });

    // allow the event loop to flush the async postMessage delivery
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/lib/__tests__/authChannel.test.ts`
Expected: FAIL — cannot resolve `@/app/lib/authChannel` (module not created yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// app/lib/authChannel.ts
//
// Cross-tab / cross-window auth coordination (same browser profile).
//
// WHY THIS EXISTS: every tab/window of the origin shares one cookie jar
// and one IndexedDB. The refresh token is a single-use HttpOnly cookie;
// the DPoP keypair is one IDB slot. When each tab runs its own refresh
// loop, two tabs race the single-use cookie → the backend's reuse-
// detection treats the second use as theft and revokes ALL sessions →
// every tab is logged out. See the design spec dated 2026-06-04.
//
// This module makes the tabs cooperate: exactly one tab performs each
// refresh (Web Locks mutex), and the result is broadcast to the others
// (BroadcastChannel) so they adopt the new token instead of re-rotating
// the cookie. No server-side control changes — this only removes a
// false-positive revoke-all on legitimate multi-tab use.
//
// SECURITY: BroadcastChannel is same-origin only (browser-enforced). The
// access token already lives in same-origin JS memory + IDB; broadcasting
// it over a same-origin channel widens nothing. A tab adopting a
// broadcast token still presents it to the server, which validates it
// normally — the server remains the gate; the broadcast is a hint.

export const AUTH_CHANNEL_NAME = "vector-auth";
export const AUTH_REFRESH_LOCK = "vector-auth-refresh";

// Typed message envelope. The `type` discriminator keeps the channel
// extensible (future domain-state sync can add new variants).
export type AuthChannelMessage =
  | { type: "refreshed"; accessToken: string; userId: string }
  | { type: "dpop-key-changed"; userId: string }
  | { type: "logout" };

// Lazily-created singleton channel. Guarded for SSR (no BroadcastChannel
// on the server) — returns null there so callers no-op cleanly.
let _channel: BroadcastChannel | null = null;
function channel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!_channel) _channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
  return _channel;
}

// broadcastAuthEvent posts a message to all OTHER tabs/windows. Note:
// BroadcastChannel does not deliver to the posting context, so the
// caller must apply its own local side effect directly (it can't rely
// on hearing its own broadcast).
export function broadcastAuthEvent(msg: AuthChannelMessage): void {
  const ch = channel();
  if (ch) ch.postMessage(msg);
}

// subscribeAuthEvents registers a listener and returns an unsubscribe
// function. Safe to call on SSR (returns a no-op unsubscribe).
export function subscribeAuthEvents(
  handler: (msg: AuthChannelMessage) => void,
): () => void {
  const ch = channel();
  if (!ch) return () => {};
  const listener = (e: MessageEvent) => handler(e.data as AuthChannelMessage);
  ch.addEventListener("message", listener);
  return () => ch.removeEventListener("message", listener);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/lib/__tests__/authChannel.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/authChannel.ts app/lib/__tests__/authChannel.test.ts
git commit -m "feat(auth): authChannel — typed cross-tab message envelope + pub/sub

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The lock-guarded refresh coordinator

This is the core invariant: the shared single-use cookie is rotated **exactly once** per refresh cycle, regardless of how many tabs want it. `coordinatedRefresh` acquires the Web Lock; while holding it, it checks whether a fresh token already arrived (a leader in another tab beat us) and if so skips its own network refresh.

**Files:**
- Modify: `app/lib/authChannel.ts`
- Test: `app/lib/__tests__/authChannel.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing test file)**

```ts
// append to app/lib/__tests__/authChannel.test.ts

import { coordinatedRefresh, __setLocksForTest } from "@/app/lib/authChannel";

describe("authChannel.unit coordinatedRefresh", () => {
  afterEach(() => {
    __setLocksForTest(undefined); // restore real navigator.locks
  });

  it("runs the doRefresh callback when it acquires the lock and no fresh token arrived", async () => {
    // Fake Web Locks: immediately grant the lock by invoking the callback.
    __setLocksForTest({
      request: async (_name: string, _opts: unknown, cb: () => Promise<void>) => {
        await cb();
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
      request: async (_name: string, _opts: unknown, cb: () => Promise<void>) => {
        await cb();
      },
    });

    let refreshRan = 0;
    await coordinatedRefresh({
      doRefresh: async () => { refreshRan += 1; },
      freshTokenArrived: () => true, // a "refreshed" broadcast was seen while waiting
    });
    expect(refreshRan).toBe(0); // we adopted the leader's token; no second rotation
  });

  it("falls back to running doRefresh directly when Web Locks is unavailable", async () => {
    __setLocksForTest(null); // simulate no navigator.locks
    let refreshRan = 0;
    await coordinatedRefresh({
      doRefresh: async () => { refreshRan += 1; },
      freshTokenArrived: () => false,
    });
    expect(refreshRan).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/lib/__tests__/authChannel.test.ts`
Expected: FAIL — `coordinatedRefresh` and `__setLocksForTest` are not exported.

- [ ] **Step 3: Write minimal implementation (append to `app/lib/authChannel.ts`)**

```ts
// append to app/lib/authChannel.ts

// Minimal structural type for the slice of navigator.locks we use, so the
// test can inject a fake. `undefined` here means "use the real
// navigator.locks"; `null` means "simulate locks unavailable".
type LockManagerLike = {
  request: (
    name: string,
    opts: { ifAvailable?: boolean } | (() => Promise<void>),
    cb?: () => Promise<void>,
  ) => Promise<void>;
};
let _locksOverride: LockManagerLike | null | undefined = undefined;

// __setLocksForTest is a test seam. Production never calls it.
//   undefined → use real navigator.locks
//   null      → simulate locks unavailable (exercise the fallback)
//   object    → use the supplied fake
export function __setLocksForTest(v: LockManagerLike | null | undefined): void {
  _locksOverride = v;
}

function resolveLocks(): LockManagerLike | null {
  if (_locksOverride !== undefined) return _locksOverride;
  if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks) {
    return navigator.locks as unknown as LockManagerLike;
  }
  return null;
}

export interface CoordinatedRefreshOpts {
  // doRefresh performs the actual network /auth/refresh (rotating the
  // shared single-use cookie). Called at most once across all tabs per
  // cycle, only by whichever tab holds the lock AND found no fresh token.
  doRefresh: () => Promise<void>;
  // freshTokenArrived returns true if a "refreshed" broadcast was observed
  // since this refresh attempt began — meaning another tab already led the
  // refresh and we should adopt its token rather than rotate again.
  freshTokenArrived: () => boolean;
}

// coordinatedRefresh serialises refresh across tabs via the Web Locks
// mutex. The lock auto-releases if the holding tab crashes/closes, so
// there is no orphaned-leader failure mode. If locks are unavailable
// (ancient browser), it degrades to calling doRefresh directly — the
// backend's 30s grace window then absorbs the occasional race exactly as
// it did before this feature.
export async function coordinatedRefresh(opts: CoordinatedRefreshOpts): Promise<void> {
  const locks = resolveLocks();
  if (!locks) {
    // Fallback: no cross-tab serialisation available. Behave as today.
    await opts.doRefresh();
    return;
  }
  await locks.request(AUTH_REFRESH_LOCK, {}, async () => {
    // We now hold the lock. If, while we were queued behind another tab's
    // refresh, that tab broadcast a fresh token, adopt it and skip our own
    // network refresh — this is what guarantees the single-use cookie is
    // rotated exactly once per cycle.
    if (opts.freshTokenArrived()) return;
    await opts.doRefresh();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/lib/__tests__/authChannel.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 5: Type check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/lib/authChannel.ts app/lib/__tests__/authChannel.test.ts
git commit -m "feat(auth): coordinatedRefresh — Web-Locks single-leader refresh + fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire AuthContext.refresh through the coordinator

Route the existing `refresh()` through `coordinatedRefresh`, broadcast the new token on success, and track whether a fresh token arrived via the channel so the lock-holder can skip a redundant rotation.

**Files:**
- Modify: `app/contexts/AuthContext.tsx`
- Test: `app/contexts/__tests__/AuthContext.multitab.test.tsx`

- [ ] **Step 1: Write the failing integration test**

```tsx
// app/contexts/__tests__/AuthContext.multitab.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/app/contexts/AuthContext";
import { installFetchStub, restoreFetch, type FetchStub } from "@/app/lib/__tests__/_fetchStub";
import { __setLocksForTest } from "@/app/lib/authChannel";

// next/navigation is used by AuthContext (useRouter). Stub it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Expose refresh() to the test via a tiny harness component.
let refreshFn: (() => Promise<void>) | null = null;
function Harness() {
  const { refresh } = useAuth();
  refreshFn = refresh;
  return null;
}

describe("AuthContext.multitab refresh coordination", () => {
  let stub: FetchStub;
  beforeEach(() => {
    // Fake Web Locks: grant immediately (single-tab test context).
    __setLocksForTest({
      request: async (_n: string, _o: unknown, cb: () => Promise<void>) => { await cb(); },
    });
    stub = installFetchStub();
  });
  afterEach(() => {
    __setLocksForTest(undefined);
    restoreFetch();
    refreshFn = null;
  });

  it("two concurrent refresh() calls produce exactly ONE /auth/refresh POST", async () => {
    // The refresh endpoint returns a LoginResp shape.
    stub.queue.push({
      status: 200,
      body: {
        access_token: "rotated-token",
        user: {
          id: "u-1", subscription_id: "s-1", workspace_id: "w-1",
          email: "x@y.z",
          role: { id: "r", code: "user", label: "User", rank: 1, is_system: true, is_external: false },
          is_active: true, force_password_change: false, auth_method: "local",
          permissions: [],
        },
      },
    });
    stub.queue.push({
      status: 200,
      body: {
        access_token: "rotated-token-2",
        user: {
          id: "u-1", subscription_id: "s-1", workspace_id: "w-1",
          email: "x@y.z",
          role: { id: "r", code: "user", label: "User", rank: 1, is_system: true, is_external: false },
          is_active: true, force_password_change: false, auth_method: "local",
          permissions: [],
        },
      },
    });

    render(<AuthProvider><Harness /></AuthProvider>);
    expect(refreshFn).not.toBeNull();

    await act(async () => {
      await Promise.all([refreshFn!(), refreshFn!()]);
    });

    // The per-tab refreshInFlight dedup already collapses concurrent calls
    // within ONE tab to a single network POST.
    const refreshPosts = stub.calls.filter(
      (c) => c.url.includes("/auth/refresh") && c.method === "POST",
    );
    expect(refreshPosts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/contexts/__tests__/AuthContext.multitab.test.tsx`
Expected: FAIL — `refresh()` does not yet route through the coordinator (import of `__setLocksForTest` works, but the assertion may pass trivially OR fail on wiring). If it passes trivially, proceed — Step 3 adds the coordination that the later key-change/logout tests (Task 4) depend on; this test pins the single-POST invariant during the refactor.

- [ ] **Step 3: Modify `app/contexts/AuthContext.tsx`**

First, add the import near the other lib imports (after the `api` import line):

```tsx
import {
  broadcastAuthEvent,
  coordinatedRefresh,
  subscribeAuthEvents,
} from "@/app/lib/authChannel";
```

Then, add a module-level marker that records when a refreshed-token broadcast was last seen, so the lock holder can detect "another tab already led". Place it next to `_bootstrapped`:

```tsx
// _lastBroadcastTokenAt is bumped whenever this tab receives a "refreshed"
// broadcast from another tab. coordinatedRefresh's freshTokenArrived()
// compares a snapshot taken before acquiring the lock against the current
// value: if it changed, a sibling tab rotated the cookie while we queued,
// so we adopt that token instead of rotating again.
let _lastBroadcastTokenAt = 0;
```

Replace the existing `refresh` callback ([AuthContext.tsx:177-203]) with this coordinated version (same dedup ref, now wrapping the network call in `coordinatedRefresh`):

```tsx
  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current;
    // Snapshot the broadcast marker BEFORE we queue for the lock. If a
    // sibling tab broadcasts a fresh token while we wait, the marker
    // advances and freshTokenArrived() returns true → we skip the network
    // refresh and adopt the broadcast token (set by the channel listener).
    const seenBefore = _lastBroadcastTokenAt;
    const flight = (async () => {
      await coordinatedRefresh({
        freshTokenArrived: () => _lastBroadcastTokenAt !== seenBefore,
        doRefresh: async () => {
          try {
            const res = await apiSite<LoginResp>("/auth/refresh", { method: "POST", skipAuth: true });
            applyLogin(res);
            _bootstrapped = true;
            // Tell sibling tabs the cookie was just rotated and hand them
            // the new access token so they don't rotate it again.
            broadcastAuthEvent({ type: "refreshed", accessToken: res.access_token, userId: res.user.id });
          } catch (e) {
            // Only clear state on REAL auth failures (backend 4xx). Network
            // errors are transient (dev backend restart, mid-nav abort);
            // nuking state here caused the air-restart logout cascade.
            if (e instanceof ApiError) {
              setApiToken(null);
              setUser(null);
              clearSessionCookie();
              _bootstrapped = false;
            }
          }
        },
      });
    })().finally(() => {
      refreshInFlight.current = null;
    });
    refreshInFlight.current = flight;
    return flight;
  }, [applyLogin]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/contexts/__tests__/AuthContext.multitab.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Run the existing auth tests to confirm no regression**

Run: `npm test -- app/lib/__tests__/api-session-codes.test.ts app/lib/__tests__/dpop.test.ts`
Expected: PASS (all existing tests still green).

- [ ] **Step 6: Type check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/contexts/AuthContext.tsx app/contexts/__tests__/AuthContext.multitab.test.tsx
git commit -m "feat(auth): route refresh through cross-tab coordinator + broadcast result

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Channel listener — adopt broadcast token, reload DPoP key, propagate logout

Subscribe to the channel on mount. Handle the three message types. Also broadcast `dpop-key-changed` from `applyLogin` and `logout` from `logout()`/`hardLogout()`.

**Files:**
- Modify: `app/contexts/AuthContext.tsx`
- Test: `app/contexts/__tests__/AuthContext.multitab.test.tsx`

- [ ] **Step 1: Write the failing tests (append to the multitab test file)**

```tsx
// append to app/contexts/__tests__/AuthContext.multitab.test.tsx
import { AUTH_CHANNEL_NAME, type AuthChannelMessage } from "@/app/lib/authChannel";
import { getApiToken } from "@/app/lib/api";

describe("AuthContext.multitab channel listener", () => {
  beforeEach(() => {
    __setLocksForTest({
      request: async (_n: string, _o: unknown, cb: () => Promise<void>) => { await cb(); },
    });
  });
  afterEach(() => {
    __setLocksForTest(undefined);
  });

  it("adopts the access token from a 'refreshed' broadcast without a network call", async () => {
    const stub = installFetchStub();
    render(<AuthProvider><Harness /></AuthProvider>);

    // Simulate a sibling tab broadcasting a refreshed token. We post from a
    // second channel because BroadcastChannel doesn't self-deliver.
    const sibling = new BroadcastChannel(AUTH_CHANNEL_NAME);
    await act(async () => {
      const msg: AuthChannelMessage = { type: "refreshed", accessToken: "from-sibling", userId: "u-1" };
      sibling.postMessage(msg);
      await new Promise((r) => setTimeout(r, 0));
    });
    sibling.close();

    expect(getApiToken()).toBe("from-sibling");
    // No /auth/refresh POST happened — we adopted the broadcast token.
    expect(stub.calls.filter((c) => c.url.includes("/auth/refresh"))).toHaveLength(0);
    restoreFetch();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/contexts/__tests__/AuthContext.multitab.test.tsx`
Expected: FAIL — `getApiToken()` is null because no listener adopts the broadcast token yet.

- [ ] **Step 3: Modify `app/contexts/AuthContext.tsx`**

Add `getApiToken` and `ensureAnyActiveKeypair` to imports if not present. `ensureAnyActiveKeypair` is already imported from `@/app/lib/dpop`; add `getApiToken` to the `@/app/lib/api` import:

```tsx
import { apiSite, ApiError, setApiToken, getApiToken, setRefreshCallback, setHardLogoutCallback } from "@/app/lib/api";
```

In `applyLogin` ([AuthContext.tsx:154-175]), after the existing `void reparentAnonKeypair(...)` line, add the key-change broadcast:

```tsx
    // Tell sibling tabs the DPoP keypair was (re)bound/pruned so any live
    // tab reloads its in-memory key from IDB instead of signing the next
    // refresh with a key we just pruned (which the backend would reject →
    // revoke-all). TD-SEC-DPOP-STALE-KEY live-tab path.
    broadcastAuthEvent({ type: "dpop-key-changed", userId: res.user.id });
```

In `logout` ([AuthContext.tsx:299-321]) and `hardLogout` ([AuthContext.tsx:338-359]), after `clearSessionCookie();`, add:

```tsx
    broadcastAuthEvent({ type: "logout" });
```

Add a new effect (place it after the hardLogout-registration effect at [AuthContext.tsx:364-367]) that subscribes to the channel:

```tsx
  // Subscribe to cross-tab auth events. A sibling tab that refreshes
  // broadcasts the new token (we adopt it without a network call); a
  // key-change tells us to reload the DPoP key from IDB; a logout tells
  // us to clear and redirect so no authenticated tab lingers.
  useEffect(() => {
    const unsub = subscribeAuthEvents((msg) => {
      if (msg.type === "refreshed") {
        _lastBroadcastTokenAt = Date.now();
        setApiToken(msg.accessToken);
        _bootstrapped = true;
        // Note: user object isn't broadcast (it can be large + the access
        // token is the load-bearing credential). If this tab had no user
        // yet, its own bootstrap/refresh will populate it; the token lets
        // those calls succeed immediately.
      } else if (msg.type === "dpop-key-changed") {
        // Reload the in-memory active keypair from IDB. Fire-and-forget;
        // a failure only means this tab re-binds on its next refresh.
        void ensureAnyActiveKeypair();
      } else if (msg.type === "logout") {
        setApiToken(null);
        setUser(null);
        clearSessionCookie();
        _bootstrapped = false;
        if (typeof window !== "undefined") window.location.assign("/login");
      }
    });
    return unsub;
  }, []);
```

> Note on `_lastBroadcastTokenAt`: it uses `Date.now()`. That's fine in browser/JSX runtime code — the `Date.now()` prohibition applies only to Workflow scripts, not application code.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/contexts/__tests__/AuthContext.multitab.test.tsx`
Expected: PASS (all multitab tests).

- [ ] **Step 5: Full auth-related regression**

Run: `npm test -- app/lib/__tests__/api-session-codes.test.ts app/lib/__tests__/dpop.test.ts app/lib/__tests__/wsClose.test.ts app/contexts/__tests__`
Expected: PASS.

- [ ] **Step 6: Type check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/contexts/AuthContext.tsx app/contexts/__tests__/AuthContext.multitab.test.tsx
git commit -m "feat(auth): channel listener — adopt token, reload DPoP key, propagate logout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Update tech-debt register

**Files:**
- Modify: `docs/c_tech_debt.md`

- [ ] **Step 1: Locate the existing entry**

Run: `grep -n "TD-SEC-DPOP-STALE-KEY" docs/c_tech_debt.md`
Expected: one or more line numbers.

- [ ] **Step 2: Append a status note to that entry**

Add this line under the `TD-SEC-DPOP-STALE-KEY` entry (adapt to the file's existing entry format):

```markdown
- **Update 2026-06-04:** The *live-tab* stale-in-memory-key path is now closed by the multi-tab auth coordinator — `applyLogin` broadcasts `dpop-key-changed` over the `vector-auth` BroadcastChannel and every live tab reloads its key from IDB (see `app/lib/authChannel.ts` + design spec `2026-06-04-multi-tab-auth-coordination-design.md`). The original bootstrap-orphan-pickup mitigation (newest-wins in `ensureAnyActiveKeypair`) remains in place.
```

- [ ] **Step 3: Commit**

```bash
git add docs/c_tech_debt.md
git commit -m "docs(td): TD-SEC-DPOP-STALE-KEY — live-tab path closed by multi-tab coordinator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green (or only pre-existing unrelated failures — note any in the report).

- [ ] **Step 2: Type check + project lint**

Run: `npm run typecheck && npm run lint:project`
Expected: no errors.

- [ ] **Step 3: Manual verification checklist (report to user — requires a running app)**

The agent cannot fully self-verify multi-tab behavior headlessly; surface this checklist for the user:
- Open two tabs of Vector, both logged in. Let one sit, refocus the other → no logout.
- Open a second window (not tab) → both stay logged in.
- Log out of one tab → the other redirects to `/login`.
- Open two separate browser *profiles* → each stays independently logged in (confirms the non-goal boundary).

---

## Self-review notes (completed during planning)

- **Spec coverage:** leader-election (Task 2), broadcast-result (Tasks 1,3), DPoP-key broadcast (Task 4), logout propagation (Task 4), fallback ladder (Task 2 fallback + SSR guards in Task 1), security/TD (Task 5). All spec sections mapped.
- **Type consistency:** `AuthChannelMessage` shape is identical across Tasks 1, 3, 4. `coordinatedRefresh` signature defined in Task 2 is used unchanged in Task 3. `__setLocksForTest` seam used in Tasks 2, 3, 4.
- **No placeholders:** every code step contains complete code; every run step has an exact command + expected outcome.
- **Known nuance flagged:** Task 3 Step 2 notes the single-POST test may pass before the refactor (because per-tab dedup already collapses same-tab concurrency) — it pins the invariant during refactor; the cross-tab behavior is exercised in Task 4 via the second-channel technique.
