# Sentinel — Revision History (architectural decisions)

> **Purpose of this file:** Dated record of every architectural decision in the Sentinel system. Procurement / SOC2 audit narrative: "Show me when each control was introduced and why."
> **Granularity:** One entry per PLA, plus one entry per significant in-flight decision (e.g. when a story surfaces a design pivot).

---

## Entry template

```markdown
### YYYY-MM-DD — <one-line title>

**PLA / story.** <PLA### or S<NN>>
**Decision.** <what was decided, in 2–4 sentences>
**Alternatives considered.** <what was rejected and why>
**Standard-ref.** <NIST / SOC 2 / CMMC clause if applicable>
**Commit(s).** <SHA short(s)>
**Touched files / surfaces.** <bullet list>
```

---

## History (newest first)

### 2026-05-24 — `sentinel_docs.md` synced to current end-to-end state; new § I/O

**PLA / story.** PLA062 / docs follow-up (no story; doc-truth pass after the home-location + login-transition work landed).
**Decision.** Resync `sentinel_docs.md` so that anyone reading it sees what the system actually IS today rather than what it was at PLA062 close-out (S24). Specifically:
1. Added a new **§ I/O** below § Synopsis with two tables — Inputs (what Sentinel consumes) and Outputs (what the Vector site reads from Sentinel) — plus a § Sentinel vs AuthContext note pinning why `/user/account-settings` is the only page that reads identity off `useAuth()`.
2. Updated § Synopsis to enumerate the full action surface (`sentinel_switch_workspace`, `sentinel_set_default_focus`, `sentinel_set_home_follow_mode`, `sentinel_set_settings`) instead of the S24-era abbreviated list, and to describe the `Clamp` struct's three fields (`WorkspaceID` + `FocusNodeID` + `AllowedSubtreeIDs`) rather than the early "calls topology.Service.ResolveSubtree" phrasing.
3. Refreshed the test-tier counts (`sentinel.unit` is now 23 FE + 6 BE handler + 9 middleware) and added a pointer to the BE handler/middleware test files.
4. Expanded § Outputs to list the additional substrate that landed post-S24: `Handler.PutFocus` on the backend, `prefs.SetHomeLocationFollowMode`, migrations 243 + 244, and `HomeLocationSection.tsx`.

**Why now.** Previous docs said `sentinel_set_focus(nodeId)` is end-to-end durable as of 2026-05-24, which is true, but didn't reflect the Pinned/Follow split that landed the same day (Pinned mode session-only, Follow mode persists), the new `sentinel_set_default_focus` action that always persists (used by the dropdown), or the migration-244 column that gates the split. The login-transition re-boot effect was also undocumented. Doc-truth drifted within one day of the underlying landing — fixing it now keeps procurement narrative current.

**Doc-only change.** No code touched. No tests added/changed.

**Touched files / surfaces.**
- `docs/Security/Sentinel/sentinel_docs.md` (§ Synopsis refresh, new § I/O, § Outputs expansion)
- `docs/Security/Sentinel/sentinel_revision_history.md` (this entry)

**Commit(s).** (this commit)

---

### 2026-05-24 — `PUT /sentinel/focus` handler shipped (PLA062 follow-up)

**PLA / story.** PLA062 / post-S26 follow-up (logged as TD-SEN-04 in `sentinel_tech_debt.md`).
**Decision.** Closed the write-side counterpart of the `users.default_focus_node_id` substrate that has shipped read-side since S06. The frontend (`app/sentinel/sentinel_api.ts:166` `putFocus()`) has been calling `PUT /_site/sentinel/focus` since S22; the route 404'd silently, so a user's choice of home topology node never survived sign-out. This change makes `sentinel_set_focus(nodeId)` end-to-end durable.
**What landed.**
1. Two new SQL constants in `backend/internal/sentinel/sql.go` — `sqlUpdateUserDefaultFocus` (the write) + `sqlUserHasGrantOnNodeOrAncestor` (the gate, recursive-CTE descend-inheritance match against `users_roles_topology_nodes`, identical predicate to `topology.sqlAncestorsHasGrantOnTargetOrAncestor` used by PLA-0043 scope reads).
2. Two new `Resolver` interface methods in `types.go` — `GrantOnNode` (read) + `SetUserDefaultFocus` (write) — implemented on `PoolResolver` in `resolver.go`. Keeps the dependency-injection shape consistent with the rest of the package so the handler is unit-testable via the existing `stubResolver` pattern from `middleware_test.go`.
3. New `backend/internal/sentinel/handler.go` with `Handler.PutFocus`. Validation: (a) `auth.UserFromCtx` non-nil → else 401, (b) when `focus_node_id` is non-null, `GrantOnNode` must return true → else 403 `/errors/sentinel/focus-no-access`, (c) when null, column clears unconditionally. RFC 9457 problem+json on every error path via the existing `writeProblem` helper.
4. New `/sentinel` route group in `backend/cmd/server/main.go` (mounted between `/me` and `/nav`) with the standard auth stack: `RequireAuth + RequireFreshPassword + httprate(60/min) + userWriteLimiter + sentinelMW`. `sentinelMW` is included so the handler has the clamp on ctx for future tightening (e.g. scoping writes to the actor's current workspace) and so any future scope_up/down preference writes inherit the same gate.
5. New `backend/internal/sentinel/handler_test.go` with 6 test cases (4 contract cases from the brief: happy path → 204 + capture, null-clears → 204 + nil capture, no-grant → 403 + no write, malformed UUID → 400 + no write; plus 2 bonus contract pins: missing-actor → 401, malformed JSON → 400). All 6 GREEN, all 9 existing middleware tests still pass.

**Alternatives considered.** (i) Two-pool handler taking `pgxpool.Pool` directly per the original brief — rejected because it breaks the substrate's testability invariant (every other handler-shaped concern in `sentinel/` is Resolver-driven). (ii) Reuse `/me/active-scope` — rejected because `active_scope_node_id` is a distinct legacy column with a different concept (tab-local active scope, not persistent home preference) per the comment chain in `users/prefs.go:97`. (iii) Embed under `/me/default-focus` rather than `/sentinel/focus` — rejected because the frontend already calls `/sentinel/focus` and changing that is out of scope; the `/sentinel` group is also the right home for future `scope_up_default` / `scope_down_default` writes against the same migration-243 column set.
**Standard-ref.** NIST 800-53 AC-3 — the handler re-validates the actor's grant on the node before writing, so a user cannot store a default pointing at a node they have no access to. Procurement narrative: "write path enforces the same descend-inheritance read predicate the request-time middleware applies."
**Touched files / surfaces.**
- `backend/internal/sentinel/sql.go` (+SQL constants)
- `backend/internal/sentinel/types.go` (+2 Resolver methods on the interface)
- `backend/internal/sentinel/resolver.go` (+2 method implementations on `PoolResolver`)
- `backend/internal/sentinel/middleware_test.go` (extended `stubResolver` to satisfy the widened interface)
- `backend/internal/sentinel/handler.go` (new)
- `backend/internal/sentinel/handler_test.go` (new)
- `backend/cmd/server/main.go` (+ `/sentinel` route group)
- `docs/Security/Sentinel/sentinel_tech_debt.md` (+TD-SEN-04 resolved entry)
- `docs/Security/Sentinel/sentinel_docs.md` (synopsis note — `sentinel_set_focus` now end-to-end durable)
**Commit(s).** (this commit)

---

### 2026-05-24 — Post-close runtime fixes (PLA062 follow-up — landed same day)

**PLA / story.** PLA062 / post-S25 (no story; bug-fix landings on `main`).
**Decision.** Three runtime issues surfaced in dev within an hour of S25 closing; rather than re-open a story we landed targeted fixes on `main` with full doc trail.
**What landed.**
1. **`b640094f` fix(sentinel): mount SentinelProvider at root + bridge fetchBoot to existing endpoints.** `ArtefactTypeCatalogueProvider` mounts in the root `app/layout.tsx` and (post-S17) reads `useSentinel()`. SentinelProvider was only mounted inside `(user)/layout.tsx` + `(overlay)/layout.tsx`, so every request went HTTP 500. Fix: moved `<SentinelProvider>` up to root, removed redundant inner mounts. Also: `fetchBoot()` was calling `/sentinel/boot` (route not yet implemented), so the provider never populated; added a `/auth/me` + `/topology/grants/me` fallback bridge.
2. **`65fbab08` fix(sentinel): align sql.go to current table names + wire focus→meg URL bridge.** Dev Debug panel pinned `HasActiveRole` returning "role check failed" — the S04 substrate copy-paste used pre-rename table/column names (`roles_workspaces`, `workspaces`) that no longer exist. Renamed to `users_roles_workspaces` (with the canonical `users_roles_workspaces_id_workspace` / `_id_user` / `_revoked_at` columns) and `workspace` (singular). Also patched `withForwardedMeg` in `app/lib/api.ts` to read from `?focus=` AND legacy `?meg=` (precursor to fix #3 below).
3. **`dca96bac` fix(sentinel): rename URL param focus → meg.** Sentinel introduced a parallel `focus` URL name during S08; collapsed to `meg` (PLA-0053 canonical, named after Rick's daughter Megan) so the project has one canonical scope-identity URL param. Frontend (`SHAREABLE_PARAMS`, `parseMegFromURL`, `SentinelProvider.setFocus` URL write, test fixtures) + backend (`middleware.go resolveFocus` reads `?meg=`, `middleware_test.go` fixture URLs). Internal state-bag field name `sentinel_focus_node` and action `sentinel_set_focus` are **unchanged** — those describe the concept, not the URL.

**Tests.** 10/10 sentinel.unit GREEN. Backend `go test ./internal/sentinel/...` GREEN. tsc + `go build ./...` both silent. Live dev verified HTTP 200 on `/`, `/login`, `/work-items`, `/topology` after each fix.
**Standard-ref.** Same baseline. The procurement narrative is unchanged: Sentinel is the sole identity/tenant/scope owner; the URL param it writes is `meg`.
**Carved-out follow-ups (still open).** S26 (subtree SQL clamp) and TD-SENT-AUTH-EXTRACT (credential-flow lift) unchanged.

---

### 2026-05-24 — PLA062 close-out (S17–S24)

**PLA / story.** PLA062 / S17 through S24.
**Decision.** Sentinel is now the **sole** identity/tenant/scope owner across the frontend; the legacy `ScopeContext`, `TenantContext`, `Sentinel.tsx` bridge, and `scopeReloadRegistry` are deleted; the backend `lint:sentinel-clamp-required` allowlist is empty; the cross-tenant Playwright spec is in place. Two pieces were carved out as their own follow-ups: (a) the deeper subtree-aware SQL clamp + per-package integration tests (S26, carved from S21 mid-build); (b) the AuthContext credential-flow extraction to `app/lib/auth.ts` (deferred from S22).
**What landed in this batch.**
- **S17** `407b9e64` — 23 shared components/hooks/pages migrated to Sentinel (every `useHasPermission`/`useAuth`/`useScope` consumer outside the legacy contexts).
- **S18** `b61c70f5` — `useActiveWorkspace` hook deleted; 10 active call sites inlined via `useSentinel().sentinel_user?.workspace_id`. F2 feature test repurposed onto Sentinel.
- **S19** `55af5214` — Two frontend lint ratchets: `lint:no-direct-workspace-id` (0 exempt) + `lint:no-old-context-imports` (10 exempt at the time, 9 after S22). Paired self-test scripts.
- **S20** `40a6b565` — Go lintcheck `TestSentinelClampRequired` + 3 fixture self-tests (negative / positive / comment-only). Wired into `go test ./internal/lintchecks/...`.
- **S21** `61e9532a` — Emptied the `sentinelClampAllowlist`; all 6 previously-allowlisted packages already read `sentinel.WorkspaceIDFromCtx` from the S05 absorption. The deeper SQL-clamp layer is now S26.
- **S22** `d14bcc70` — Hard-cut delete of `ScopeContext` (368 LOC), `TenantContext` (123 LOC), `Sentinel.tsx` bridge (128 LOC), `scopeReloadRegistry` (27 LOC), `f_sentinel_scope_reload.test.tsx`. Net −700 LOC. AuthContext.tsx deferred — extraction story TD-SENT-AUTH-EXTRACT.
- **S23** `7e411939` — RED cross-tenant Playwright spec (`e2e/sentinel_cross_tenant_isolation.spec.mjs`, 3 test cases). GREEN gated on two-tenant fixture seed + S26 subtree SQL clamp.
- **S24** (this commit) — Documentation close-out + CLAUDE.md HARD RULE.
**Carved-out follow-ups.**
- **S26** — Subtree-aware SQL clamp + per-package integration tests. Layer 2 of the procurement contract: handlers don't just READ the clamp, they USE its `AllowedSubtreeIDs` in WHERE clauses.
- **TD-SENT-AUTH-EXTRACT** — Lift credential flow (login, mfaLogin, logout, refresh, DPoP keypair lifecycle, hard-logout sessionStorage banner) from `AuthContext.tsx` into `app/lib/auth.ts`; then delete AuthContext + its 9 remaining `lint:no-old-context-imports` exemptions.
**Standard-ref.** Same baseline (NIST 800-53 AC-3/AC-4, SOC 2 CC6.1/CC6.6, CMMC L2 AC.L2-3.1.1, NIST 800-63B AAL2). Procurement story: "single source of truth for tenant scope" is now defensible — `useSentinel()` on the client, `sentinel.FromCtx(ctx)` on the server, both pinned by lint ratchets and the Playwright cross-tenant spec.
**Touched files / surfaces.** ~50 files across `app/components/`, `app/contexts/`, `app/hooks/`, `app/user/`, `app/sentinel/`, `app/redesign/`, `app/(user)/`, `dev/scripts/`, `dev/registries/`, `backend/internal/lintchecks/`, `e2e/`, `docs/Security/Sentinel/`, `docs/c_c_lint_rules.md`.

---

### 2026-05-24 — Sentinel scope expanded mid-S14: switchWorkspace + workspace settings absorbed

**PLA / story.** PLA062 / mid-S14 (between commit `9fd3de55` and S14 resumption).
**Decision.** Page-migration spike during S14 surfaced two adjacent surfaces that the original Sentinel scope (Identity + Tenant + Scope) didn't model: (1) workspace-within-tenant switch action used by `overlay/topology/page.tsx` (logged as TD-SEN-02 mid-S13); (2) workspace-settings writer used by `workspace-admin/workspace-details/page.tsx` (logged as TD-SEN-03 mid-S14). Per user direction (2026-05-24), Sentinel **absorbs both** rather than letting them spawn peer contexts.
**Alternatives considered.**
- **Defer to S16** (the original "log TD, migrate later" path) — rejected as accumulating debt and leaving migration story incomplete.
- **Extract `WorkspaceSettingsContext` as a peer to Sentinel** — rejected by user direction. Sentinel becomes The Single Context Of Truth, even where the data is genuinely settings-shaped (theme, tenant_name, prefs). Cost: Sentinel grows in surface area; benefit: only one provider for consumers to know about.
**Standard-ref.** Same control set as the baseline (NIST 800-53 AC-3/AC-4, SOC 2 CC6.1/CC6.6). Workspace settings aren't a security control by themselves but live in the same provider that owns the tenant identity, which simplifies the SOC 2 "single source of truth" narrative.
**Cost.** New action `sentinel_switch_workspace(workspaceID)`. New state slice `sentinel_settings: WorkspaceSettings`. New action `sentinel_set_settings(s)`. New `/sentinel/switch-workspace` backend endpoint OR reuse `/_site/auth/switch-workspace` via `sentinel_api`. Two new RED test cases (10, 11) in `sentinel_provider.test.tsx`. Estimated 1–2 hours before S14 resumes.
**Note for future architects.** Settings ≠ identity is a defensible architectural boundary. Sentinel absorbing settings is a **pragmatic** choice biased to single-provider simplicity for consumers, made knowing the cost. If Sentinel grows beyond ~500 LOC of state, revisit splitting `WorkspaceSettingsContext` out as a peer — the lint contract will catch most of the regressions.
**Commit(s).** (pending — to land with the two paydown commits)
**Touched files (projected).**
- `app/sentinel/types.ts` — add `sentinel_switch_workspace`, `sentinel_settings`, `sentinel_set_settings`
- `app/sentinel/sentinel_api.ts` — add `postSwitchWorkspace`, `fetchSettings`, `putSettings`
- `app/sentinel/SentinelProvider.tsx` — reducer cases + actions
- `app/sentinel/__tests__/sentinel_provider.test.tsx` — cases 10 + 11
- `docs/Security/Sentinel/sentinel_tech_debt.md` — TD-SEN-02 + TD-SEN-03 move to Resolved
- `docs/Security/Sentinel/sentinel_backlog.md` — annotation in S14 status

---

### 2026-05-24 — Workspace clamp absorbed into Sentinel (S05 substrate unification)

**PLA / story.** PLA062 / S05.
**Decision.** During S05 investigation we confirmed that `topology.ClampMiddleware` (per-grant clamp from PLA-0006) has zero mounts in `cmd/server/main.go` — it's dead code already. The active middleware is `topology.WorkspaceClampMiddleware` (10 mounts) which does workspace narrowing from JWT claim per PLA-0053. Per user direction (2026-05-24), Sentinel absorbed this second axis: workspace_id is now a `Clamp` field, resolved by `sentinel.Middleware` (JWT claim > `FirstLiveWorkspace` fallback), gated by a `HasActiveRole` forgery check, and exposed via `sentinel.WorkspaceIDFromCtx(ctx)` — a drop-in facade matching the prior topology two-value return.
**Alternatives considered.**
- Mount sentinel.Middleware **alongside** topology.WorkspaceClampMiddleware (no absorption) — rejected: leaves the procurement-narrative gap ("two ctx entities own scope") that the original brief explicitly forbids.
- Split workspace absorption into a separate S05b story — rejected: increases the number of broken-intermediate-state moments where some handlers read topology ctx and others read sentinel ctx. Bundling keeps `main` consistent.
**Standard-ref.** Same as PLA062 baseline — NIST 800-53 AC-3/AC-4, SOC 2 CC6.1/CC6.6, CMMC L2 AC.L2-3.1.1.
**Cost.** S05 grew from "mount + production resolver" to "mount + production resolver + 3 new test cases (7/8/9) + Clamp.WorkspaceID + Resolver interface extension + 10 mount-site migrations + 6 handler-file migrations + handler ctx-accessor facade". All 9 sentinel tests GREEN attempt 1.
**Commit(s).** (this commit, S05 close-out)
**Touched files / surfaces.**
- `backend/internal/sentinel/types.go` — `Clamp` gains `WorkspaceID`; `Resolver` gains `FirstLiveWorkspace` + `HasActiveRole`
- `backend/internal/sentinel/errors.go` — `ErrNoWorkspace` + `ErrNoWorkspaceRole` sentinels
- `backend/internal/sentinel/ctx.go` — `WorkspaceIDFromCtx` facade
- `backend/internal/sentinel/middleware.go` — workspace resolution + role guard inserted between auth and focus resolution
- `backend/internal/sentinel/middleware_test.go` — cases 7/8/9 + stub method receivers
- `backend/internal/sentinel/resolver.go` — `PoolResolver` (full implementation closing TD-SEN-01)
- `backend/internal/sentinel/sql.go` — recursive-CTE SQL constants
- `backend/cmd/server/main.go` — `sentinelResolver` + `sentinelMW` wiring; 10 mount-site replacements
- `backend/internal/{artefactitems,artefactpriorities,artefacttypes,portfoliomodels,flows}/*.go` — handler ctx-accessor migrations + doc-comment refreshes

---

### 2026-05-24 — Mid-build pivot: backend approach changes from "facade" to "Replace" (own substrate)

**PLA / story.** PLA062 / pre-S03 (between S02 commit `332bc138` and S03 start).
**Decision.** Investigation before writing S03 revealed that `backend/internal/topology/` already ships a working clamp substrate from PLA-0006 + PLA-0043: `topology.ClampMiddleware` (per-grant request clamp), `topology.WorkspaceClampMiddleware` (workspace narrowing), `topology.Clamp` struct + `withClamp` / `ClampFromCtx` helpers, `DescendantNodeIDs` / `AncestorNodeIDs` resolvers, and a `tenantRootID` lookup. Roughly 600 LOC of tested, in-production code.
Original PLA062 implicitly assumed Sentinel was greenfield. With the existing substrate visible, we picked **full Replace**: Sentinel owns the substrate end-to-end. The topology clamp middlewares get deprecated and deleted by a new closing story (S25). The handler-facing surface is exclusively `sentinel.*`; no handler ever imports `topology.ClampFromCtx`.
**Alternatives considered.**
- **Reuse** — sentinel as thin facade calling existing `topology.ClampMiddleware` + `Subtree`/`DescendantNodeIDs`/`AncestorNodeIDs`. Lightest effort (~150 LOC for S04), zero duplication. Rejected because: handlers would still need to know two namespaces during the transition, and the audit story is muddier ("clamp is in topology AND sentinel; sentinel mostly delegates" is harder to defend than "clamp is sentinel, full stop").
- **Hybrid** — sentinel owns the public middleware face, topology's middleware gets renamed lowercase and stays as the SQL-level workhorse. Achieves single-public-namespace at lower duplication cost (~300 LOC for S04, no S25 needed). Rejected by explicit user direction (2026-05-24) — the procurement narrative is stronger with full Replace, even at 2× effort.
**Cost of decision.** S04 grows from ~150 LOC to ~600 LOC (duplicate the substrate). S05 grows from "mount sentinel.Middleware" to "mount sentinel.Middleware AND tear out 6+ topology middleware mounts in `cmd/server/main.go`". Adds a new closing story S25 (delete `topology.ClampMiddleware` + `topology.WorkspaceClampMiddleware` once S21 proves Sentinel is the sole gate end-to-end). Estimated +4-6 hours over original.
**Standard-ref.** Same as PLA062 entry below — NIST 800-53 AC-3/AC-4, SOC 2 CC6.1/CC6.6, CMMC L2 AC.L2-3.1.1. The choice does not change the controls; it changes the surface that implements them.
**Commit(s).** (none yet — recorded before S03 starts.)
**Touched files / surfaces (projected).**
- `backend/internal/sentinel/` — full substrate (`types.go`, `middleware.go`, `workspace_middleware.go`, `ctx.go`, `errors.go`, `resolver.go`, `sql.go`, plus test files mirroring topology's coverage)
- `backend/cmd/server/main.go` — `topology.*Middleware` mounts replaced by `sentinel.Middleware`
- `backend/internal/topology/` — middleware files deleted at S25 (substrate-resolver functions like `DescendantNodeIDs` / `AncestorNodeIDs` may stay or move into sentinel/, TBD at S25)
- `docs/Security/Sentinel/sentinel_backlog.md` — S25 added; S03/S04/S05 AC expanded to reflect substrate ownership

---

### 2026-05-24 — Doc tree scaffolded; PLA062 starts

**PLA / story.** PLA062 / S01.
**Decision.** Sentinel becomes the single source of truth for identity / tenant / scope. Hard cut over four React contexts (`AuthContext`, `ScopeContext`, `TenantContext`, original read-only `Sentinel`, plus `scopeReloadRegistry`). RED-GREEN test pyramid (unit + page-integration + cross-tenant e2e) drives every story; no shims, no compat layers.
**Alternatives considered.**
- Soft cut with `@deprecated` shims for one release cycle — rejected: creates exactly the kind of lingering shim the brief forbids.
- Keep AuthContext separate, only collapse Scope/Tenant — rejected: leaves the 17 direct `user.workspace_id` reads behind; doesn't close the procurement-narrative gap.
- Page-level integration tests only (no unit / no e2e) — rejected: misses the workspace-switch race (state-machine concern) and doesn't satisfy SOC2 cross-tenant evidence requirement.
**Standard-ref.** NIST 800-53 AC-3, AC-4; SOC 2 Type II CC6.1, CC6.6; DoD CMMC L2 AC.L2-3.1.1; NIST 800-63B AAL2 session re-binding.
**Commit(s).** (this commit)
**Touched files / surfaces.**
- `docs/Security/Sentinel/sentinel_docs.md` (new)
- `docs/Security/Sentinel/sentinel_backlog.md` (new)
- `docs/Security/Sentinel/sentinel_tests_log.md` (new)
- `docs/Security/Sentinel/sentinel_tech_debt.md` (new)
- `docs/Security/Sentinel/sentinel_revision_history.md` (new — this file)
- `.claude/CLAUDE.md` (pointer added under Working-practices index)

---
