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

// Cross-tab rotation marker. localStorage is synchronously readable across
// same-origin tabs the instant it's written — unlike BroadcastChannel,
// whose delivery is an async task with no ordering guarantee against the
// Web Lock handoff. The leader writes this INSIDE its lock callback before
// resolving; a queued tab reads it (synchronously) inside its own lock
// callback and skips its redundant refresh if the marker advanced. This is
// what makes "rotate exactly once per cycle" a guarantee rather than a
// best-effort racing the broadcast.
const ROTATION_MARKER_KEY = "vector-auth-rotation-seq";

export function readRotationMarker(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(ROTATION_MARKER_KEY);
  } catch {
    return null; // private mode / disabled storage
  }
}

export function bumpRotationMarker(): void {
  try {
    if (typeof localStorage === "undefined") return;
    // Value just needs to differ each write. Use a counter persisted in the
    // value itself so it's monotonic across writers and collision-free.
    const prev = Number(localStorage.getItem(ROTATION_MARKER_KEY) ?? "0");
    localStorage.setItem(ROTATION_MARKER_KEY, String(prev + 1));
  } catch {
    // private mode / disabled — fall back to the in-memory + grace-window
    // path; no throw.
  }
}

// ── Bound-JKT persistence (TD-SEC-DPOP-STALE-KEY Residual A) ─────────────────
// The session's DPoP key thumbprint (cnf.jkt) persisted so the bootstrap path
// — which must sign /auth/refresh BEFORE it learns the bound JKT from a fresh
// response — can deterministically pick the IndexedDB key whose JKT matches
// the session, instead of guessing "newest". A page refresh that signs with
// the wrong key fails the backend RFC 9449 binding check → revoke-all →
// logout; this is the data that closes the guess.
//
// NOT a secret: a public-key thumbprint, already present in the JWT and in
// users_sessions_dpop_jkt. localStorage is correct — synchronously readable on
// reload, same-origin. Cleared on logout so a following user can't inherit it.
const BOUND_JKT_KEY = "vector-dpop-bound-jkt";

export function readBoundJKT(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(BOUND_JKT_KEY);
  } catch {
    return null; // private mode → caller falls back to newest-wins
  }
}

export function writeBoundJKT(jkt: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (jkt) localStorage.setItem(BOUND_JKT_KEY, jkt);
    else localStorage.removeItem(BOUND_JKT_KEY);
  } catch {
    // private mode / disabled — no throw; bootstrap falls back to newest-wins.
  }
}

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
  // markerBefore is the snapshot of the synchronously-readable localStorage
  // rotation marker captured by the caller BEFORE queueing for the lock.
  // If the marker advanced by the time we hold the lock, a sibling rotated
  // even if its async broadcast hasn't been delivered yet — we skip our own
  // refresh. Optional: when omitted, coordinatedRefresh captures the marker
  // itself at entry (meaning "expect no change").
  markerBefore?: string | null;
}

// coordinatedRefresh serialises refresh across tabs via the Web Locks
// mutex. The lock auto-releases if the holding tab crashes/closes, so
// there is no orphaned-leader failure mode. If locks are unavailable
// (ancient browser), it degrades to calling doRefresh directly — the
// backend's 30s grace window then absorbs the occasional race exactly as
// it did before this feature.
export async function coordinatedRefresh(opts: CoordinatedRefreshOpts): Promise<void> {
  // Normalize markerBefore at entry, BEFORE the lock: an omitted snapshot
  // means "capture now, expect no change" (so a null marker doesn't read as
  // a phantom advance against undefined). Callers that care about the
  // async-race window pass their own pre-queue snapshot.
  const mb = opts.markerBefore === undefined ? readRotationMarker() : opts.markerBefore;
  const locks = resolveLocks();
  if (!locks) {
    await opts.doRefresh();
    return;
  }
  await locks.request(AUTH_REFRESH_LOCK, {}, async () => {
    // We now hold the lock. Skip if EITHER signal says a sibling already
    // rotated: the in-memory broadcast marker (fast path) OR the
    // synchronously-readable localStorage marker (closes the async
    // lock-handoff-vs-broadcast race). The caller's doRefresh bumps the
    // localStorage marker on success, so we never bump it here.
    if (opts.freshTokenArrived() || readRotationMarker() !== mb) return;
    await opts.doRefresh();
  });
}
