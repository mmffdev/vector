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
