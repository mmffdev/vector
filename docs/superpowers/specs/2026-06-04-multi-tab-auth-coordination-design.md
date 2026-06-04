# Multi-Tab / Multi-Window Auth Coordination — Design

**Date:** 2026-06-04
**Status:** Approved (design), pending implementation plan
**Author:** Rick + Claude
**Area:** Auth / session (frontend only — zero backend changes)

---

## Problem

Opening a second tab **or window** of Vector logs the first one out.

This is not a UX bug — it is the security model behaving exactly as designed, under an assumption (one tab per browser) that does not match how people work.

### Root cause

Three pieces of auth state are **shared across every tab and window of the same browser profile** (origin-scoped by the browser — same cookie jar, same IndexedDB):

1. **The refresh token** — an HttpOnly cookie. It is **single-use**: each refresh rotates it and burns the old one.
2. **The DPoP keypair** — one slot per user in IndexedDB (`vector-dpop/keypairs/<userId>`).

But each tab runs its **own independent refresh loop**, with dedup state that is per-tab only:

- `_refreshPromise` — [`app/lib/api.ts:27`](../../../app/lib/api.ts) (module scope, per-tab).
- `refreshInFlight` — [`app/contexts/AuthContext.tsx:152`](../../../app/contexts/AuthContext.tsx) (React ref, per-tab).
- `_bootstrapped` / `_bootstrapFlight` — [`app/contexts/AuthContext.tsx:126-127`](../../../app/contexts/AuthContext.tsx) (per-tab).

So two tabs race the one shared single-use cookie. The backend grace window ([`backend/internal/auth/service.go:684-687`](../../../backend/internal/auth/service.go), default 30s) forgives a *simultaneous* double-fire, but past that window a reused token is treated as **theft → `sqlRevokeAllUserSessions` → every session for the user is revoked** ([`service.go:688-690`](../../../backend/internal/auth/service.go)). The next request from either tab 401s with `session_revoked` → `hardLogout` → bounced to `/login`.

A secondary trigger: the `visibilitychange` refetch in [`app/contexts/PageAccessContext.tsx:104-111`](../../../app/contexts/PageAccessContext.tsx) issues an authed GET on refocus, which can itself trigger a refresh — so *clicking back* to the first tab can detonate the race ("logout-on-refocus").

A tertiary trigger (root cause #3): when one tab logs in / re-binds, `applyLogin` prunes the shared DPoP key out of IndexedDB ([`AuthContext.tsx:174`](../../../app/contexts/AuthContext.tsx) → `pruneStaleKeys`). A *live* tab still holding the old key in memory then signs its next refresh with a pruned key → JKT mismatch → `refresh_dpop_binding_violation` → revoke-all.

**Root cause in one line:** shared single-use refresh token + per-tab refresh loops + reuse-detection that revokes *all* sessions instead of one.

---

## Goal

Multiple tabs and windows of the same browser profile share one session and coexist — **without weakening any server-side control**. A user can open Vector in as many tabs/windows as they like; logging out of one logs out all (same browser).

### Non-goals (explicit)

- **Cross-browser / cross-profile / cross-device coordination.** Separate cookie jars + IndexedDB = genuinely independent sessions. They each keep their own login and their own token rotation. We do not widen session scope across devices. *(Important for the SOC 2 audit narrative — see below.)*
- **General cross-tab domain-state sync** (e.g. drag-and-drop in one tab appearing in another, Rally-style). The BroadcastChannel we add is a natural carrier for this later, noted as an extension point, but it is **out of scope for this PR**.

---

## Architecture

One new owner of the refresh operation, shared across all tabs/windows of the browser profile. We replace the per-tab race with **leader-elected, broadcast-result** coordination.

New module: **`app/lib/authChannel.ts`** — three responsibilities:

1. **Refresh mutex (Web Locks API).** Any tab needing a refresh requests the named lock `"vector-auth-refresh"` via `navigator.locks.request()`. The browser grants it to exactly one tab; others queue. The lock auto-releases if the holder crashes or closes — no orphaned-leader problem.

2. **Result broadcast (BroadcastChannel `"vector-auth"`).** When the leader completes a refresh, it broadcasts the new access token + userId to all tabs. Waiters adopt the result instead of refreshing again.

3. **DPoP-key-change + logout broadcast (same channel).** On keypair reparent/prune, broadcast `dpop-key-changed` so live tabs reload their in-memory key from IDB. On logout, broadcast `logout` so all tabs clear state and redirect.

### Fallback ladder

1. **Web Locks present** (all current browsers) → use it.
2. **Web Locks absent** → BroadcastChannel-based leader election (claim + heartbeat + timeout).
3. **Both absent** (ancient browser) → today's behavior (single-tab; backend grace window still applies). No regression for anyone.

---

## Data flow

### Refresh (the core fix)

Tab B needs a refresh (401 retry, or bootstrap):

1. Tab B requests Web Lock `"vector-auth-refresh"`.
2. **No holder** → Tab B is leader → performs the real `/auth/refresh` POST (rotates the shared cookie **once**) → broadcasts `{type: "refreshed", accessToken, userId}` → releases lock.
3. **Tab A holds it** (mid-refresh) → Tab B's request **queues**. On acquiring the lock, Tab B first checks whether a `refreshed` broadcast arrived while it waited:
   - **Yes** → adopt that access token, **skip its own refresh**, release the lock immediately.
   - **No** → perform its own refresh (the leader's must have failed; Tab B retries).

**Invariant:** the shared single-use cookie is rotated **exactly once** per refresh cycle, regardless of how many tabs wanted it. Theft-detection never fires on legitimate multi-tab use because there is no token reuse.

**Closing the lock-handoff race (review finding, 2026-06-04):** the Web Lock handoff and the BroadcastChannel message delivery are *independent* async channels — a queued tab can be granted the lock before the leader's `refreshed` broadcast reaches its listener, so an in-memory-only freshness check could miss the rotation and the queued tab would redundantly rotate. We close this with a **synchronously-readable `localStorage` rotation marker** (`vector-auth-rotation-seq`, a monotonic counter): the leader bumps it on successful rotation (after the broadcast), and a queued tab reads it *synchronously inside its own lock callback*. Because the Web Lock is only handed off after the leader's callback resolves — which is after the leader's `localStorage` write — the queued tab is **guaranteed** to observe the marker and skip its redundant refresh. This makes "rotate exactly once" a guarantee rather than a race against broadcast timing. The in-memory `_broadcastSeq` counter remains as the fast path (and replaced an earlier `Date.now()` marker, which could collide for two rotations in the same millisecond). If `localStorage` is unavailable (private mode), the code falls back to the in-memory path; the backend 30s grace window (migration 145) is the ultimate backstop in that degraded case — a redundant rotation returns the successor token, not a revoke-all.

### DPoP key change

When `applyLogin` reparents/prunes the keypair ([`AuthContext.tsx:174`](../../../app/contexts/AuthContext.tsx)), broadcast `{type: "dpop-key-changed", userId}`. Every other tab's listener calls `ensureAnyActiveKeypair()` to reload its in-memory `_activeRecord` from IDB. No tab signs with a pruned key.

### Logout

Only **voluntary** `logout()` (a deliberate user sign-out) broadcasts `{type: "logout"}`; other tabs then clear local auth state and redirect to `/login` (stronger posture: no orphaned authenticated tab after the user signs out).

**Involuntary `hardLogout()` does NOT broadcast** (corrected 2026-06-04 after a verification finding). `hardLogout` is the backend-driven path — WS idle-close `4002`, `session_revoked` `4001`, or a terminal-401. Broadcasting from it cascaded a single tab's backend-forced session death into a forced `/login` redirect in *every* tab ("all browsers logged themselves out after a few minutes" with no user action). Each tab must validate its **own** session on its next request — the backend is the gate per tab, and a sibling tab may still hold a live session or be able to silently refresh. So involuntary death stays local to the tab that hit it; only a deliberate user action fans out. (For `session_revoked`, the shared session family is dead for all tabs anyway — each discovers that on its own next request, which is the correct fail-closed behavior without a forced cross-tab redirect.) Pinned by `app/contexts/__tests__/AuthContext.no-cascade.test.tsx`.

---

## Integration points

- **`app/lib/api.ts`** — the `_refreshPromise` dedup ([api.ts:270-273](../../../app/lib/api.ts)) wraps the call to `_refreshCallback`. The Web-Lock coordination wraps *that* — i.e. the registered refresh callback acquires the lock + checks-for-broadcast before doing the network refresh. `setApiToken` is called by waiters that adopt a broadcast token.
- **`app/contexts/AuthContext.tsx`** —
  - `refresh()` ([AuthContext.tsx:177-203](../../../app/contexts/AuthContext.tsx)) routes through the channel's lock-guarded path.
  - `applyLogin()` ([AuthContext.tsx:154-175](../../../app/contexts/AuthContext.tsx)) broadcasts `dpop-key-changed` after reparent/prune.
  - `logout()` + `hardLogout()` broadcast `logout`.
  - A new effect subscribes to the channel on mount and tears down on unmount: handles `refreshed` (adopt token via `setApiToken` + `setUser`), `dpop-key-changed` (reload key), `logout` (clear + redirect).
- **`app/lib/authChannel.ts`** (new) — owns the BroadcastChannel singleton, the Web-Lock helper, the message types, and the fallback election. Single clear purpose; testable in isolation.

---

## Security & SOC 2 posture

**No server-side control is modified.** Single-use rotating refresh tokens, reuse→revoke-all theft detection, DPoP key-binding (RFC 9449), the 30s grace window, anomaly detection, and idle expiry are all unchanged. This change is purely **same-origin client-side coordination** that removes a *false positive* (legit multi-tab triggering the theft alarm) — it does not disable the alarm.

| Concern | Before | After |
|---|---|---|
| Genuine token theft | revoke-all fires ✅ | revoke-all fires ✅ (identical) |
| Legit user, 2 tabs/windows | revoke-all fires (false positive) ❌ | no false positive ✅ |
| Audit-log fidelity | revoke-all events polluted by multi-tab noise | a revoke-all event is now real signal |

**Assessor-facing answers:**

- **BroadcastChannel scope** — same-origin only, browser-enforced. The token already lives in same-origin JS memory + IndexedDB; broadcasting over a same-origin channel does not widen the trust boundary. The only attacker who could listen (XSS on our origin) can already read the token directly.
- **Forged-broadcast defence-in-depth** — a tab adopting a broadcast token still presents it to the server, where it is validated normally (signature, DPoP binding, session row). A bogus token simply 401s. **The server remains the gate** (project hard rule); the broadcast is a hint, never an authority.
- **Web Locks** — a pure mutex, carries no credential, cannot grant access. Worst-case misbehavior degrades to today's grace-window behavior.
- **Logout propagation** — one-tab logout clears all tabs (same browser); no orphaned authenticated tab (CC6.1 logical access).
- **Session scope unchanged** — cross-browser/profile/device sessions remain fully independent, each rotating its own token. We do not create a shared cross-device session.

**Standards refs (for TD / procurement narrative):** SOC 2 CC6.1 (logical access — logout propagation), CC7.2 / CC7.3 (monitoring + incident detection — improved revoke-all signal fidelity). RFC 9449 (DPoP — binding preserved). RFC 6749 / OAuth 2.0 BCP (refresh-token rotation preserved).

**Procurement one-liner:** *Multi-tab support is same-origin client-side coordination of a single browser session; no server-side session, token-rotation, theft-detection, or DPoP-binding control was relaxed, and it reduces false-positive revocation events — improving security-audit-log fidelity.*

---

## Testing

- **Unit (`app/lib/authChannel.ts`)** — message serialization, leader-vs-waiter branch, the "broadcast arrived while queued → skip own refresh" decision, fallback election when Web Locks is mocked absent.
- **Integration (AuthContext)** — mock the channel; assert: (a) two concurrent `refresh()` calls produce exactly one network POST; (b) `dpop-key-changed` triggers `ensureAnyActiveKeypair`; (c) `logout` broadcast clears state + redirects.
- **Manual / Playwright** — open two tabs, refresh both, refocus first → no logout. Open two windows → same. Log out of one → both redirect. (Two browser *profiles* → independent, both stay logged in — confirms the non-goal boundary.)
- **Contract pin** — a test asserting no server-side auth control changed (the refresh handler / revoke-all / DPoP-binding tests remain green untouched).

---

## Extension point (future, not this PR)

The `"vector-auth"` BroadcastChannel — or a sibling `"vector-state"` channel — can later carry domain-state sync (the Rally drag-and-drop-appears-in-other-tab behavior). Out of scope here; noted so the channel is designed to be extensible (typed message envelope with a `type` discriminator).

---

## Tech debt

- **TD-SEC-DPOP-STALE-KEY** (existing, 2026-05-31) — partially superseded: this design closes the *live-tab* stale-in-memory-key path via the `dpop-key-changed` broadcast. Update that entry to reflect the live-tab path is now covered; the bootstrap-orphan-pickup mitigation it originally added remains.
- Any deferred edge case discovered during implementation gets its own `TD-*` entry with trigger + pay-down, per project standing rule.
