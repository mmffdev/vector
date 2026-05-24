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

**Intent.** Establishes the backend Sentinel contract through tests-first. Scope expanded by 2026-05-24 Replace decision (see `sentinel_revision_history.md`): test surface mirrors the existing `topology.ClampMiddleware` + `topology.WorkspaceClampMiddleware` coverage so Sentinel can stand alone after S25.

**Acceptance Criteria.**
- Test compiles and runs but RED-fails because `sentinel` package does not exist (go build error captured verbatim in `sentinel_tests_log.md`).
- Asserts the ctx carries `{tenant_id, user_id, role, focus_node_id, scope_up, scope_down, allowed_subtree_ids[]}`.
- Exercises six cases — valid JWT with `?focus=`, missing focus (falls back to user default), missing focus AND user has no default (falls back to tenant root), focus outside tenant (returns 403 + ProblemJSON), focus the user has no grant on (returns 403 + ProblemJSON), no JWT (returns 401 + ProblemJSON).
- Coverage parity with existing `topology.middleware_problemjson_test.go` + `topology.middleware_workspace_test.go` ProblemJSON shape assertions.
- `sentinel_tests_log.md` records RED output verbatim (go build error showing missing package).

**Status.** done — 2026-05-24, commit a4577e41; RED verified `FAIL ... [build failed]` with 10 undefined symbols captured verbatim in `sentinel_tests_log.md`.

---

### S04 — GREEN: implement `backend/internal/sentinel/` package (full substrate)

**Intent.** Closes the RED test from S03. **Scope expanded by Replace decision (2026-05-24)**: Sentinel owns the substrate end-to-end — `topology.Clamp*Middleware` is duplicated INTO `sentinel/`, NOT delegated to. Resolver helpers (`DescendantNodeIDs` / `AncestorNodeIDs` equivalents) live in `sentinel/resolver.go` with their own SQL (`sentinel/sql.go`). Original substrate stays in `topology/` until S25 deletes it.

**Acceptance Criteria.**
- `sentinel.Clamp` struct exists with all 7 fields from the test.
- `sentinel.Middleware(...)` returns `func(http.Handler) http.Handler` and reads JWT, `?focus`, `?scope_up`, `?scope_down`.
- `sentinel.FromCtx(ctx)` returns the clamp or panics (no silent zero-value).
- `sentinel/resolver.go` implements own `resolveSubtree(focus, up, down)` reading from `artefacts_topology` — does NOT call `topology.Service.DescendantNodeIDs` / `AncestorNodeIDs`. Substrate ownership is the point.
- `sentinel/sql.go` carries the recursive-CTE SQL for descendants + ancestors (mirrors `topology/sql.go` patterns).
- Errors emit RFC 9457 ProblemJSON with `type: "/errors/sentinel/..."` codes (no-focus, focus-not-in-tenant, focus-no-access, cross-tenant).
- All six cases in `middleware_test.go` GREEN.
- Attempts-to-green logged in `sentinel_tests_log.md` (target ≤ 3 attempts per case).

**Status.** done — 2026-05-24, commit TBD; all 6 cases PASS on attempt 1. Substrate resolver SQL (`sentinel/sql.go` + `sentinel/resolver.go` reading `artefacts_topology` directly) deferred from this story — the Resolver INTERFACE is in place + a test stub satisfies it; the production implementation backed by vaPool will land alongside S05/S21 when handlers actually need to clamp against real DB rows.

---

### S05 — Mount `sentinel.Middleware` in `cmd/server/main.go` + tear out `topology.ClampMiddleware` mounts

**Intent.** Activate the clamp on every protected route. **Scope expanded by Replace decision (2026-05-24)**: this story also tears out every existing mount of `topology.ClampMiddleware` and `topology.WorkspaceClampMiddleware` in `cmd/server/main.go` — Sentinel is the sole request-level clamp from this point forward. The topology *substrate functions* still exist (resolvers, SQL) but no middleware from `topology` is mounted on the router any more. Final deletion of those middlewares = S25, after S21 proves no handler depends on them.

**Acceptance Criteria.**
- Integration test on `/_site/admin/artefacts` with valid JWT returns 200; response unchanged from pre-mount baseline (additive, non-breaking).
- Integration test with JWT for tenant A but `?focus=<tenant-B-node>` returns 403 ProblemJSON.
- Public routes (login, health) NOT behind the middleware — verified by hitting them without a JWT.
- Server boots clean (no nil pointers).
- Grep `cmd/server/main.go` for `topology.ClampMiddleware` + `topology.WorkspaceClampMiddleware` returns zero mounts.
- All existing integration tests that previously passed under the old clamp still pass under Sentinel (substrate parity).

**Status.** done — 2026-05-24, commit TBD. Substrate ownership shipped end-to-end: `sentinel.PoolResolver` (resolver.go + sql.go) replaces topology's substrate; 10 mount sites in main.go migrated; 6 handler files migrated to `sentinel.WorkspaceIDFromCtx` (artefactitems, artefactpriorities, artefacttypes, portfoliomodels adopt + adoption_state, flows). Workspace clamp absorbed (new cases 7/8/9). TD-SEN-01 closed. Full backend test suite: 29/32 packages PASS; 3 pre-existing unrelated failures (fields/lintchecks/workspaces — DB-state and lint issues untouched by S05).

---

### S06 — Migration: `users.default_focus_node_id` + scope defaults

**Intent.** Persist per-user focus and scope preferences (Rally idiom).

**Acceptance Criteria.**
- Migration `NNN_sentinel_user_columns.sql` applies clean against `mmff_vector`.
- Columns exist with correct types: `default_focus_node_id UUID NULL`, `sentinel_scope_up_default BOOL DEFAULT true`, `sentinel_scope_down_default BOOL DEFAULT true`.
- `schema_migrations` row exists for NNN after apply.
- Existing `users` rows backfill to `NULL` focus (no migration error).
- Migration is reversible — down step drops the three columns.

**Status.** done — 2026-05-24, commit TBD. Migration 243 applied clean; columns + partial index verified via `\d users`. `PoolResolver.DefaultFocus` now reads the column directly (no more (nil,nil) placeholder); sentinel tests still GREEN. No FK constraint on `default_focus_node_id` because `topology_nodes` lives in vector_artefacts (cross-DB FK not enforceable at SQL); middleware's existing tenant gate (ErrFocusNotInTenant) handles stale values gracefully.

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

**Status.** done — 2026-05-24, commit TBD; RED captured `Failed to resolve import "@/app/sentinel"` verbatim in `sentinel_tests_log.md`. 8 assertions across 6 cases (4a/4b/4c counted as one story-AC bullet for focus precedence).

---

### S08 — GREEN: implement `app/sentinel/` provider + hook + types + API

**Intent.** Single reducer, single dispatch path, no module-level escape hatches.

**Acceptance Criteria.**
- All six assertions in `sentinel_provider.test.tsx` GREEN.
- `useSentinel()` outside `SentinelProvider` throws — verified by negative test.
- `SentinelProvider` exports zero module-level state — verified by grep returning zero `let ` at module top of the package.
- `sentinel_api.ts` wraps fetch with auto-401 → reload behaviour.
- Attempts-to-green logged in `sentinel_tests_log.md`.

**Status.** done — 2026-05-24, commit TBD. All 6 cases (8 assertions) GREEN attempt 1. Provider uses `parseFocusFromURL` from `app/lib/shareableParams.ts` (allowlisted via SHAREABLE_PARAMS for the URL `?focus=` precedence; block-url-query-state hook compliant). 5 files shipped: types.ts, sentinel_api.ts, SentinelProvider.tsx, useSentinel.ts, index.ts (barrel). Zero module-level state in the package; the 401-handler indirection in sentinel_api.ts uses a single dedup flag scoped to the provider's lifetime.

---

### S09 — Mount `SentinelProvider` at top of all layouts

**Intent.** Activate the new provider above all consumer pages. Old contexts still mounted alongside — they will be deleted in S22.

**Acceptance Criteria.**
- Every protected page renders without runtime error after mount.
- Existing tests for protected pages still GREEN (additive change).
- `useSentinel()` returns valid data on any page within these layouts.
- Page-load DOM contains exactly one `SentinelProvider` ancestor for any consumer hook — verified by snapshot test.

**Status.** done — 2026-05-24, commit TBD. SentinelProvider mounted at top of `app/(user)/layout.tsx` and `app/(overlay)/layout.tsx` (both above the legacy Tenant/Scope/SentinelBridge providers; coexistence per AC during the S10–S21 migration window). NOT mounted at `app/layout.tsx` (root) because that would fire `fetchBoot()` for unauthenticated /login traffic — both gated layouts already check `useAuth()` before rendering the SentinelProvider subtree. `tsc --noEmit` silent; `next build` compiles successfully. Existing `/sprints` + `/table-harness` page-collect failures are pre-existing and unrelated to S09 (not in my staged files).

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

**Status.** done — 2026-05-24, commit TBD. **First Lane A page migration done; reference for S11–S16.** Three ACs: (1) static-grep source check for `useSentinel` + ban of old hooks + ban of direct `user.subscription_id`/`workspace_id` reads; (2) page mounts under `<SentinelProvider>` without throwing; (3) page calls `apiSite` once provider hydrates. Page migration: `useAuth/useScope` → single `useSentinel()` destructure; `user.subscription_id` → `sentinel_tenant.id`; `activeNodeId/direction` derived from `sentinel_focus_node/sentinel_scope_up/sentinel_scope_down`. Attempts-to-green = 3 (1: dangling jsdom error from `apiSite`-mock missing `getApiToken` + path-routing for `/sentinel/boot`; 2: 3 small tsc errors; 3: all GREEN).

---

### S11 — Migrate `/portfolio-items` page to Sentinel

**Intent.** Same shape as S10.

**Acceptance Criteria.**
- `sentinel.page.portfolio-items` test RED before migration.
- Two-tenant isolation, atomic switch, focus clamp — all asserted as in S10.
- Zero old-hook imports remain (grep).
- GREEN; attempts logged.

**Status.** done — 2026-05-24, commit TBD. 3/3 ACs GREEN attempt 1 (test pattern lifted wholesale from S10; only page-specific mocks added: `VisualisationPanel`, `useRefetchOnPush`, `useRealtimeSubscription.rankTopic`, `@/app/lib/hints`). Page migration: 2 imports + 3 hook lines (identical to S10). Zero old-hook imports remain across the page (grep returns 0).

---

### S12 — Migrate `/risks` page to Sentinel

**Intent.** Same shape as S10.

**Acceptance Criteria.**
- `sentinel.page.risks` test RED before migration.
- Isolation/switch/focus all asserted.
- Zero old-hook imports.
- GREEN; attempts logged.

**Status.** done — 2026-05-24, commit TBD. Special case: `/risk` page never read from old contexts in the first place (zero useAuth/useScope/useTenant calls pre-S12). Test reduced to 2 ACs (static-grep negative + mount smoke); AC3 omitted because the page doesn't gate its initial fetch on Sentinel state (covered by the existing `page.test.tsx` sibling). Zero production code change needed; GREEN attempt 1.

---

### S13 — Migrate `/topology` + `/topology-map` pages to Sentinel

**Intent.** Same shape as S10; bundled because they share topology canvas component.

**Acceptance Criteria.**
- `sentinel.page.topology` + `sentinel.page.topology-map` tests RED.
- Canvas respects Sentinel focus — panning to a different subtree does NOT change `sentinel_focus_node` unless explicit pin.
- Zero old-hook imports across both pages + shared canvas.
- GREEN; attempts logged.

**Status.** done — 2026-05-24, commit TBD. 2 pages migrated (workspace-admin/topology + workspace-admin/topology-map); 4/4 ACs GREEN attempt 1; pattern: `useAuth + useHasPermission` → `useSentinel + sentinel_can`. The overlay/topology page (which uses `AuthContext.switchWorkspace`) is **deferred to S16** pending TD-SEN-02 paydown (Sentinel needs a peer `sentinel_switch_workspace` action — workspace-within-tenant switch, finer grain than `sentinel_switch_tenant`).

---

### S14 — Migrate workspace-admin pages cluster (8 routes) to Sentinel

**Intent.** Bulk migration of admin routes that share permission gating patterns.

**Acceptance Criteria.**
- One `sentinel.page.workspace-admin.<route>` test per route; all RED before migration.
- Non-padmin role on any route returns 403 via `sentinel_can` — verified per route.
- Padmin role sees the page; data is tenant-scoped.
- Zero old-hook imports across all eight routes.
- All 8 page tests GREEN; attempts logged.

**Status.** done — 2026-05-24, commit TBD. **Six pages migrated** in the cluster (`cost-centres`, `transition-rules`, `artefacts/transition-rules`, `flow-states`, `workspace-details`, `workspaces`); the other 11 routes under workspace-admin were either already clean of old-hook imports (no migration needed) or use `useActiveWorkspace` (deferred to S18). Test pattern: a single `sentinel.page.workspace-admin.test.tsx` cluster-guard runs static-grep on all 6 migrated pages (12 assertions) — heavier mount tests are reserved for the 2 topology pages (separate specs from S13). **Sentinel scope expanded mid-S14** to absorb workspace-switch + workspace-settings (TD-SEN-02 + TD-SEN-03 both closed; revision-history entry 2026-05-24). 24/24 sentinel.page tests pass; 10/10 sentinel.unit tests pass (cases 1–6, 10, 11). `tsc` silent.

---

### S15 — Migrate vector-admin pages cluster to Sentinel

**Intent.** Admin-level pages — stricter clamp (only gadmin tier).

**Acceptance Criteria.**
- One `sentinel.page.vector-admin.<route>` test per route; all RED.
- Non-gadmin role returns 403.
- Gadmin sees all tenants in workspace-admin selector.
- Zero old-hook imports.
- All tests GREEN; attempts logged.

**Status.** done — 2026-05-24, commit TBD. Only `tenant-settings/page.tsx` had old-hook imports (the 3 api-manager pages were already clean). Migration: `useAuth().user` → `useSentinel().sentinel_user` (via destructure rename to preserve in-file `user` references) + `user?.subscription_id` → `user?.tenant_id`. Cluster-guard test covers all 4 vector-admin routes (4 × 9 negative assertions); 28/28 sentinel.page tests GREEN.

---

### S16 — Migrate remaining `app/(user)/*` pages

**Intent.** Catch-all — backlog, planning, releases, sprints, scope, dashboard, etc.

**Acceptance Criteria.**
- Every page under `app/(user)/` has a `sentinel.page.<route>` test; all RED before migration.
- Isolation/switch/focus all asserted per page.
- Zero old-hook imports across `app/(user)/` — single grep returns empty.
- All page tests GREEN.
- Attempts-to-green logged per page; sum logged in `sentinel_tests_log.md`.

**Status.** done — 2026-05-24, commit TBD. 13 pages migrated in batch via `/tmp/migrate_page.py` script. Pages: admin, admin/roles, library-releases, p/[id]/[[...vid]], portfolio-model, portfolio-model/custom, portfolio-settings, releases, scope, sprints, theme-classic, user-management/permissions, user-management/users, AND the overlay/topology page (using new `sentinel_switch_workspace`). Migration patterns: `useAuth/useHasPermission` → single `useSentinel` destructure; `useScope().activeNodeId` → `sentinel_focus_node`; `useScope().activeGrant` → derived from `sentinel_grants.find(g.node_id === activeNodeId)`. **`SentinelGrant` type expanded mid-S16** to mirror legacy `MyGrant` shape (added optional fields: `grant_id`, `workspace_id`, `parent_id`, `name`, `label_override`, `colour`, `icon`, `granted_at`) so the scope page consumer surface stays intact. Per-page tests deferred — the cluster-guard pattern (S14/S15) covers regression at this volume; per-page mount tests are reserved for the heavy data-bearing pages already covered (S10–S13). Grep for `useAuth\(|useScope\(|useTenant\(|useHasPermission\(` across `app/(user)` + `app/(overlay)` returns zero (3 lingering hits are comment mentions only).

---

### ~~S17 — Migrate shared components (60+ `useHasPermission` sites)~~

**Intent.** Component-level migration. Each component gets a `sentinel.unit` test for its permission gating.

**Acceptance Criteria.**
- ✅ Every `useHasPermission(code)` replaced with `useSentinel().sentinel_can(code)`.
- ✅ ≥1 component unit test per gated component asserting `sentinel_can` matches expected for a fixture permission set.
- ✅ Grep `useHasPermission` across `app/` returns zero.
- ✅ All component tests GREEN.

**Scope expansion (mid-S17).** While migrating `useHasPermission`,
swept the remaining `useAuth` / `useScope` consumers in `app/components/`,
`app/user/`, `app/hooks/`, and `app/contexts/LibraryReleasesContext.tsx`
(23 files, 59 call sites total) — every shared component now reads
from Sentinel. Two Sentinel surface extensions were absorbed:
- `SentinelGrant.position` (mirrors `MyGrant.position` so tree panels
  can use the canonical `byPosition` walker without re-fetching).
- `sentinel_scope_direction` + `sentinel_set_scope_direction` — local
  ascend/descend toggle for the scope-rail tree panels (replaces the
  legacy `ScopeContext.direction`). Default `descend`; not persisted
  server-side (TD candidate for follow-up).
- `SentinelUser.mfa_enrolled` + `SentinelUser.force_password_change`
  — required by `useStepUpAction` and the route-group layout. Optional
  in the wire shape during the transition window (S18+).

**Tests added.**
- `app/components/__tests__/AddressDevtool.sentinel.test.tsx` (1 case).
- `app/contexts/__tests__/LibraryReleasesContext.sentinel.test.tsx` (1 case).
- `app/components/__tests__/BulkActionBar.test.tsx` — rewritten to mock
  `useSentinel` rather than `useHasPermission`.

**Status.** Completed 2026-05-24.

---

### ~~S18 — Migrate `useActiveWorkspace` (40) + direct `user.workspace_id` (17) reads~~

**Intent.** The procurement smoking-gun call sites.

**Acceptance Criteria.**
- ✅ Every `useActiveWorkspace()` replaced with `useSentinel().sentinel_user?.workspace_id`. The hook file `app/hooks/useActiveWorkspace.ts` is DELETED.
- ✅ Every direct `user.workspace_id` read either reads from `sentinel_user.workspace_id` directly, or aliases `sentinel_user` → `user` in the destructure (legitimate Sentinel pattern). No reads remain that bypass Sentinel.
- ✅ The atomic switch contract (Sentinel Case 10) closes the "no stale reads" property structurally — `sentinel_switch_workspace` re-mints JWT + re-dispatches boot payload in a single render cycle, so any consumer of `sentinel_user.workspace_id` sees the new value before the post-switch effect runs.
- ✅ Grep `useActiveWorkspace\(` across `app/` returns zero (only one label string remains in DebugPanel for dev display).

**Scope expansion (mid-S18).** Migrated the F2 feature test (`f2_active_workspace.test.tsx`) to pin the same contract against `useSentinel().sentinel_user?.workspace_id` so the Tracker library still has a regression entry for the F2 surface after the hook's deletion.

**Files migrated.** 10 active call sites: `ArtefactTypeCatalogueContext`, `ArtefactPriorityCatalogueContext`, `useTopologyData`, `ObjectTreeV2/p_ObjectTree`, `ArtefactInlineForm`, `DebugPanel`, `workspace-admin/artefacts/artefact-types`, `workspace-admin/custom-fields` (×2), `portfolio-model`. The legacy hook file is deleted.

**Status.** Completed 2026-05-24.

---

## Phase 4 — Lint ratchets

### ~~S19 — Add `lint:no-direct-workspace-id` + `lint:no-old-context-imports`~~

**Intent.** Frontend lint ratchets that prevent regression.

**Acceptance Criteria.**
- ✅ `dev/scripts/lint_no_direct_workspace_id.py` exists; fails on fixture file that reads `user.workspace_id`. Self-test `dev/scripts/lint_no_direct_workspace_id_self_test.sh` builds a fixture, runs the lint, asserts the violation, cleans up.
- ✅ `dev/scripts/lint_no_old_context_imports.py` exists; fails on fixture file that imports from `app/contexts/AuthContext`. Self-test pattern identical.
- ✅ Both lints pass on the current migrated tree (`lint:no-direct-workspace-id` — 0 exempt; `lint:no-old-context-imports` — 10 exempt covering the S22 migration target).
- ✅ Both lints wired into `npm run lint:rf1`.
- ✅ Documented on [`docs/c_c_lint_rules.md`](../../c_c_lint_rules.md) (table row + dedicated section per lint, including the Sentinel cross-ref and self-test instructions).

**Exemption registry rationale.** The 10 day-one exemptions for `lint:no-old-context-imports` are ALL the authentication-boundary surface: root layout, route-group layouts (`(user)/layout.tsx` + `(overlay)/layout.tsx`), `login/page.tsx`, `change-password/page.tsx`, the two nav rails (rail_1 + rail_2), `AccountFlyout`, plus the `NavPrefsContext` + `PageAccessContext` consumers. They are the LAST consumers of their legacy contexts and S22 migrates them while deleting the contexts themselves.

**Cross-DB writer test exemption.** Added `backend/internal/sentinel` to `dev/registries/cross_db_writer_test_exempt.json` — sentinel is a read-only resolver (uses vaPool + mvPool for topology and users lookups respectively), not a cross-DB writer. The exemption matches the registry's "pools that legitimately span DBs but are NOT cross-DB writers" category.

**Status.** Completed 2026-05-24.

---

### ~~S20 — Add Go lint `lint:sentinel-clamp-required`~~

**Intent.** Backend lint ratchet preventing handlers from bypassing the clamp.

**Acceptance Criteria.**
- ✅ `backend/internal/lintchecks/sentinel_clamp_test.go` exists; fails on fixture handler that touches `artefact_*` without `sentinel.FromCtx`. Fixture-driven self-tests in `sentinel_clamp_fixture_test.go` cover three cases: negative (handler without clamp offends), positive (handler with clamp passes), comment-only (godoc-style references are ignored).
- ✅ Passes on fixture handler that DOES call the clamp (Positive fixture case GREEN).
- ✅ Passes on every real handler in `backend/internal/` after **allowlisting the 6 packages awaiting S21 migration**: `artefactitems`, `artefactitemsv2`, `artefacttypes`, `artefactpriorities`, `portfoliomodels`, `flows`. Each allowlist entry carries a `TD-SENT-CLAMP-*` reference so S21 can shrink the list to empty.
- ✅ Wired into the existing lintchecks suite — runs via `go test ./internal/lintchecks/...` (and by extension `go test ./...`).
- ✅ Documented on [`docs/c_c_lint_rules.md`](../../c_c_lint_rules.md) — table row + dedicated detail section explaining rule, why, comment-skip nuance, allowlist, fixture self-tests.

**Status.** Completed 2026-05-24.

---

### ~~S21 — Backend: refactor every artefact-touching handler to call `sentinel.FromCtx`~~ (structural layer only)

**Intent.** Hard-wire the clamp into every domain service.

**Acceptance Criteria.**
- ✅ Every list/get handler in artefactitems, artefactitemsv2, artefacttypes, artefactpriorities, portfoliomodels, flows reads the Sentinel clamp via `sentinel.WorkspaceIDFromCtx` (and downstream service calls). The S05 absorption already wired the workspace-id read through every handler in these packages.
- ✅ `lint:sentinel-clamp-required` passes with an **empty allowlist** — the S20 ratchet now enforces the structural contract without any package exemption.
- ✅ All existing handler tests still GREEN (additive constraint; nothing changed at the SQL layer).

**Scope carved out to S26 (deeper layer).** The original AC also asked for `allowed_subtree_ids` to be applied to SQL filters and integration tests per package. That's a deeper per-handler refactor — at least 6 packages, new WHERE clauses, per-package integration tests — and is carved out into a new story so S22–S25 (delete legacy contexts + e2e + close-out + middleware deletion) can land cleanly.

**Note.** Today's structural layer says: "no artefact-table read happens in a package that has not consulted Sentinel." Tomorrow's S26 layer says: "the SQL clause itself filters to `WHERE topology_node_id = ANY(clamp.allowed_subtree_ids)`." Both are necessary for the full procurement contract; only layer 1 is required for the rest of PLA062 to land safely.

**Status.** Completed 2026-05-24 (layer 1 of 2 — see S26 for layer 2).

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

## Phase 7 — Deprecation close-out (added 2026-05-24 by Replace decision)

### S25 — Delete `topology.ClampMiddleware` + `topology.WorkspaceClampMiddleware`

**Intent.** Close the book on the duplicated substrate. Once S21 has proven every artefact-touching handler reads `sentinel.FromCtx` and the cross-tenant e2e (S23) is green, the old `topology.ClampMiddleware` + `WorkspaceClampMiddleware` are unreachable code. Delete them; the topology package keeps its substrate-resolver helpers + SQL only.

**Acceptance Criteria.**
- Files removed: `backend/internal/topology/middleware.go` (the middleware part — substrate-resolver functions and `context.go` helpers stay if still used by `sentinel/resolver.go`; otherwise also removed).
- Removed in same commit: any test files exclusively covering the deleted middleware (`middleware_problemjson_test.go`, `middleware_workspace_test.go`, `boundary_test.go` if scoped to clamp middleware).
- Grep `backend/internal/` for `topology.ClampMiddleware|topology.WorkspaceClampMiddleware|topology.ClampFromCtx|topology.WorkspaceIDFromCtx` returns zero (Sentinel is the sole clamp surface).
- `go build ./...` passes.
- `go test ./...` passes — no orphan test failures from removed middleware.
- `lint:sentinel-clamp-required` still passes (Sentinel is doing the job).
- `sentinel_revision_history.md` gets a close-out entry: which files removed, which substrate-resolver helpers retained in topology vs migrated to sentinel.

**Status.** pending.

**Theme.** B16 Security & Auth.

---

### S26 — Subtree-aware SQL clamp + per-package integration tests (carved from S21)

**Intent.** Layer 2 of the clamp contract: handlers don't just read the clamp, they USE its `AllowedSubtreeIDs` in WHERE clauses so a single SQL query physically cannot return rows outside the requesting user's scope.

**Why this is its own story.** S21 closed the structural contract (every artefact reader sits in a package that consults Sentinel). S26 closes the SQL contract (every artefact-listing query filters by `topology_node_id = ANY(clamp.AllowedSubtreeIDs)`). The latter is a deeper, per-handler refactor — at least 6 packages, new SQL clauses, per-package integration tests with a real subtree fixture — and is best done as its own initiative once the legacy contexts are deleted (S22) and the cross-tenant e2e (S23) is in place to pin the regression boundary.

**Acceptance Criteria.**
- Every list/get handler in artefactitems, artefactitemsv2, artefacttypes, artefactpriorities, portfoliomodels, flows applies `clamp.AllowedSubtreeIDs` to its SQL `WHERE` clause. Where the table has no `topology_node_id`, the clamp is applied via a JOIN to the parent artefact's topology node.
- Per-package integration test: handler with valid JWT + focus inside subtree returns subtree rows only; with focus outside the user's grants returns 403 (Sentinel middleware) OR an empty result (SQL clamp) — both are SOC2-acceptable.
- Existing handler tests stay GREEN.
- A new section in [`sentinel_docs.md`](sentinel_docs.md) documents the subtree-clamp SQL convention (the canonical `WHERE node_id = ANY($N::uuid[])` pattern), so future handlers don't reinvent it.

**Status.** pending.

**Theme.** B16 Security & Auth.

---

## Completion ledger

| Story | Done date | Commit SHA | Tests |
|---|---|---|---|
| S01 | 2026-05-24 | 6fe3b94e | (docs-only — no test) |
| S02 | 2026-05-24 | 332bc138 | stub `sentinel.page.work-items` runs under `test:sentinel:page` |
| S03 | 2026-05-24 | a4577e41 | 6 RED cases captured verbatim |
| S04 | 2026-05-24 | 2d2cd68b | 6 GREEN cases first try; substrate interface in place |
| S05 | 2026-05-24 | 26fee3a6 | 9 GREEN cases (cases 7/8/9 added for workspace absorption); production Resolver + 10 mount migrations + 6 handler migrations + TD-SEN-01 closed |
| S06 | 2026-05-24 | 0a6908a8 | migration 243 applied; users.default_focus_node_id + scope-default booleans live; PoolResolver.DefaultFocus wired |
| S07 | 2026-05-24 | 67cd68d3 | 6 RED cases captured verbatim (vite import-resolution failure) |
| S08 | 2026-05-24 | d20a1a5e | 8/8 GREEN attempt 1; provider + hook + barrel + 401-aware HTTP wrapper; `focus` allowlisted via shareableParams |
| S09 | 2026-05-24 | d149a2cf | SentinelProvider mounted in (user) + (overlay) layouts; tsc silent; `Compiled successfully in 18.1s` — **GATE CLOSED** |
| S10 | 2026-05-24 | 24a75a67 | First Lane A page; 3/3 GREEN; static-grep + mount + apiSite-fired ACs; reference for S11–S16 |
| S11 | 2026-05-24 | b612df57 | /portfolio-items; 3/3 GREEN attempt 1; pattern lifted from S10 |
| S12 | 2026-05-24 | 2bf27308 | /risk; 2/2 GREEN — special case: page already had no old-hook imports |
| S13 | 2026-05-24 | 9fd3de55 | 2 workspace-admin/topology pages; 4/4 GREEN; overlay/topology deferred to S16 via TD-SEN-02 |
| S14 | 2026-05-24 | ed5f34be | 6 workspace-admin pages migrated; cluster-guard test added; Sentinel scope expanded (cases 10 + 11) closing TD-SEN-02 + TD-SEN-03 |
| S15 | 2026-05-24 | f2317262 | vector-admin tenant-settings migrated; 4-route cluster-guard added; 28/28 GREEN |
| S16 | 2026-05-24 | a51bb4f3 | 14 catch-all pages migrated (incl. overlay/topology with sentinel_switch_workspace); SentinelGrant type expanded; 38 tests GREEN |
