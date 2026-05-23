# Sentinel — Backlog (user stories + acceptance criteria)

> **Source plan:** [PLA062 on Dev → Reporting → Plan tab](/dev/reporting?type=plan).
> **Purpose of this file:** The 24 user stories with full multi-bullet acceptance criteria. Each story gets a completion entry when GREEN+committed+strikethrough on PLA062.
> **Protocol:** See [`sentinel_docs.md`](sentinel_docs.md) § Process.

---

## Story format

Each story below carries:

- **ID** — `S<NN>` matches the PLA062 numbered list (1..24).
- **Title** — one-line imperative.
- **Intent** — one sentence on what this ships.
- **Acceptance Criteria** — 4–7 independently verifiable bullets. Each AC is observable (`returns 403`, `row exists`, `grep finds 0`), never aspirational.
- **Phase** — which of the six implementation phases this belongs to.
- **Status** — `pending` / `in-flight` / `done` (with date + commit SHA + test ref when done).
- **Theme** — `B16 Security & Auth`.

This file is the long-form archive of the AC. PLA062 is the as-planned record; this file is the per-story working record + completion log.

---

## Phase 0 — Doc + test scaffold

### S01 — Scaffold `docs/Security/Sentinel/` tree

**Intent.** Lay the documentation skeleton before any code lands.

**Acceptance Criteria.**
- Directory `docs/Security/Sentinel/` exists with five files: `sentinel_docs.md`, `sentinel_backlog.md`, `sentinel_tests_log.md`, `sentinel_tech_debt.md`, `sentinel_revision_history.md`.
- Each file has its purpose statement (synopsis vs backlog vs tests-log vs tech-debt vs history) and the RED-GREEN protocol header.
- `sentinel_tests_log.md` defines the per-test record schema (name, RED output, GREEN output, attempts-to-green, failure cause per attempt).
- CLAUDE.md adds pointer to `docs/Security/Sentinel/sentinel_docs.md` under the Working-practices index.

**Status.** in-flight (this commit).

---

### S02 — Stand up Sentinel test harness

**Intent.** Test scaffolding so every subsequent story is RED-runnable on day one.

**Acceptance Criteria.**
- Vitest config recognises three tags: `sentinel.unit`, `sentinel.page.<route>`, `sentinel.e2e`.
- `npm run test:sentinel:unit` runs only unit-tagged tests.
- `npm run test:sentinel:page` runs page-integration tests.
- `npm run test:sentinel:e2e` runs Playwright specs.
- `npm run test:sentinel` runs all three tiers in order.
- Page-tag pattern `sentinel.page.work-items` runs only that page's tests — verified by adding a stub test and selecting it via CLI.
- Playwright config recognises `--grep "@sentinel"`.

**Status.** done — 2026-05-24, commit TBD; tier discriminator is `describe()` name prefix (`sentinel.unit.*` / `sentinel.page.*`), selected via `--testNamePattern`. Stub test at `app/(user)/work-items/__tests__/sentinel.page.work-items.test.tsx` proves the slice works; S10 replaces it with the real page-integration assertions.

---

## Phase 1 — Backend Sentinel middleware (RED-first)

### S03 — RED: `backend/internal/sentinel/middleware_test.go` before the package exists

**Intent.** Establishes the backend Sentinel contract through tests-first.

**Acceptance Criteria.**
- Test compiles and runs but RED-fails because `sentinel` package does not exist (go build error captured verbatim in `sentinel_tests_log.md`).
- Asserts the ctx carries `{tenant_id, user_id, role, focus_node_id, scope_up, scope_down, allowed_subtree_ids[]}`.
- Exercises four cases — valid JWT with `?focus=`, missing focus (falls back to user default), focus outside tenant (returns 403 + ProblemJSON), no JWT (returns 401 + ProblemJSON).
- `sentinel_tests_log.md` records RED output verbatim.

**Status.** pending.

---

### S04 — GREEN: implement `backend/internal/sentinel/` package

**Intent.** Closes the RED test from S03.

**Acceptance Criteria.**
- `sentinel.Clamp` struct exists with the 7 fields from the test.
- `sentinel.Middleware(topologyService)` returns a `func(http.Handler) http.Handler`.
- `sentinel.FromCtx(ctx)` returns the clamp or panics if missing (handlers must mount middleware).
- Errors emit RFC 9457 ProblemJSON with `type: "/errors/sentinel/..."` codes (no-focus, focus-not-in-tenant, focus-no-access).
- `middleware_test.go` all four cases GREEN.
- Attempts-to-green logged in `sentinel_tests_log.md` (target ≤ 3 attempts).

**Status.** pending.

---

### S05 — Mount `sentinel.Middleware` in `cmd/server/main.go`

**Intent.** Activate the clamp on every protected route. Additive — doesn't yet require handlers to read it.

**Acceptance Criteria.**
- Integration test on `/_site/admin/artefacts` with a valid JWT returns 200 and the response is unchanged from pre-mount baseline (additive, non-breaking).
- Integration test with a JWT for tenant A but `?focus=<tenant-B-node>` returns 403 ProblemJSON.
- Public routes (login, health) are NOT behind the middleware — verified by hitting them without a JWT and getting their normal responses.
- Server boots clean (no nil pointers, no missing deps).

**Status.** pending.

---

### S06 — Migration: `users.default_focus_node_id` + scope defaults

**Intent.** Persist per-user focus and scope preferences (Rally idiom).

**Acceptance Criteria.**
- Migration `NNN_sentinel_user_columns.sql` applies clean against `mmff_vector`.
- Columns exist with correct types: `default_focus_node_id UUID NULL`, `sentinel_scope_up_default BOOL DEFAULT true`, `sentinel_scope_down_default BOOL DEFAULT true`.
- `schema_migrations` row exists for NNN after apply.
- Existing `users` rows backfill to `NULL` focus (no migration error).
- Migration is reversible — down step drops the three columns.

**Status.** pending.

---

## Phase 2 — Frontend Sentinel provider (RED-first)

### S07 — RED: `app/sentinel/__tests__/sentinel_provider.test.tsx` before the provider exists

**Intent.** Pin the frontend Sentinel contract through tests-first.

**Acceptance Criteria.**
- Test fails at compile because `app/sentinel/SentinelProvider` doesn't exist (TS error captured in `sentinel_tests_log.md`).
- Asserts state shape — every `sentinel_*` field present after a successful login.
- Asserts workspace-switch atomicity — `await sentinel_switch_tenant(t2)` resolves with `sentinel_tenant.id === t2` AND `sentinel_workspace_in_sync === true` in the same render cycle.
- Asserts `sentinel_can("perm.code")` returns true for granted, false for not-granted.
- Asserts focus precedence — URL `?focus=` > `default_focus_node_id` > tenant root.
- Asserts reload-on-401 — a 401 response on any sentinel-mediated call triggers `sentinel_reload`.

**Status.** pending.

---

### S08 — GREEN: implement `app/sentinel/` provider + hook + types + API

**Intent.** Single reducer, single dispatch path, no module-level escape hatches.

**Acceptance Criteria.**
- All six assertions in `sentinel_provider.test.tsx` GREEN.
- `useSentinel()` outside `SentinelProvider` throws — verified by negative test.
- `SentinelProvider` exports zero module-level state — verified by grep returning zero `let ` at module top of the package.
- `sentinel_api.ts` wraps fetch with auto-401 → reload behaviour.
- Attempts-to-green logged in `sentinel_tests_log.md`.

**Status.** pending.

---

### S09 — Mount `SentinelProvider` at top of all layouts

**Intent.** Activate the new provider above all consumer pages. Old contexts still mounted alongside — they will be deleted in S22.

**Acceptance Criteria.**
- Every protected page renders without runtime error after mount.
- Existing tests for protected pages still GREEN (additive change).
- `useSentinel()` returns valid data on any page within these layouts.
- Page-load DOM contains exactly one `SentinelProvider` ancestor for any consumer hook — verified by snapshot test.

**Status.** pending.

---

## Phase 3 — Hard-cut migration (190 call sites, page-by-page)

### S10 — Migrate `/work-items` page to Sentinel

**Intent.** First call-site migration. Acts as the reference for the remaining 27 pages.

**Acceptance Criteria.**
- Page-integration test `sentinel.page.work-items` exists; RED before migration (page still imports old hooks).
- Page test mounts the page with two fixture tenants; asserts only active-tenant artefacts render.
- Page test switches tenant; asserts atomic re-render against new payload (no stale-data flash).
- Page test passes a `?focus=<node>` URL; asserts payload narrows to subtree.
- Page migration removes every `useAuth/useScope/useTenant` import from the page; only `useSentinel` remains. Verified by grep returning zero old-hook imports.
- Page-test GREEN; attempts-to-green logged.

**Status.** pending.

---

### S11 — Migrate `/portfolio-items` page to Sentinel

**Intent.** Same shape as S10.

**Acceptance Criteria.**
- `sentinel.page.portfolio-items` test RED before migration.
- Two-tenant isolation, atomic switch, focus clamp — all asserted as in S10.
- Zero old-hook imports remain (grep).
- GREEN; attempts logged.

**Status.** pending.

---

### S12 — Migrate `/risks` page to Sentinel

**Intent.** Same shape as S10.

**Acceptance Criteria.**
- `sentinel.page.risks` test RED before migration.
- Isolation/switch/focus all asserted.
- Zero old-hook imports.
- GREEN; attempts logged.

**Status.** pending.

---

### S13 — Migrate `/topology` + `/topology-map` pages to Sentinel

**Intent.** Same shape as S10; bundled because they share topology canvas component.

**Acceptance Criteria.**
- `sentinel.page.topology` + `sentinel.page.topology-map` tests RED.
- Canvas respects Sentinel focus — panning to a different subtree does NOT change `sentinel_focus_node` unless explicit pin.
- Zero old-hook imports across both pages + shared canvas.
- GREEN; attempts logged.

**Status.** pending.

---

### S14 — Migrate workspace-admin pages cluster (8 routes) to Sentinel

**Intent.** Bulk migration of admin routes that share permission gating patterns.

**Acceptance Criteria.**
- One `sentinel.page.workspace-admin.<route>` test per route; all RED before migration.
- Non-padmin role on any route returns 403 via `sentinel_can` — verified per route.
- Padmin role sees the page; data is tenant-scoped.
- Zero old-hook imports across all eight routes.
- All 8 page tests GREEN; attempts logged.

**Status.** pending.

---

### S15 — Migrate vector-admin pages cluster to Sentinel

**Intent.** Admin-level pages — stricter clamp (only gadmin tier).

**Acceptance Criteria.**
- One `sentinel.page.vector-admin.<route>` test per route; all RED.
- Non-gadmin role returns 403.
- Gadmin sees all tenants in workspace-admin selector.
- Zero old-hook imports.
- All tests GREEN; attempts logged.

**Status.** pending.

---

### S16 — Migrate remaining `app/(user)/*` pages

**Intent.** Catch-all — backlog, planning, releases, sprints, scope, dashboard, etc.

**Acceptance Criteria.**
- Every page under `app/(user)/` has a `sentinel.page.<route>` test; all RED before migration.
- Isolation/switch/focus all asserted per page.
- Zero old-hook imports across `app/(user)/` — single grep returns empty.
- All page tests GREEN.
- Attempts-to-green logged per page; sum logged in `sentinel_tests_log.md`.

**Status.** pending.

---

### S17 — Migrate shared components (60+ `useHasPermission` sites)

**Intent.** Component-level migration. Each component gets a `sentinel.unit` test for its permission gating.

**Acceptance Criteria.**
- Every `useHasPermission(code)` replaced with `useSentinel().sentinel_can(code)`.
- ≥1 component unit test per gated component asserting `sentinel_can` matches expected for a fixture permission set.
- Grep `useHasPermission` across `app/` returns zero.
- All component tests GREEN.

**Status.** pending.

---

### S18 — Migrate `useActiveWorkspace` (40) + direct `user.workspace_id` (17) reads

**Intent.** The procurement smoking-gun call sites.

**Acceptance Criteria.**
- Every `useActiveWorkspace()` replaced with `useSentinel().sentinel_tenant` + `.sentinel_focus_node`.
- Every direct `user.workspace_id` read replaced with `sentinel_tenant.id`. Grep returns zero direct reads.
- ≥1 test per touched call-site path asserting it reads the right tenant after a workspace switch (no stale reads).
- Grep `useActiveWorkspace|user\.workspace_id|user\?\.workspace_id` across `app/` returns zero.

**Status.** pending.

---

## Phase 4 — Lint ratchets

### S19 — Add `lint:no-direct-workspace-id` + `lint:no-old-context-imports`

**Intent.** Frontend lint ratchets that prevent regression.

**Acceptance Criteria.**
- `dev/scripts/lint_no_direct_workspace_id.py` exists; fails on fixture file that reads `user.workspace_id`.
- `dev/scripts/lint_no_old_context_imports.py` exists; fails on fixture file that imports from `app/contexts/AuthContext`.
- Both lints pass on the current migrated tree.
- Both lints wired into `npm run lint:rf1`.
- Documented on `docs/c_c_lint_rules.md` with rationale + Sentinel back-ref.

**Status.** pending.

---

### S20 — Add Go lint `lint:sentinel-clamp-required`

**Intent.** Backend lint ratchet preventing handlers from bypassing the clamp.

**Acceptance Criteria.**
- `backend/internal/lintchecks/sentinel_clamp_test.go` exists; fails on fixture handler that touches `artefacts_*` without `sentinel.FromCtx`.
- Passes on fixture handler that DOES call the clamp.
- Passes on every real handler in `backend/internal/` after migration.
- Wired into the existing lintchecks suite (runs in `go test ./...`).
- Documented on `docs/c_c_lint_rules.md`.

**Status.** pending.

---

### S21 — Backend: refactor every artefact-touching handler to call `sentinel.FromCtx`

**Intent.** Hard-wire the clamp into every domain service.

**Acceptance Criteria.**
- Every list/get handler in artefactitems, portfoliomodels, workitems, risks, defects, notifications, realtime reads the clamp and applies its `allowed_subtree_ids` to SQL filters.
- Integration test per package: handler with valid JWT + valid focus returns only subtree rows; with focus outside tenant returns 403.
- `lint:sentinel-clamp-required` passes on the package after refactor.
- All existing handler tests still GREEN (additive constraint).

**Status.** pending.

---

## Phase 5 — Hard-cut delete + cross-tenant e2e

### S22 — DELETE old contexts

**Intent.** The hard-cut moment.

**Acceptance Criteria.**
- Files removed: `app/contexts/AuthContext.tsx`, `ScopeContext.tsx`, `TenantContext.tsx`, `Sentinel.tsx`, `scopeReloadRegistry.ts`.
- `tsc --noEmit` passes — no broken imports.
- `next build` succeeds.
- Grep across `app/` for any of the deleted symbols returns zero.
- All `sentinel.unit` + `sentinel.page.*` tests still GREEN.
- `git diff --stat` shows roughly −1,000 LOC net.

**Status.** pending.

---

### S23 — RED-GREEN e2e: `sentinel_cross_tenant_isolation.spec.mjs`

**Intent.** Procurement-grade isolation proof via Playwright.

**Acceptance Criteria.**
- Spec logs in as Alice (tenant A) and Bob (tenant B) sequentially.
- Spec captures wire payloads from `/work-items` for each session; asserts zero overlap of artefact IDs.
- Spec attempts cross-tenant GET (Alice's JWT, Bob's artefact ID) and asserts 403 ProblemJSON with `type: "/errors/sentinel/cross-tenant"`.
- RED before backend lint+refactor; GREEN after.
- Spec runs under `npm run test:sentinel:e2e`.

**Status.** pending.

---

## Phase 6 — Documentation close-out

### S24 — Documentation close-out + CLAUDE.md HARD RULE

**Intent.** Final documentation pass + the permanent guardrail.

**Acceptance Criteria.**
- `sentinel_docs.md` filled in (synopsis / reason / process / requirements / outputs).
- `sentinel_backlog.md` contains all 24 stories with completion dates + commit refs + linked test names.
- `sentinel_tests_log.md` contains every test's RED + GREEN output, attempts-to-green per test.
- `sentinel_revision_history.md` dated entry for PLA062 close, with summary of changes.
- `sentinel_tech_debt.md` reviewed — target is zero entries.
- CLAUDE.md gains new HARD RULE blocking imports from deleted contexts + direct `auth.UserFromCtx` in artefact handlers.

**Status.** pending.

---

## Completion ledger

| Story | Done date | Commit SHA | Tests |
|---|---|---|---|
| S01 | 2026-05-24 | 6fe3b94e | (docs-only — no test) |
| S02 | 2026-05-24 | (this commit) | stub `sentinel.page.work-items` runs under `test:sentinel:page` |
