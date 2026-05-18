// B16.8.12 — WebSocket close-code → hardLogout routing.
//
// The backend WS session sweeper closes a connection with a private
// close code in the 4xxx range when the issuing users_sessions row is
// revoked or has gone idle past SESSION_IDLE_TTL. The frontend must:
//
//   - 4001 ("session terminated")    → hardLogout("session_revoked")
//   - 4002 ("session idle expired")  → hardLogout("session_idle_expired")
//
// Both reuse the same banner the HTTP path's 401 → hardLogout flow
// renders on /login (B16.8.11 step 4e), so the user sees one consistent
// explanation regardless of which surface evicted them.
//
// Anything else (1000 normal close, 1006 abnormal, 4401 upgrade-auth-
// reject from coder/websocket) is transient and must fall through to
// the caller's existing reconnect path.
//
// Shared so every WS-consuming hook (useRealtimeSubscription,
// useTopologyHandoffs, future hooks) gets the same behaviour without
// duplicating the 4001/4002 branch in each call site.

import { getHardLogoutCallback } from "@/app/lib/api";

export const WS_CLOSE_SESSION_REVOKED = 4001;
export const WS_CLOSE_SESSION_IDLE_EXPIRED = 4002;

// handleSessionCloseCode inspects a WebSocket close event. If the code
// is one of the terminal session codes (4001/4002), it fires hardLogout
// with the corresponding reason string (matching Problem.code values
// the HTTP path uses — backend/internal/auth/codes.go) and returns
// `true` so the caller bails out of any reconnect logic. Returns
// `false` for transient/non-session codes — the caller's reconnect
// path should run as usual.
//
// Defensive: returns `true` for terminal codes even when no hardLogout
// callback is registered (e.g. WS opened before AuthProvider mounted).
// The connection is still terminally dead from the server's
// perspective, so the hook must stop trying to reconnect; the user
// will be redirected to /login on the next render.
export function handleSessionCloseCode(ev: CloseEvent): boolean {
  let reason: string | null = null;
  if (ev.code === WS_CLOSE_SESSION_REVOKED) {
    reason = "session_revoked";
  } else if (ev.code === WS_CLOSE_SESSION_IDLE_EXPIRED) {
    reason = "session_idle_expired";
  }
  if (reason === null) return false;

  const cb = getHardLogoutCallback();
  if (cb) {
    void cb(reason);
  }
  return true;
}
