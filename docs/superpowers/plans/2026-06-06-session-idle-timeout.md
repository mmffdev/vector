# Session Idle Timeout (two-tier) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken "idle timeout" (a frozen absolute session cap) with a real activity-tracked idle timeout, configurable two-tier — a per-subscription gadmin ceiling and a per-user choice — resolved server-side, with a warn-then-logout modal.

**Architecture:** The auth middleware advances `users_sessions_last_used_at` on a throttled cadence and reads it for the idle check. The effective timeout = `clamp(user_choice ?? ceiling, 5, ceiling)`, computed in SQL inside the existing session-join query (zero extra roundtrips). The gadmin ceiling lives on `master_record_tenants` (sole writer `tenantmasterrecord`); the user choice lives on `users` (self-service `/me` route). Frontend restructures the Tenant Settings page into a `<TabBar>` layout and adds a client idle-watcher hook.

**Tech Stack:** Go (chi, pgx/v5), Next.js 15 / React 18, hand-written CSS, Postgres (`vector_artefacts`). Migrations via the `<migration>` skill. Backend env pinned to `dev`.

**Spec:** `docs/superpowers/specs/2026-06-06-session-idle-timeout-design.md`
**Branch:** `feature/session-idle-timeout`

---

## File Structure

**Backend**
- `dev/migrations/` — one new migration (NNN via `<migration>` skill): two columns.
- `backend/internal/auth/sql.go` — extend `sqlSelectUserBySessionID`; add `sqlTouchSessionActivity`.
- `backend/internal/auth/service.go` — `SessionState.EffectiveIdleMinutes`; scan it; `TouchSessionActivity`.
- `backend/internal/auth/middleware.go` — throttled touch + use resolved minutes.
- `backend/internal/auth/middleware_test.go` — idle-gate + activity tests (create if absent).
- `backend/internal/tenantmasterrecord/{service,sql,handler}.go` — ceiling field end-to-end.
- `backend/internal/tenantmasterrecord/service_test.go` — ceiling validation tests.
- `backend/internal/users/{prefs,sql}.go` — user idle-timeout get/set.
- `backend/internal/users/prefs_idle_test.go` — user-choice validation tests (create).
- `backend/internal/auth/handler.go` — surface resolved idle minutes on `/auth/me`.
- `backend/cmd/server/main.go` — mount `PUT /me/idle-timeout`.

**Frontend**
- `app/lib/tenantSettingsApi.ts` — add ceiling field to types.
- `app/(user)/vector-admin/tenant-settings/layout.tsx` — NEW (`<TabBar>`).
- `app/(user)/vector-admin/tenant-settings/page.tsx` — becomes a redirect.
- `app/(user)/vector-admin/tenant-settings/tenant-settings/page.tsx` — relocated existing editor.
- `app/(user)/vector-admin/tenant-settings/global-user-control/page.tsx` — NEW (ceiling control).
- `app/lib/meIdleTimeoutApi.ts` — NEW (user get/set client).
- `app/hooks/useIdleLogout.ts` — NEW (idle-watcher + countdown).
- `app/components/IdleLogoutModal.tsx` — NEW (countdown modal).
- `app/user/account-settings/sessions/page.tsx` — add user idle-timeout control.

---

## Task 1: Migration — two columns

**Files:**
- Create: migration via `<migration>` skill (DB: `vector_artefacts`).

- [ ] **Step 1: Scaffold + apply the migration**

Invoke the `<migration>` skill, DB `vector_artefacts`, with this body (the skill picks the next NNN, wraps in BEGIN/COMMIT, dry-runs, applies, verifies `schema_migrations`):

```sql
-- Two-tier session idle timeout (spec 2026-06-06).
-- Ceiling: per-subscription, gadmin-set, NOT NULL default 60 (minutes).
ALTER TABLE master_record_tenants
  ADD COLUMN master_record_tenants_session_idle_limit_minutes INTEGER NOT NULL DEFAULT 60
  CHECK (master_record_tenants_session_idle_limit_minutes BETWEEN 5 AND 1440);

-- User choice: NULL = inherit the tenant ceiling.
ALTER TABLE users
  ADD COLUMN users_session_idle_timeout_minutes INTEGER NULL
  CHECK (users_session_idle_timeout_minutes IS NULL
         OR users_session_idle_timeout_minutes BETWEEN 5 AND 1440);
```

- [ ] **Step 2: Verify columns exist**

Run (via the project's psql path / pg-mcp wrapper):
```sql
SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_name IN ('master_record_tenants','users')
   AND column_name IN ('master_record_tenants_session_idle_limit_minutes',
                       'users_session_idle_timeout_minutes');
```
Expected: two rows; ceiling `integer`, default `60`, NOT NULL; user `integer`, default null, NULL.

- [ ] **Step 3: Regenerate SY003** (HARD RULE — substrate changed)

Run `<report> -sy` with the standard Vector-databases inventory prompt (see CLAUDE.md SY003 rule). Confirm the two new columns appear.

- [ ] **Step 4: Commit**

```bash
git add dev/migrations
git commit -m "feat(auth): add session idle-timeout columns (ceiling + user choice) [migration]"
```

---

## Task 2: Mechanism fix — activity write + real-column read + resolution

This is the task that stops the random logouts. `EffectiveIdleMinutes` is resolved in SQL so the middleware needs no extra query.

**Files:**
- Modify: `backend/internal/auth/sql.go` (`sqlSelectUserBySessionID`; add `sqlTouchSessionActivity`)
- Modify: `backend/internal/auth/service.go` (`SessionState`; scan; `TouchSessionActivity`)
- Modify: `backend/internal/auth/middleware.go` (~L208-222)
- Test: `backend/internal/auth/middleware_test.go`

- [ ] **Step 1: Extend the session-join query to read real activity + resolved minutes**

In `backend/internal/auth/sql.go`, replace the `sqlSelectUserBySessionID` constant's last projected column and add the resolution. The new SELECT tail (replace lines 82-90, the `s.users_sessions_revoked` line onward) becomes:

```go
		       s.users_sessions_revoked,
		       s.users_sessions_last_used_at AS last_activity_at,
		       GREATEST(5, LEAST(
		           COALESCE(u.users_session_idle_timeout_minutes,
		                    t.master_record_tenants_session_idle_limit_minutes,
		                    60),
		           COALESCE(t.master_record_tenants_session_idle_limit_minutes, 60)
		       )) AS effective_idle_minutes
		FROM users u
		JOIN users_sessions s
		  ON s.users_sessions_id_user = u.users_id
		 AND s.users_sessions_id      = $2
		LEFT JOIN master_record_tenants t
		  ON t.master_record_tenants_id_subscription = u.users_id_subscription
		WHERE u.users_id = $1
	`
```

Note: `last_activity_at` now reads the real `users_sessions_last_used_at` (was `COALESCE(rotated_at, created_at)`). The `LEFT JOIN` + `COALESCE(...,60)` keeps it null-safe if a tenant row is missing.

- [ ] **Step 2: Add the throttled activity-write SQL constant**

Append to `backend/internal/auth/sql.go`:

```go
// sqlTouchSessionActivity advances users_sessions_last_used_at on a
// throttled cadence — only when the row is >60s stale — so an active
// session keeps its idle clock fresh without a write on every request.
// Fire-and-forget at the call site; a failed touch must never 401 a
// good request.
const sqlTouchSessionActivity = `
		UPDATE users_sessions
		   SET users_sessions_last_used_at = NOW()
		 WHERE users_sessions_id = $1
		   AND users_sessions_last_used_at < NOW() - INTERVAL '60 seconds'
	`
```

- [ ] **Step 3: Add `EffectiveIdleMinutes` to `SessionState` and scan it**

In `backend/internal/auth/service.go`, change the `SessionState` struct (L402-405):

```go
type SessionState struct {
	Revoked              bool
	LastActivityAt       time.Time
	EffectiveIdleMinutes int
}
```

In `FindUserBySessionID`, extend the `.Scan(...)` (the final two scan targets at ~L423) to:

```go
		&st.Revoked, &st.LastActivityAt, &st.EffectiveIdleMinutes,
	)
```

- [ ] **Step 4: Add the `TouchSessionActivity` service method**

Append to `backend/internal/auth/service.go` (near the other session helpers):

```go
// TouchSessionActivity advances the session's last-used timestamp on a
// throttled cadence (see sqlTouchSessionActivity). Errors are swallowed
// by the caller — this is a best-effort freshness write, never a gate.
func (s *Service) TouchSessionActivity(ctx context.Context, sessionID uuid.UUID) {
	_, _ = s.Pool.Exec(ctx, sqlTouchSessionActivity, sessionID)
}
```

- [ ] **Step 5: Use the resolved minutes + touch activity in middleware**

In `backend/internal/auth/middleware.go`, replace the idle block (L218-222) with:

```go
			idleTTL := time.Duration(st.EffectiveIdleMinutes) * time.Minute
			if idleTTL <= 0 {
				idleTTL = parseDurationEnv("SESSION_IDLE_TTL", 30*time.Minute)
			}
			if time.Since(st.LastActivityAt) > idleTTL {
				writeAuthFailureCoded(w, r, CodeSessionIdleExpired, usermessages.AuthSessionIdleExpired, "session_idle_expired")
				return
			}
			// Best-effort: keep the idle clock fresh for active sessions.
			// Throttled to <=1 write/min/session; never blocks the request.
			s.TouchSessionActivity(r.Context(), sid)
```

- [ ] **Step 6: Write failing tests**

Create/extend `backend/internal/auth/middleware_test.go`. If the file exists, add these; otherwise create it with the package's existing test harness imports. Use the package's existing test DB/pool helper (grep `func newTestService` or similar in `service_test.go` and reuse it):

```go
func TestRequireAuth_IdleExpiredSession401s(t *testing.T) {
	svc := newTestAuthService(t) // reuse existing helper
	uid, sid := seedActiveSession(t, svc) // helper: inserts user+tenant+session
	// Force the session stale beyond the resolved ceiling (default 60m).
	_, err := svc.Pool.Exec(context.Background(),
		`UPDATE users_sessions SET users_sessions_last_used_at = NOW() - INTERVAL '61 minutes' WHERE users_sessions_id = $1`, sid)
	if err != nil { t.Fatal(err) }
	_, st, err := svc.FindUserBySessionID(context.Background(), uid, sid)
	if err != nil { t.Fatal(err) }
	if time.Since(st.LastActivityAt) <= time.Duration(st.EffectiveIdleMinutes)*time.Minute {
		t.Fatalf("expected session to read as idle-expired: idle=%v ttl=%dm",
			time.Since(st.LastActivityAt), st.EffectiveIdleMinutes)
	}
}

func TestFindUserBySessionID_ResolvesEffectiveMinutes(t *testing.T) {
	svc := newTestAuthService(t)
	uid, sid := seedActiveSession(t, svc) // tenant ceiling defaults to 60, user choice NULL
	_, st, err := svc.FindUserBySessionID(context.Background(), uid, sid)
	if err != nil { t.Fatal(err) }
	if st.EffectiveIdleMinutes != 60 {
		t.Fatalf("user choice NULL should inherit ceiling 60, got %d", st.EffectiveIdleMinutes)
	}
	// User picks 15 (< ceiling) → effective 15.
	_, _ = svc.Pool.Exec(context.Background(),
		`UPDATE users SET users_session_idle_timeout_minutes = 15 WHERE users_id = $1`, uid)
	_, st, _ = svc.FindUserBySessionID(context.Background(), uid, sid)
	if st.EffectiveIdleMinutes != 15 {
		t.Fatalf("user choice 15 should win, got %d", st.EffectiveIdleMinutes)
	}
	// User picks 600 (> ceiling 60) → clamped to ceiling 60.
	_, _ = svc.Pool.Exec(context.Background(),
		`UPDATE users SET users_session_idle_timeout_minutes = 600 WHERE users_id = $1`, uid)
	_, st, _ = svc.FindUserBySessionID(context.Background(), uid, sid)
	if st.EffectiveIdleMinutes != 60 {
		t.Fatalf("user choice over ceiling should clamp to 60, got %d", st.EffectiveIdleMinutes)
	}
}

func TestTouchSessionActivity_AdvancesLastUsed(t *testing.T) {
	svc := newTestAuthService(t)
	_, sid := seedActiveSession(t, svc)
	_, _ = svc.Pool.Exec(context.Background(),
		`UPDATE users_sessions SET users_sessions_last_used_at = NOW() - INTERVAL '5 minutes' WHERE users_sessions_id = $1`, sid)
	svc.TouchSessionActivity(context.Background(), sid)
	var stale bool
	_ = svc.Pool.QueryRow(context.Background(),
		`SELECT users_sessions_last_used_at < NOW() - INTERVAL '60 seconds' FROM users_sessions WHERE users_sessions_id = $1`, sid).Scan(&stale)
	if stale { t.Fatal("expected last_used_at to be advanced to within 60s of now") }
}
```

If `seedActiveSession`/`newTestAuthService` helpers don't exist, add a minimal one in the test file that inserts a subscription row, a `master_record_tenants` row (or rely on the column default), a `users` row, and a `users_sessions` row, returning `(userID, sessionID)`. Grep `service_test.go` first — the package very likely already has seeding helpers to reuse.

- [ ] **Step 7: Run tests to verify they fail (pre-implementation state if checking out) / pass (post)**

Run: `cd backend && go test ./internal/auth/ -run 'IdleExpired|ResolvesEffective|TouchSession' -v`
Expected after Steps 1-5: PASS. (If you wrote tests first against un-migrated code, they fail on the missing column — that's the red.)

- [ ] **Step 8: Build the backend + restart dev server, smoke-check no logout storm**

Run: `cd backend && go build ./... && go vet ./internal/auth/`
Expected: clean build, no vet errors. Then restart the Go server (dev env) so the new binary is live.

- [ ] **Step 9: Commit**

```bash
git add backend/internal/auth
git commit -m "fix(auth): real activity-tracked idle timeout + server-resolved per-user/tenant TTL

Replaces the frozen COALESCE(rotated_at,created_at) idle anchor (a 30min
absolute cap that booted active users) with a throttled last_used_at write
and a SQL-resolved effective timeout = clamp(user ?? ceiling, 5, ceiling)."
```

---

## Task 3: Ceiling — backend (tenantmasterrecord)

**Files:**
- Modify: `backend/internal/tenantmasterrecord/service.go` (Settings, PatchInput, validation)
- Modify: `backend/internal/tenantmasterrecord/sql.go` (select + nothing else — UPDATE is templated)
- Test: `backend/internal/tenantmasterrecord/service_test.go`

- [ ] **Step 1: Add the field to the wire + patch structs**

In `backend/internal/tenantmasterrecord/service.go`, add to `Settings` (after `TenantBuildChangesetTracking`):

```go
	TenantSessionIdleLimitMinutes int        `json:"tenant_session_idle_limit_minutes"`
```

Add to `PatchInput`:

```go
	TenantSessionIdleLimitMinutes *int      `json:"tenant_session_idle_limit_minutes,omitempty"`
```

- [ ] **Step 2: Read the column**

In `sql.go`, add to `sqlSelectTenantSettings` SELECT list (after the `build_changeset_tracking` COALESCE line, before `master_record_tenants_notes`):

```go
		       COALESCE(master_record_tenants_session_idle_limit_minutes, 60)              AS master_record_tenants_session_idle_limit_minutes,
```

In `service.go` `read()`, add the scan target in the matching position (after `&x.TenantBuildChangesetTracking,` and before `&x.TenantNotes,`):

```go
		&x.TenantSessionIdleLimitMinutes,
```

- [ ] **Step 3: Validate + set in Patch**

In `service.go` `Patch`, add a validation block (alongside the others, e.g. after the `TenantBuildChangesetTracking` block):

```go
	if in.TenantSessionIdleLimitMinutes != nil {
		v := *in.TenantSessionIdleLimitMinutes
		if v < 5 || v > 1440 {
			violations = append(violations, Violation{Field: "tenant_session_idle_limit_minutes", Message: "must be between 5 and 1440 minutes"})
		} else {
			addSet("master_record_tenants_session_idle_limit_minutes", v)
		}
	}
```

- [ ] **Step 4: Write failing tests**

Add to `backend/internal/tenantmasterrecord/service_test.go` (reuse the file's existing `newTestService`/seed helper):

```go
func TestPatch_SessionIdleLimit_Valid(t *testing.T) {
	svc, subID, actorID := newTestTenantService(t)
	v := 90
	out, err := svc.Patch(context.Background(), subID, actorID, PatchInput{TenantSessionIdleLimitMinutes: &v})
	if err != nil { t.Fatal(err) }
	if out.TenantSessionIdleLimitMinutes != 90 {
		t.Fatalf("want 90, got %d", out.TenantSessionIdleLimitMinutes)
	}
}

func TestPatch_SessionIdleLimit_OutOfRange(t *testing.T) {
	svc, subID, actorID := newTestTenantService(t)
	for _, bad := range []int{4, 1441} {
		v := bad
		_, err := svc.Patch(context.Background(), subID, actorID, PatchInput{TenantSessionIdleLimitMinutes: &v})
		var ve *ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("value %d should produce a ValidationError, got %v", bad, err)
		}
	}
}
```

If `newTestTenantService` doesn't exist, grep `service_test.go` for the existing harness name and use it.

- [ ] **Step 5: Run tests**

Run: `cd backend && go test ./internal/tenantmasterrecord/ -run 'SessionIdleLimit' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/tenantmasterrecord
git commit -m "feat(tenantmasterrecord): per-subscription session idle-limit ceiling field"
```

---

## Task 4: Ceiling — frontend (TabBar restructure + Global User Control)

**Files:**
- Modify: `app/lib/tenantSettingsApi.ts`
- Create: `app/(user)/vector-admin/tenant-settings/layout.tsx`
- Modify→Create: relocate editor to `app/(user)/vector-admin/tenant-settings/tenant-settings/page.tsx`
- Replace: `app/(user)/vector-admin/tenant-settings/page.tsx` (redirect)
- Create: `app/(user)/vector-admin/tenant-settings/global-user-control/page.tsx`

- [ ] **Step 1: Add the ceiling field to the API types**

In `app/lib/tenantSettingsApi.ts`, add `tenant_session_idle_limit_minutes: number;` to the `TenantSettings` type and `tenant_session_idle_limit_minutes?: number;` to `TenantSettingsPatch`.

- [ ] **Step 2: Create the tab layout**

Create `app/(user)/vector-admin/tenant-settings/layout.tsx`:

```tsx
import TabBar from "@/app/components/TabBar";

const TABS = [
  { key: "tenant-settings",     label: "Tenant Settings",     href: "/vector-admin/tenant-settings/tenant-settings" },
  { key: "global-user-control", label: "Global User Control", href: "/vector-admin/tenant-settings/global-user-control" },
];

export default function TenantSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TabBar tabs={TABS} ariaLabel="Tenant settings sections" />
      {children}
    </>
  );
}
```

- [ ] **Step 3: Relocate the existing editor into the sub-route**

Move the current editor file into the new tab folder (git mv keeps history):

```bash
mkdir -p "app/(user)/vector-admin/tenant-settings/tenant-settings"
git mv "app/(user)/vector-admin/tenant-settings/page.tsx" \
       "app/(user)/vector-admin/tenant-settings/tenant-settings/page.tsx"
```

The moved file needs no content change — it's a self-contained client page.

- [ ] **Step 4: Recreate the parent as a redirect**

Create `app/(user)/vector-admin/tenant-settings/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function TenantSettingsIndex() {
  redirect("/vector-admin/tenant-settings/tenant-settings");
}
```

- [ ] **Step 5: Create the Global User Control page**

Create `app/(user)/vector-admin/tenant-settings/global-user-control/page.tsx`. This mirrors the existing editor's load/dirty/diff/save contract but with a single field. Use the same `tenantSettingsApi`, `usePageAccess("va-tenant-settings")`, `UnsavedChangesBar`, and inline-422 pattern:

```tsx
"use client";

// Global User Control — tenant-wide user-policy home (spec 2026-06-06).
// Ships the session idle-limit ceiling; framed for future siblings
// (password policy, MFA enforcement). Same PATCH/422 contract as the
// Tenant Settings editor. Shares the va-tenant-settings access key.

import { useCallback, useEffect, useMemo, useState } from "react";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import UnsavedChangesBar from "@/app/components/UnsavedChangesBar";
import { useSentinel } from "@/app/sentinel";
import { usePageAccess } from "@/app/contexts/PageAccessContext";
import PageAccessDenied from "@/app/components/PageAccessDenied";
import { ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { tenantSettingsApi } from "@/app/lib/tenantSettingsApi";

export default function GlobalUserControlPage() {
  const { sentinel_user: user } = useSentinel();
  const access = usePageAccess("va-tenant-settings");
  const { full } = usePageTitle();

  if (user && access.allowed === false) return <PageAccessDenied pageLabel="Global User Control" />;
  if (!user || access.loading || access.allowed !== true) return null;

  const [original, setOriginal] = useState<number | null>(null);
  const [value, setValue] = useState<number>(60);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const row = await tenantSettingsApi.get();
      setOriginal(row.tenant_session_idle_limit_minutes);
      setValue(row.tenant_session_idle_limit_minutes);
      setError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load settings.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => original !== null && value !== original, [original, value]);

  const validateLocal = (v: number): string | null => {
    if (!Number.isInteger(v)) return "Enter a whole number of minutes.";
    if (v < 5 || v > 1440) return "Must be between 5 and 1440 minutes.";
    return null;
  };

  const onAccept = useCallback(async () => {
    const e = validateLocal(value);
    if (e) { setError(e); notify.error("Please fix the highlighted field."); return; }
    setSaving(true);
    try {
      const fresh = await tenantSettingsApi.patch({ tenant_session_idle_limit_minutes: value });
      setOriginal(fresh.tenant_session_idle_limit_minutes);
      setValue(fresh.tenant_session_idle_limit_minutes);
      setError(null);
      notify.success("Global user control saved.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.violations) {
        const v = err.violations.find((x) => x.field === "tenant_session_idle_limit_minutes");
        setError(v?.message ?? "Validation failed.");
        notify.error("Validation failed. Please review and resave.");
      } else {
        notify.apiError(err, "Failed to save.");
      }
    } finally { setSaving(false); }
  }, [value]);

  const onDiscard = useCallback(() => { if (original !== null) { setValue(original); setError(null); } }, [original]);

  if (loading) return <PageContent><div className="settings-panel"><p className="form__hint">Loading…</p></div></PageContent>;
  if (loadError) return (
    <PageContent><div className="settings-panel">
      <p className="form__error">{loadError}</p>
      <div className="form__actions"><button type="button" className="btn btn--ghost" onClick={load}>Retry</button></div>
    </div></PageContent>
  );

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Tenant-wide user-policy controls." />
      <PageDescription>
        Set tenant-wide limits that govern how users in this subscription work. These ceilings apply to every user; individuals choose their own value within them.
      </PageDescription>
      <Panel name="panel_global_user_control_header" className="page-panel-heading" title="Global User Control" description="Tenant-wide user-policy ceilings." />
      <div className="settings-panel">
        <h3 className="eyebrow">Session</h3>
        <div className="form">
          <div className="form__row">
            <label className="form__label" htmlFor="tenant_session_idle_limit_minutes">
              Session idle limit (minutes)
              <input
                type="number"
                id="tenant_session_idle_limit_minutes"
                name="tenant_session_idle_limit_minutes"
                className={`form__input${error ? " has-error" : ""}`}
                min={5}
                max={1440}
                value={value}
                onChange={(e) => { setValue(Number(e.target.value)); setError(null); }}
              />
              {error
                ? <span className="form__error">{error}</span>
                : <span className="form__hint">The longest idle period any user in this tenant may choose before being signed out. Individual users set their own value up to this limit (minimum 5 minutes).</span>}
            </label>
          </div>
        </div>
        <UnsavedChangesBar
          dirty={dirty}
          saving={saving}
          message="You have unsaved changes to global user control."
          onAccept={onAccept}
          onDiscard={onDiscard}
        />
      </div>
    </PageContent>
  );
}
```

- [ ] **Step 6: Verify the page-title hook has a label for the new route**

Grep how `usePageTitle()` resolves titles (likely a `pages` row or a route map). Run:
```bash
grep -rn "tenant-settings" app/ --include="*.ts*" | grep -i "title\|label\|pages" | head
```
If titles come from the `pages` table / nav registry, add a `pages` row (or nav entry) for `global-user-control` so `full` renders. If the hook derives from the path, no action. Note the finding inline; if a `pages` insert is needed, do it via a follow-up migration in this task's commit or flag it.

- [ ] **Step 7: Lint + typecheck**

Run: `npm run lint -- --max-warnings=0 2>&1 | tail -20` and `npx tsc --noEmit 2>&1 | tail -20`
Expected: no new errors from the touched files. (Watch `lint:page-description` — every `app/(user)/` page needs `<PageDescription>`; both new pages have it.)

- [ ] **Step 8: Visual check in the app**

Use the `<run>`/playwright path or open `http://localhost:5101/vector-admin/tenant-settings?meg=<node>`: confirm two tabs render, the first shows the existing editor, "Global User Control" shows the idle-limit input, and the indicator animates. Confirm the sub-pages do NOT appear on rail2.

- [ ] **Step 9: Inspect index + commit** (HARD RULE — `git diff --cached --stat` in full; the `git mv` rename must be the only relocation)

```bash
git add "app/(user)/vector-admin/tenant-settings" app/lib/tenantSettingsApi.ts
git diff --cached --stat
git commit -m "feat(tenant-settings): TabBar restructure + Global User Control tab (session idle ceiling)"
```

---

## Task 5: User choice — backend (users self-service)

**Files:**
- Modify: `backend/internal/users/sql.go` (new constants)
- Modify: `backend/internal/users/prefs.go` (service + handler)
- Modify: `backend/internal/auth/handler.go` (surface on `/auth/me`)
- Modify: `backend/cmd/server/main.go` (route + payload)
- Test: `backend/internal/users/prefs_idle_test.go` (create)

- [ ] **Step 1: SQL — read resolved + write user choice**

Append to `backend/internal/users/sql.go`:

```go
// sqlSelectUserIdleTimeout returns the user's chosen idle timeout (NULL =
// inherit) alongside the resolved effective value (clamped to the tenant
// ceiling, floored at 5). The frontend renders the chosen value in the
// control and the ceiling as the max.
const sqlSelectUserIdleTimeout = `
		SELECT u.users_session_idle_timeout_minutes,
		       COALESCE(t.master_record_tenants_session_idle_limit_minutes, 60) AS ceiling
		  FROM users u
		  LEFT JOIN master_record_tenants t
		    ON t.master_record_tenants_id_subscription = u.users_id_subscription
		 WHERE u.users_id = $1
	`

// sqlUpdateUserIdleTimeout writes the user's chosen idle timeout. NULL
// clears the choice (inherit the ceiling).
const sqlUpdateUserIdleTimeout = `UPDATE users SET users_session_idle_timeout_minutes = $1, users_updated_at = NOW() WHERE users_id = $2`
```

- [ ] **Step 2: Service methods**

Append to `backend/internal/users/prefs.go`:

```go
// ── Session idle timeout (user choice) — spec 2026-06-06 ─────────────────────

// IdleTimeout is the wire shape for GET /me/idle-timeout.
type IdleTimeout struct {
	ChosenMinutes  *int `json:"chosen_minutes"`  // null = inherit ceiling
	CeilingMinutes int  `json:"ceiling_minutes"` // tenant ceiling
}

// GetIdleTimeout returns the user's chosen value (or null) and the
// tenant ceiling.
func (s *Service) GetIdleTimeout(ctx context.Context, userID uuid.UUID) (IdleTimeout, error) {
	var out IdleTimeout
	err := s.Pool.QueryRow(ctx, sqlSelectUserIdleTimeout, userID).Scan(&out.ChosenMinutes, &out.CeilingMinutes)
	return out, err
}

// SetIdleTimeout persists the user's chosen idle timeout. A nil value
// clears the choice (inherit). Non-nil must be 5..ceiling; the ceiling
// is re-read server-side so a stale client can't exceed it.
func (s *Service) SetIdleTimeout(ctx context.Context, userID uuid.UUID, minutes *int) error {
	cur, err := s.GetIdleTimeout(ctx, userID)
	if err != nil {
		return err
	}
	if minutes != nil {
		if *minutes < 5 || *minutes > cur.CeilingMinutes {
			return ErrInvalidIdleTimeout
		}
	}
	tag, err := s.Pool.Exec(ctx, sqlUpdateUserIdleTimeout, minutes, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
```

Add the sentinel error near the top of `prefs.go` (or wherever the package declares errors — grep `ErrNotFound =` in the users package and co-locate):

```go
var ErrInvalidIdleTimeout = errors.New("idle timeout out of range")
```

- [ ] **Step 3: Handlers**

Append to `backend/internal/users/prefs.go`:

```go
// GetIdleTimeout — GET /me/idle-timeout.
func (h *Handler) GetIdleTimeout(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	out, err := h.Svc.GetIdleTimeout(r.Context(), actor.ID)
	if err != nil {
		log.Printf("users/idle-timeout get error: %v", err)
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

type idleTimeoutReq struct {
	Minutes *int `json:"minutes"` // null clears the choice
}

// SetIdleTimeout — PUT /me/idle-timeout.
func (h *Handler) SetIdleTimeout(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	var req idleTimeoutReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	if err := h.Svc.SetIdleTimeout(r.Context(), actor.ID, req.Minutes); err != nil {
		if errors.Is(err, ErrInvalidIdleTimeout) {
			httperr.WriteValidation(w, r, []httperr.Violation{{Field: "minutes", Message: "must be between 5 and your tenant's session idle limit"}})
			return
		}
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return
		}
		log.Printf("users/idle-timeout set error: %v", err)
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
```

Confirm `writeJSON` exists in the users package (the home-location handler returns 204, but `GetActiveScope` uses `writeJSON` — grep to confirm; if it's named differently, match it).

- [ ] **Step 4: Mount the routes**

In `backend/cmd/server/main.go`, inside the `r.Route("/me", ...)` block (after the `home-location-follow-mode` line ~L1382), add:

```go
		// Session idle timeout — user's own choice within the tenant ceiling.
		r.Get("/idle-timeout", usersH.GetIdleTimeout)
		r.Put("/idle-timeout", usersH.SetIdleTimeout)
```

- [ ] **Step 5: Write failing tests**

Create `backend/internal/users/prefs_idle_test.go` (reuse the package's seed helper — grep `service_test.go` for it):

```go
package users

import (
	"context"
	"errors"
	"testing"
)

func TestSetIdleTimeout_WithinCeiling(t *testing.T) {
	svc, userID := newTestUserWithTenant(t, 60) // ceiling 60
	v := 30
	if err := svc.SetIdleTimeout(context.Background(), userID, &v); err != nil {
		t.Fatal(err)
	}
	out, _ := svc.GetIdleTimeout(context.Background(), userID)
	if out.ChosenMinutes == nil || *out.ChosenMinutes != 30 {
		t.Fatalf("want chosen 30, got %v", out.ChosenMinutes)
	}
	if out.CeilingMinutes != 60 {
		t.Fatalf("want ceiling 60, got %d", out.CeilingMinutes)
	}
}

func TestSetIdleTimeout_OverCeiling_Rejected(t *testing.T) {
	svc, userID := newTestUserWithTenant(t, 60)
	v := 120
	err := svc.SetIdleTimeout(context.Background(), userID, &v)
	if !errors.Is(err, ErrInvalidIdleTimeout) {
		t.Fatalf("want ErrInvalidIdleTimeout, got %v", err)
	}
}

func TestSetIdleTimeout_BelowFloor_Rejected(t *testing.T) {
	svc, userID := newTestUserWithTenant(t, 60)
	v := 4
	if err := svc.SetIdleTimeout(context.Background(), userID, &v); !errors.Is(err, ErrInvalidIdleTimeout) {
		t.Fatalf("want ErrInvalidIdleTimeout for 4, got %v", err)
	}
}

func TestSetIdleTimeout_NullClears(t *testing.T) {
	svc, userID := newTestUserWithTenant(t, 60)
	if err := svc.SetIdleTimeout(context.Background(), userID, nil); err != nil {
		t.Fatal(err)
	}
	out, _ := svc.GetIdleTimeout(context.Background(), userID)
	if out.ChosenMinutes != nil {
		t.Fatalf("want nil chosen, got %v", *out.ChosenMinutes)
	}
}
```

Add `newTestUserWithTenant(t, ceiling)` if no equivalent exists — insert subscription + `master_record_tenants` (with the given ceiling) + `users` row, return `(svc, userID)`.

- [ ] **Step 6: Run tests**

Run: `cd backend && go test ./internal/users/ -run 'IdleTimeout' -v`
Expected: PASS.

- [ ] **Step 7: Build**

Run: `cd backend && go build ./... && go vet ./internal/users/ ./cmd/server/`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/users backend/cmd/server/main.go
git commit -m "feat(users): self-service session idle-timeout choice (clamped to tenant ceiling)"
```

---

## Task 6: User choice — frontend control on account-settings/sessions

**Files:**
- Create: `app/lib/meIdleTimeoutApi.ts`
- Modify: `app/user/account-settings/sessions/page.tsx`

- [ ] **Step 1: API client**

Create `app/lib/meIdleTimeoutApi.ts`:

```ts
import { apiSite } from "@/app/lib/api";

export interface IdleTimeout {
  chosen_minutes: number | null; // null = inherit ceiling
  ceiling_minutes: number;
}

export const meIdleTimeoutApi = {
  get: () => apiSite<IdleTimeout>("/me/idle-timeout"),
  set: (minutes: number | null) =>
    apiSite<void>("/me/idle-timeout", { method: "PUT", body: JSON.stringify({ minutes }) }),
};
```

(Confirm `apiSite`'s option shape — grep an existing PUT caller, e.g. in the sessions page, to match `method`/`body` exactly.)

- [ ] **Step 2: Add the control to the sessions page**

In `app/user/account-settings/sessions/page.tsx`, add a `<Panel>` section above or below the sessions table with a number input bound to `meIdleTimeoutApi`. Minimal addition (place inside the existing return, following the page's `<Panel>`/`Table` idiom):

```tsx
// near other imports
import { meIdleTimeoutApi, type IdleTimeout } from "@/app/lib/meIdleTimeoutApi";

// inside the component, with the other state:
const [idle, setIdle] = useState<IdleTimeout | null>(null);
const [idleDraft, setIdleDraft] = useState<string>("");
const [idleSaving, setIdleSaving] = useState(false);

useEffect(() => {
  meIdleTimeoutApi.get().then((v) => {
    setIdle(v);
    setIdleDraft(v.chosen_minutes === null ? "" : String(v.chosen_minutes));
  }).catch(() => {});
}, []);

const saveIdle = useCallback(async () => {
  if (!idle) return;
  const trimmed = idleDraft.trim();
  const minutes = trimmed === "" ? null : Number(trimmed);
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 5 || minutes > idle.ceiling_minutes)) {
    notify.error(`Enter a whole number between 5 and ${idle.ceiling_minutes}, or leave blank to use the team default.`);
    return;
  }
  setIdleSaving(true);
  try {
    await meIdleTimeoutApi.set(minutes);
    const fresh = await meIdleTimeoutApi.get();
    setIdle(fresh);
    setIdleDraft(fresh.chosen_minutes === null ? "" : String(fresh.chosen_minutes));
    notify.success("Idle timeout saved.");
  } catch (err) {
    notify.apiError(err, "Failed to save idle timeout.");
  } finally {
    setIdleSaving(false);
  }
}, [idle, idleDraft]);
```

And the JSX section (inside the return, as its own `<Panel>`):

```tsx
{idle && (
  <Panel name="panel_idle_timeout" title="Automatic sign-out" description="Sign me out after a period of inactivity.">
    <div className="form__row">
      <label className="form__label" htmlFor="idle_timeout_minutes">
        Sign me out after (minutes of inactivity)
        <input
          type="number"
          id="idle_timeout_minutes"
          className="form__input"
          min={5}
          max={idle.ceiling_minutes}
          placeholder={`Team default (${idle.ceiling_minutes})`}
          value={idleDraft}
          onChange={(e) => setIdleDraft(e.target.value)}
        />
        <span className="form__hint">
          {`Leave blank to use your team default. Your team allows up to ${idle.ceiling_minutes} minutes (minimum 5).`}
        </span>
      </label>
      <button type="button" className="btn btn--primary" disabled={idleSaving} onClick={saveIdle}>
        {idleSaving ? "Saving…" : "Save"}
      </button>
    </div>
  </Panel>
)}
```

Ensure `useCallback` and `notify` are imported (the page already imports `notify`; add `useCallback` to the React import if missing).

- [ ] **Step 3: Lint + typecheck**

Run: `npm run lint -- --max-warnings=0 2>&1 | tail -20` and `npx tsc --noEmit 2>&1 | tail -20`
Expected: no new errors.

- [ ] **Step 4: Visual check**

Open `http://localhost:5101/user/account-settings/sessions`. Confirm the control renders, shows the ceiling in the hint, rejects out-of-range, and a blank value saves as "team default".

- [ ] **Step 5: Commit**

```bash
git add app/lib/meIdleTimeoutApi.ts app/user/account-settings/sessions/page.tsx
git commit -m "feat(account-settings): per-user idle-timeout control on sessions page"
```

---

## Task 7: Surface resolved idle minutes on /auth/me (for the modal)

**Files:**
- Modify: `backend/internal/auth/handler.go` (userPayload + buildUserPayload)
- Modify: `backend/internal/auth/service.go` (a tiny resolver the handler can call) OR reuse `GetIdleTimeout` from users — see Step 1.

- [ ] **Step 1: Decide the source + add the field**

The handler needs the resolved effective minutes for the *current* user so the client modal knows when to fire. Reuse the same SQL resolution. Add to `userPayload` (after `HomeLocationFollowMode`):

```go
	SessionIdleMinutes int `json:"session_idle_minutes"`
```

Add a small method in `backend/internal/auth/service.go`:

```go
// ResolveIdleMinutes returns the effective idle timeout (minutes) for a
// user: clamp(user_choice ?? ceiling, 5, ceiling). Used by /auth/me so
// the client idle-watcher knows the window. Falls back to 60 on error.
func (s *Service) ResolveIdleMinutes(ctx context.Context, userID uuid.UUID) int {
	var m int
	err := s.Pool.QueryRow(ctx, `
		SELECT GREATEST(5, LEAST(
		    COALESCE(u.users_session_idle_timeout_minutes,
		             t.master_record_tenants_session_idle_limit_minutes, 60),
		    COALESCE(t.master_record_tenants_session_idle_limit_minutes, 60)))
		  FROM users u
		  LEFT JOIN master_record_tenants t
		    ON t.master_record_tenants_id_subscription = u.users_id_subscription
		 WHERE u.users_id = $1`, userID).Scan(&m)
	if err != nil || m <= 0 {
		return 60
	}
	return m
}
```

In `buildUserPayload`, add:

```go
		SessionIdleMinutes:     h.Svc.ResolveIdleMinutes(ctx, u.ID),
```

- [ ] **Step 2: Build + test**

Run: `cd backend && go build ./... && go test ./internal/auth/ -run 'Me|Payload' -v 2>&1 | tail -20`
Expected: clean build; existing /auth/me tests still pass (add an assertion if a payload test exists, that `session_idle_minutes >= 5`).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/auth
git commit -m "feat(auth): surface resolved session_idle_minutes on /auth/me"
```

---

## Task 8: Warn-then-logout modal (useIdleLogout + IdleLogoutModal)

**Files:**
- Create: `app/hooks/useIdleLogout.ts`
- Create: `app/components/IdleLogoutModal.tsx`
- Modify: a top-level authenticated layout/provider to mount the watcher (grep for where `AuthContext`/`useAuth` is consumed app-wide — e.g. the `(user)` layout or a shell component).

- [ ] **Step 1: The hook**

Create `app/hooks/useIdleLogout.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const WARN_SECONDS = 60; // countdown window before logout

interface UseIdleLogout {
  /** Effective idle window in minutes (from /auth/me session_idle_minutes). */
  idleMinutes: number | null;
  /** Called when the countdown elapses with no activity. */
  onLogout: () => void;
  /** Called when the user clicks "Stay signed in" — should ping the server. */
  onStay: () => void;
}

/**
 * Tracks genuine user interaction. After (idleMinutes - WARN_SECONDS) of
 * inactivity, surfaces a countdown; real interaction OR an explicit "stay"
 * resets it. The SERVER remains the authoritative gate — this is convenience.
 */
export function useIdleLogout({ idleMinutes, onLogout, onStay }: UseIdleLogout) {
  const [warning, setWarning] = useState(false);
  const [remaining, setRemaining] = useState(WARN_SECONDS);
  const lastActivity = useRef(0); // ms epoch; seeded in effect (no Date.now at module scope)
  const reducedMotion = useRef(false);

  const markActivity = useCallback(() => {
    lastActivity.current = performance.now();
    setWarning(false);
    setRemaining(WARN_SECONDS);
  }, []);

  useEffect(() => {
    if (!idleMinutes) return;
    reducedMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    lastActivity.current = performance.now();

    const events = ["pointerdown", "keydown", "scroll", "visibilitychange"] as const;
    const onAny = () => { if (!warning) markActivity(); };
    events.forEach((e) => window.addEventListener(e, onAny, { passive: true }));

    const idleMs = idleMinutes * 60_000;
    const warnAtMs = Math.max(0, idleMs - WARN_SECONDS * 1000);

    const tick = window.setInterval(() => {
      const idleFor = performance.now() - lastActivity.current;
      if (idleFor >= idleMs) {
        window.clearInterval(tick);
        onLogout();
        return;
      }
      if (idleFor >= warnAtMs) {
        setWarning(true);
        setRemaining(Math.ceil((idleMs - idleFor) / 1000));
      }
    }, 1000);

    return () => {
      window.clearInterval(tick);
      events.forEach((e) => window.removeEventListener(e, onAny));
    };
  }, [idleMinutes, warning, markActivity, onLogout]);

  const stay = useCallback(() => {
    onStay();
    markActivity();
  }, [onStay, markActivity]);

  return { warning, remaining, stay, reducedMotion: reducedMotion.current };
}
```

- [ ] **Step 2: The modal**

Create `app/components/IdleLogoutModal.tsx`:

```tsx
"use client";

interface IdleLogoutModalProps {
  open: boolean;
  remaining: number; // seconds
  onStay: () => void;
  onLogout: () => void;
  reducedMotion?: boolean;
}

export default function IdleLogoutModal({ open, remaining, onStay, onLogout, reducedMotion }: IdleLogoutModalProps) {
  if (!open) return null;
  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, "0");
  return (
    <div className="idle-modal__Overlay" role="dialog" aria-modal="true" aria-labelledby="idle-modal-title">
      <div className={`idle-modal__Panel${reducedMotion ? " idle-modal__Panel--no-motion" : ""}`}>
        <h2 id="idle-modal-title" className="idle-modal__Panel_Title">Still there?</h2>
        <p className="idle-modal__Panel_Body">
          {`You'll be signed out in ${mm}:${ss} due to inactivity.`}
        </p>
        <div className="idle-modal__Panel_Actions">
          <button type="button" className="btn btn--ghost" onClick={onLogout}>Sign out now</button>
          <button type="button" className="btn btn--primary" onClick={onStay} autoFocus>Stay signed in</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: CSS for the modal**

Add styles to the appropriate stylesheet (grep where modal/overlay classes live — likely `app/globals.css` or a primitives file). Follow the `root-block__Container_Child_leaf` naming and the **no-shadow** rule:

```css
.idle-modal__Overlay {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(26, 26, 26, 0.32);
}
.idle-modal__Panel {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: var(--space-6);
  max-width: 420px; width: calc(100% - var(--space-8));
  animation: idle-modal-in 140ms ease-out;
}
.idle-modal__Panel--no-motion { animation: none; }
.idle-modal__Panel_Title { margin: 0 0 var(--space-2); }
.idle-modal__Panel_Body { margin: 0 0 var(--space-5); color: var(--ink-muted); }
.idle-modal__Panel_Actions { display: flex; gap: var(--space-3); justify-content: flex-end; }
@keyframes idle-modal-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .idle-modal__Panel { animation: none; } }
```

- [ ] **Step 4: Mount the watcher in the authenticated shell**

Find the app-wide authenticated client component that already reads `useAuth()` (grep: `grep -rn "useAuth()" "app/(user)" | head`). In that component (or the `(user)` layout's client wrapper), wire:

```tsx
const { user, logout, refresh } = useAuth();
const { warning, remaining, stay, reducedMotion } = useIdleLogout({
  idleMinutes: user?.session_idle_minutes ?? null,
  onLogout: () => { void logout(); },
  onStay: () => { void refresh(); }, // any authenticated call advances last_used_at
});
// ...render <IdleLogoutModal open={warning} remaining={remaining} onStay={stay} onLogout={() => void logout()} reducedMotion={reducedMotion} /> within the tree
```

Add `session_idle_minutes` to the frontend `User` type (grep the type backing `useAuth().user` — likely `app/contexts/AuthContext.tsx` or a types file — and add `session_idle_minutes?: number;`).

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint -- --max-warnings=0 2>&1 | tail -20` and `npx tsc --noEmit 2>&1 | tail -20`
Expected: no new errors.

- [ ] **Step 6: Manual verification (shortened window)**

Temporarily set your user idle timeout to 5 (the floor) via the sessions control, then idle: confirm the modal appears ~60s before the 5-minute mark, "Stay signed in" dismisses it and the session survives, and letting it run to zero logs you out cleanly to /login (a voluntary logout, not a hard-401 storm). Reset your timeout afterwards.

- [ ] **Step 7: Commit**

```bash
git add app/hooks/useIdleLogout.ts app/components/IdleLogoutModal.tsx app/globals.css app/contexts/AuthContext.tsx
git diff --cached --stat
git commit -m "feat(auth): warn-then-logout idle modal (client watcher; server stays the gate)"
```

---

## Task 9: Security pin + finish

**Files:**
- Test: `backend/internal/auth/middleware_test.go` (or a focused security test file)

- [ ] **Step 1: Pin "server is the gate" (HARD RULE)**

Add a test asserting a forged client value cannot extend the session — the server computes the effective timeout from the DB, independent of any client input:

```go
func TestIdleTimeout_ServerIsAuthoritative(t *testing.T) {
	svc := newTestAuthService(t)
	uid, sid := seedActiveSession(t, svc) // ceiling 60, user choice NULL → effective 60
	// There is NO request field that sets the timeout — prove it: the resolved
	// value comes only from the DB columns, regardless of any client payload.
	_, st, err := svc.FindUserBySessionID(context.Background(), uid, sid)
	if err != nil { t.Fatal(err) }
	if st.EffectiveIdleMinutes != 60 {
		t.Fatalf("server must resolve from DB (ceiling 60), got %d", st.EffectiveIdleMinutes)
	}
	// Lower the ceiling below a previously-stored larger user choice; ceiling wins.
	_, _ = svc.Pool.Exec(context.Background(),
		`UPDATE users SET users_session_idle_timeout_minutes = 50 WHERE users_id = $1`, uid)
	_, _ = svc.Pool.Exec(context.Background(),
		`UPDATE master_record_tenants t SET master_record_tenants_session_idle_limit_minutes = 30
		   FROM users u WHERE u.users_id = $1 AND t.master_record_tenants_id_subscription = u.users_id_subscription`, uid)
	_, st, _ = svc.FindUserBySessionID(context.Background(), uid, sid)
	if st.EffectiveIdleMinutes != 30 {
		t.Fatalf("lowered ceiling must win over stored user choice 50, got %d", st.EffectiveIdleMinutes)
	}
}
```

- [ ] **Step 2: Run the full auth + users + tenant suites**

Run: `cd backend && go test ./internal/auth/ ./internal/users/ ./internal/tenantmasterrecord/ -v 2>&1 | tail -40`
Expected: all PASS.

- [ ] **Step 3: Update SY003 again if any SQL constant changed the touchpoint inventory**

If Task 7's `ResolveIdleMinutes` / Task 5's new SQL constants count as new Go SQL touchpoints (they do), regenerate SY003 once more via `<report> -sy` (HARD RULE). One regeneration covering all the new constants is fine.

- [ ] **Step 4: Update the tech-debt register note (no debt added)**

Add a one-line entry to `docs/c_tech_debt.md` recording that the misnamed-idle-check debt is **paid down** by this branch (closes the gap, not deferred), referencing the spec. Commit:

```bash
git add docs/c_tech_debt.md
git commit -m "docs(td): mark misnamed-idle-check debt paid down by session-idle-timeout feature"
```

- [ ] **Step 5: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to choose merge/PR. Before any commit, run `git diff --cached --stat` in full (HARD RULE) and confirm the index holds only intended files.

---

## Notes for the implementer

- **DB is `vector_artefacts`**, served by `servicePool`/`vaPool`. Confirm via `docs/c_c_db_routing.md` before any psql.
- **Never touch human accounts** (`gadmin@`, `padmin@`, `user@`) — create a test account if you need one.
- **Column-prefix HARD RULE:** every new column is `<table>_<name>` — already followed (`master_record_tenants_session_idle_limit_minutes`, `users_session_idle_timeout_minutes`).
- **Reuse test helpers** — grep each package's `*_test.go` for existing seed/service factories before writing new ones; the names in this plan (`newTestAuthService`, `seedActiveSession`, `newTestTenantService`, `newTestUserWithTenant`) are placeholders for whatever the package already provides.
- **The warn modal is convenience, not the gate.** Every task that could be read as "the client decides the timeout" is wrong — the middleware (Task 2) is the sole authority; Task 9 pins this.
```
