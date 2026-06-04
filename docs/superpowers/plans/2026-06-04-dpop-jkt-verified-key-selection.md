# DPoP JKT-Verified Key Selection — Implementation Plan

> Fixes the recurring "page refresh logs me out" by replacing the newest-wins
> DPoP key-selection *heuristic* with deterministic selection of the key whose
> JKT matches the session's bound `cnf.jkt`. Closes TD-SEC-DPOP-STALE-KEY
> Residual A. Branch: `feat/multi-tab-auth-coordination` (continuation).

**Goal:** On every refresh/bootstrap, sign the `/auth/refresh` proof with the
DPoP key the session is actually bound to — never a guessed "newest" key — so
the backend's RFC 9449 binding check cannot reject it and revoke the session.

**Root cause (proven from live audit_logs):** `auth.refresh_dpop_binding_violation`
with `bound_jkt != incoming_jkt`. IndexedDB holds multiple keypairs; bootstrap's
`ensureAnyActiveKeypair()` picks newest-by-createdAt, which is NOT always the
session-bound key (multi-tab, re-login, the new cross-tab key broadcast, anon
leftovers). Mismatch → revoke-all → logout.

---

## The chicken-and-egg, and how it's solved

The refresh request itself needs a DPoP proof, but `bound_jkt` is only learned
from a *response* (`cnf.jkt`). Solution: **persist the session's bound JKT** to
`localStorage` (`vector-dpop-bound-jkt`) on every successful login/refresh.
Bootstrap reads it *before* selecting the signing key, so selection is
deterministic from the first request after reload.

- Persisted JKT is **not a secret** (it's a public-key thumbprint, already in
  the JWT and the DB). localStorage is the correct store — synchronously
  readable on reload, same-origin.
- If localStorage is unavailable (private mode) or the JKT is absent (first
  ever login), fall back to TODAY's newest-wins behavior (no regression for
  the cases that currently work).
- If a bound JKT IS known but **no IDB key matches it**, the session is
  genuinely unrecoverable on this device (the bound key was pruned/never
  stored). Signing with any other key would trigger revoke-all. Instead:
  clear local session state and route to a clean re-auth — do NOT sign with a
  wrong key.

---

## Files

- **Modify** `app/lib/dpop.ts` — add `selectKeypairByJKT(jkt)`, decode helper
  `jktFromAccessToken(token)`, make `ensureAnyActiveKeypair(preferJKT?)` take an
  optional target JKT, add `getActiveJKT()` already exists. Add a dev runtime
  assert.
- **Modify** `app/lib/authChannel.ts` — add `readBoundJKT()`/`writeBoundJKT()`
  (localStorage, mirrors the rotation-marker pattern).
- **Modify** `app/contexts/AuthContext.tsx` — persist `cnf.jkt` on every
  `applyLogin`; bootstrap passes the persisted JKT to `ensureAnyActiveKeypair`;
  clear it on logout.
- **Test** `app/lib/__tests__/dpop-jkt-selection.test.ts` — JKT-verified
  selection picks the matching key, not the newest; unrecoverable path.
- **Test** `app/contexts/__tests__/AuthContext.jkt-bootstrap.test.tsx` —
  bootstrap signs with the bound JKT.
- **Modify** `docs/c_tech_debt.md` — mark TD-SEC-DPOP-STALE-KEY Residual A
  resolved.

---

## Runtime assert + alert (regression guard)

- **Client dev assert:** before any `/auth/refresh`, if `getActiveJKT()` is
  known AND a persisted bound JKT exists AND they differ, `console.error` a
  loud, greppable `DPOP_JKT_MISMATCH` line (dev only — never throws in prod, to
  avoid turning a recoverable state into a crash).
- **Backend alert:** `auth.refresh_dpop_binding_violation` already lands in
  `audit_logs`. Add it to whatever monitored-alert surface exists (or, minimum,
  document the query) so a recurrence is visible within minutes, not via a user
  report. (Investigate `dev/` alerting; if none, file as a one-line TD with the
  exact audit query.)

---

## Tasks

### Task 1: `jktFromAccessToken` + bound-JKT persistence helpers
Decode the JWT payload (base64url middle segment), return `cnf.jkt` or null.
localStorage read/write for the bound JKT. TDD: test decode of a known token +
absent-cnf returns null.

### Task 2: JKT-verified selection in `ensureAnyActiveKeypair(preferJKT?)`
When `preferJKT` is provided, compute each IDB record's JKT (reuse `computeJKT`
+ `exportKey`) and pick the exact match. No match + preferJKT set → return a
sentinel "unrecoverable" signal (don't activate a wrong key). No preferJKT →
existing newest-wins fallback. TDD: matching key chosen over newer non-matching
key; unrecoverable path returns the signal.

### Task 3: Wire bootstrap + applyLogin
`applyLogin`: after success, `writeBoundJKT(jktFromAccessToken(res.access_token))`.
Bootstrap: `const bound = readBoundJKT(); await ensureAnyActiveKeypair(bound)`;
on unrecoverable signal, clear session + redirect to /login (clean re-auth, no
violation). `logout`/`hardLogout`: clear the persisted bound JKT.

### Task 4: Runtime assert + tech-debt close + alert documentation

### Task 5: Verify — full auth suite, typecheck, and a live re-test against the
audit log (refresh should produce `auth.token_refresh` with NO following
`refresh_dpop_binding_violation`).

---

## Verification (the real proof)

After the fix, the decisive check is the **live audit log**, not just tests:
refresh the page repeatedly and confirm `audit_logs` shows `auth.token_refresh`
events with **zero** subsequent `auth.refresh_dpop_binding_violation`. That is
the runtime evidence the symptom is gone.
