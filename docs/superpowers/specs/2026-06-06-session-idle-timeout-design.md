# Configurable Session Idle Timeout (two-tier) — Design

**Date:** 2026-06-06
**Status:** Approved (design), pending implementation plan
**Origin:** Diagnosis of "random logouts" (2026-06-05). Root cause: the auth
middleware's "idle timeout" is not an idle timeout at all — it reads
`COALESCE(users_sessions_rotated_at, users_sessions_created_at)` (frozen at
session birth / last rotation) and `users_sessions_last_used_at` is **never
written by any Go code**. The effect is a ~30-minute *absolute* session cap that
boots actively-working users. See diagnosis notes in the session transcript.

---

## 1. Problem

`backend/internal/auth/middleware.go` (~L218) enforces:

```go
idleTTL := parseDurationEnv("SESSION_IDLE_TTL", 30*time.Minute)
if time.Since(st.LastActivityAt) > idleTTL {
    writeAuthFailureCoded(w, r, CodeSessionIdleExpired, ...)  // → 401 → hardLogout
}
```

…but `st.LastActivityAt` comes from `sqlSelectUserBySessionID` (`backend/internal/auth/sql.go` ~L84):

```sql
COALESCE(s.users_sessions_rotated_at, s.users_sessions_created_at) AS last_activity_at
```

Evidence (live DB, user `6cabe266…`):
- `users_sessions_last_used_at == users_sessions_created_at` on **2322 / 2322**
  sessions — the column has never once advanced.
- The "idle" anchor only moves on a token rotation (~15 min refresh cycle),
  never on actual activity.
- `session_idle_expired` is a `TERMINAL_SESSION_CODE` (`app/lib/api.ts` ~L105) →
  instant `hardLogout`, no refresh-retry.

This is a misnamed gate: it measures *time-since-rotation*, not *idleness*.

## 2. Goals

1. **Fix the mechanism** so idle-timeout tracks genuine user activity.
2. **Two-tier configurability:**
   - **gadmin** sets a **per-subscription ceiling** (max idle window any user may
     choose). Lives on a new tab on the Tenant Settings admin page.
   - **Each user** picks their own idle timeout, from a sane hard floor up to the
     gadmin ceiling, on their account settings.
3. **Warn-then-logout UX:** a countdown modal before the idle logout fires.
4. **Server is the authoritative gate** — the client never decides its own timeout.

Non-goals (YAGNI): no gadmin-set floor (hard-coded 5 min); no per-workspace
ceiling (per-subscription only); no password-policy / MFA-enforcement controls
this iteration (the new tab is *framed* as their future home but ships only the
idle control).

## 3. Data model

### Tier 1 — Ceiling (gadmin, per-subscription)
New column on `master_record_tenants` (the per-subscription settings sidecar,
owned by `backend/internal/tenantmasterrecord`):

```
master_record_tenants_session_idle_limit_minutes  INTEGER NOT NULL DEFAULT 60
```

Valid range: `5 … 1440` (5 min … 24 h).

### Tier 2 — User choice
New column on `users`:

```
users_session_idle_timeout_minutes  INTEGER NULL
```

`NULL` = "inherit the tenant ceiling" (a brand-new user gets the ceiling, never
a broken 0/absent value).

### Hard floor
Go constant, **not** a column:

```go
const MinIdleTimeoutMinutes = 5
```

### Resolution (server-side, fail-closed)

```
effective_minutes = clamp(user_choice ?? ceiling, MinIdleTimeoutMinutes, ceiling)
```

- `user_choice == NULL`  → `ceiling`
- `user_choice > ceiling` (gadmin lowered the ceiling after the user chose) →
  **ceiling wins** (stricter value).
- `user_choice < 5` (shouldn't persist past validation, but belt-and-braces) →
  `5`.

Computed in the auth middleware path, the sole authority. The client is told the
resolved value only for the warn-modal countdown — it cannot extend its own
session by sending a larger number.

## 4. Backend wiring

### 4.1 Mechanism fix (foundation)
- **Throttled activity write** in `RequireAuth`, after the session resolves live:
  ```sql
  UPDATE users_sessions
     SET users_sessions_last_used_at = NOW()
   WHERE users_sessions_id = $1
     AND users_sessions_last_used_at < NOW() - INTERVAL '60 seconds'
  ```
  ~1 write/min per active session. **Fire-and-forget** — a failed activity write
  must never 401 a good request (`_, _ = Exec(...)`).
- **Read the real column:** change `sqlSelectUserBySessionID` to return
  `s.users_sessions_last_used_at AS last_activity_at` (drop the COALESCE).
- Insert default already seeds `last_used_at = created_at` (correct "just active"
  anchor at login/rotation) — no change at the insert sites.

### 4.2 Migration
One migration (next NNN via the `<migration>` skill, against `vector_artefacts`)
adds both columns with the defaults above. Column names follow the full-table-name
prefix HARD RULE.

### 4.3 `tenantmasterrecord` (ceiling)
- Add `session_idle_limit_minutes` to the GET projection, the PATCH allow-set,
  and server validation (`5 ≤ v ≤ 1440`; 422 with `violations[]` on fail —
  mirror existing field plumbing).
- Wire shape in `app/lib/tenantSettingsApi.ts` (extend `TenantSettings` /
  `TenantSettingsPatch`).

### 4.4 `users` (user choice)
- `GET` current value + the resolved ceiling (so the UI can render the max).
- `PATCH users_session_idle_timeout_minutes`: accept `null` or
  `5 ≤ v ≤ resolvedCeiling`; 422 otherwise. Re-clamp server-side on read
  regardless, so a stale-but-valid stored value never exceeds a lowered ceiling.

### 4.5 `auth` middleware (resolution + gate)
- Replace the hard-coded `SESSION_IDLE_TTL` default with the resolved per-user /
  per-tenant value. Fold the two new columns into the existing session-join query
  (`sqlSelectUserBySessionID` already joins `users` ⋈ `users_sessions`) to keep
  roundtrips flat — no extra query.
- `SESSION_IDLE_TTL` env becomes a last-resort fallback only (e.g. rows with no
  resolvable ceiling).

## 5. Frontend — Tenant Settings tab restructure

Mirror `/workspace-admin/artefacts` exactly (`layout.tsx` + `<TabBar>` +
sub-route folders; parent `page.tsx` redirects to the default tab; **sub-pages are
deep-linked tabs, NOT rail2 entries** — per `docs/c_c_secondary_nav_deeplink.md`).

Target structure:

```
app/(user)/vector-admin/tenant-settings/
  layout.tsx                       → <TabBar tabs=[Tenant Settings, Global User Control] />
  page.tsx                         → redirect("/vector-admin/tenant-settings/tenant-settings")
  tenant-settings/page.tsx         ← existing editor moved here VERBATIM
  global-user-control/page.tsx     ← NEW
```

- **Tab 1 — "Tenant Settings":** the current `master_record_tenants` editor,
  content unchanged, relocated into the sub-route.
- **Tab 2 — "Global User Control":** framed as the tenant's user-policy home.
  Ships one **"Session"** section containing the **"Session idle limit"** control
  (the ceiling): integer minutes input, validated `5 … 1440`, hint
  *"The longest idle period any user in this tenant may choose before being signed
  out. Individual users set their own value up to this limit."* Same
  dirty-tracking / diff-PATCH / inline-422 contract as the existing page. Layout
  leaves room for future sibling sections (password policy, MFA enforcement) but
  none are built now.

`TabBar` config:
```ts
const TABS = [
  { key: "tenant-settings",    label: "Tenant Settings",    href: "/vector-admin/tenant-settings/tenant-settings" },
  { key: "global-user-control",label: "Global User Control",href: "/vector-admin/tenant-settings/global-user-control" },
];
```

Page-access gating (`usePageAccess` + backend `RequirePageAccess`) carries over.
**Decision:** the new sub-page reuses the existing `va-tenant-settings` access key
— it is the same gadmin admin surface, governed by the same grant
(`grp_global`, seeded mig 201). No new page-access row or grant is introduced.
Both tabs therefore share one access gate; a user who can see Tenant Settings can
see Global User Control.

## 6. Frontend — User control + warn-then-logout UX

### 6.1 User idle-timeout control
On `app/user/account-settings/sessions/page.tsx` (the existing sessions page, next
to the active-sessions list): a "Sign me out after [N] minutes of inactivity"
control. Range `[5, resolvedCeiling]`; hint shows the tenant cap
(e.g. *"Your team allows up to 60 min"*). `null`/unset renders as "Use team
default (60 min)".

### 6.2 Warn-then-logout modal
A client idle-watcher (new hook, e.g. `useIdleLogout`):
- Tracks genuine interaction (`pointerdown`, `keydown`, `scroll`, `visibilitychange`),
  debounced; resets a local timer.
- At `effective − 60s` of inactivity → show a countdown modal:
  *"You'll be signed out in 0:60 — Stay signed in?"*.
- **"Stay signed in"** fires any authenticated request (a lightweight ping)
  → server's throttled write advances `last_used_at`; local timer resets.
- Countdown reaches 0 → call the existing **voluntary** `logout()` (not
  `hardLogout`; this is a deliberate, user-visible expiry).
- Respect `prefers-reduced-motion` (no springy entrance; opacity fade only, per
  Vector motion rules).
- The modal is **client convenience only.** The server idle check remains the
  authoritative gate: a tab that suppresses the modal still gets a
  `session_idle_expired` 401 from the backend once genuinely idle past the
  resolved timeout.

## 7. Testing & security

- **Resolution unit tests:** `user<ceiling` → user; `user>ceiling` → ceiling;
  `user==null` → ceiling; `user<5` → 5; floor + ceiling boundaries.
- **Middleware tests:** an idle-past-timeout request 401s `session_idle_expired`;
  an active request advances `users_sessions_last_used_at` (and the throttle skips
  writes <60s apart); the resolved timeout is the per-user value, not the env default.
- **Validation tests:** both tiers reject out-of-range with 422 + `violations[]`.
- **Security pin (server-is-the-gate HARD RULE):** a test asserting the *server*
  computes the effective timeout — a forged/inflated client value cannot extend
  the session. The wire response to the client carries the resolved value for the
  modal but is not trusted as input to the gate.

## 8. Tech debt

This **pays down** the misnamed-idle-check debt rather than adding any. The fix
(activity-tracked `last_used_at` + real idle read) is noted in the commit. No new
`TD-*` entry required; if the warn-modal UX is descoped at implementation time it
becomes a follow-up story, not debt.

## 9. Decomposition (≈6 stories)

1. **Migration** — two columns on `master_record_tenants` + `users`.
2. **Mechanism fix** — throttled `last_used_at` write + real-column read + resolution in middleware.
3. **Ceiling BE+FE** — `tenantmasterrecord` PATCH/validation + Global User Control tab content.
4. **User choice BE+FE** — `users` GET/PATCH + account-settings/sessions control.
5. **Tab restructure** — `layout.tsx` + `<TabBar>` + relocate existing editor into sub-route + parent redirect.
6. **Warn-then-logout modal** — `useIdleLogout` hook + countdown modal + reduced-motion.

(Stories 2 + 3/4 share the resolution helper; sequence migration → mechanism →
settings tiers → tab/UX.)
