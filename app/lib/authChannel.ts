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
