# Vector — Product Scope & Feature Tracker

**Created:** 2026-05-08
**Last updated:** 2026-05-18 (RF1.1.8 stop gate closed — all 5 drift-prevention lints pass against HEAD; CI workflow runs them on every push. RF1 Phase 1 fully complete; next live RF1 step is the RF1.2 package consolidation queue.)
**Doc version:** 2.42

> **★ Solo-dev mode — WIP cap 5** (since 2026-05-17). See [`.claude/memory/feedback_solo_dev_mode.md`](.claude/memory/feedback_solo_dev_mode.md) and the bridge document at [`.claude/scratch/correction-prompt.md`](.claude/scratch/correction-prompt.md). In-flight allowed: RF1, FLOW1, F1, **B16.8**, FE-POR-0002. Everything else parks below. *(Swap 2026-05-18: B18.7 parked out → B16.8 security hardening swapped in; pre-launch security is now the active fifth slot.)*
>
> **★ FORCING FUNCTION:** [FE-POR-0002 Chrome Scope Picker](#fe-por-0002-chrome-scope-picker-pla-0042) — the daily-use slice. Everything else justifies itself against keeping this healthy.

---

## Table of Contents

**RF — Codebase Recovery** *(structural refactor — PLA-0048, top priority)*

- [RF1. Codebase Recovery (PLA-0048)](#rf1-codebase-recovery-pla-0048)

**FLOW — Flow-State Primitives** *(canonical lifecycle model — quick reference)*

- [FLOW1. Flow-State Kind &amp; Pull-Eligibility Model](#flow1-flow-state-kind--pull-eligibility-model)

**F — Product Functionality** *(user-visible features currently being built)*

- [F1. Artefact Type and Flow State Customisation](#f1-artefact-type-and-flow-state-customisation)

**FE — Feature Areas** *(governance, UX, and other domain-tagged features)*

- [FE-GOV-0003. Flow-State Descriptions &amp; Per-State Exit Rules (PLA-0040)](#fe-gov-0003-flow-state-descriptions--per-state-exit-rules-pla-0040)
- [FE-GOV-0004. Orbit View Transition Editor &amp; Artefact-Move Enforcement (PLA-0041)](#fe-gov-0004-orbit-view-transition-editor--artefact-move-enforcement-pla-0041)
- [FE-POR-0002. Chrome Scope Picker (PLA-0042)](#fe-por-0002-chrome-scope-picker-pla-0042) ★ **FORCING FUNCTION**

**M — v2 Migration** *(build order: easiest → hardest)*

- [M1. Flows](#m1-flows)
- [M2. Tenant Settings](#m2-tenant-settings)
- [M3. Defects](#m3-defects)
- [M4. User Stories](#m4-user-stories)
- [M5. Portfolio Items](#m5-portfolio-items)
- [M6. Topology](#m6-topology)

**B — Product Features**

- [B1. Core Work Item Engine](#b1-core-work-item-engine)
- [B2. Sprint &amp; Timebox Management](#b2-sprint--timebox-management)
- [B3. Portfolio &amp; Master Record](#b3-portfolio--master-record)
- [B4. Custom Fields](#b4-custom-fields)
- [B5. Roles &amp; Permissions (RBAC)](#b5-roles--permissions-rbac)
- [B6. Workspace &amp; Topology](#b6-workspace--topology)
- [B7. Search](#b7-search)
- [B8. Public API &amp; Integrations](#b8-public-api--integrations)
- [B9. Webhooks](#b9-webhooks)
- [B10. Async Jobs &amp; Reporting](#b10-async-jobs--reporting)
- [B11. Real-Time &amp; Async Push](#b11-real-time--async-push)
- [B12. n8n Integration](#b12-n8n-integration)
- [B13. Library &amp; Portfolio Models](#b13-library--portfolio-models)
- [B14. Addressables &amp; Page Help](#b14-addressables--page-help)
- [B15. UI Primitives &amp; Design System](#b15-ui-primitives--design-system)
- [B16. Security &amp; Auth](#b16-security--auth)
- [B17. Infrastructure &amp; DevOps](#b17-infrastructure--devops)
- [B18. Developer Experience](#b18-developer-experience)
- [B19. Work Item Relations Graph](#b19-work-item-relations-graph)
- [B20. User Access Rights &amp; Navigation Control](#b20-user-access-rights--navigation-control)
- [B21. Artefact-Items Substrate (PLA-0037)](#b21-artefact-items-substrate-pla-0037)
- [B22. Transport Segregation via Shared Service Core (PLA-0039)](#b22-transport-segregation-via-shared-service-core-pla-0039)

**Parked — solo-dev mode** *(WIP-cap overflow; verbatim, awaiting unpark)*

- [FE-POR-0003. Topology Scope Clamp on Artefact Reads (PLA-0043)](#fe-por-0003-topology-scope-clamp-on-artefact-reads-pla-0043) — parked 2026-05-17
- [B18.7. Shared methods catalogue (PLA-0045)](#b187-shared-methods-catalogue-pla-0045--parked-2026-05-18-swapped-out-for-b168-security-hardening) — parked 2026-05-18 (swapped for B16.8)
- [B-SHARE. Short-link service for sharing views &amp; filters](#b-share-short-link-service-for-sharing-views--filters--parked-2026-05-18) — parked 2026-05-18 (design captured, awaiting saved-views consumer)

---

## RF1. Codebase Recovery (PLA-0048)

Drag the codebase from its current state (SQL scattered across 56 of 137 backend files, inconsistent table/route naming, CI gates that only fire on PR-to-main) into a shape a DBA or fresh engineer can read at first glance. Built from four parallel Opus audits run 2026-05-13 — not from memory. Audit findings: 42 backend packages, 32,877 lines non-test Go, 461 raw SQL string literals embedded in service files, **zero `sql.go` files**, 10 packages touching >1 database, 22 cross-DB function paths (5 high-risk). Master plan: [`docs/c_c_the_state_of_the_codebase.md`](docs/c_c_the_state_of_the_codebase.md). Plan card: [`dev/plans/PLA-0048.json`](dev/plans/PLA-0048.json). Hard stop gates between every phase; no improvisation; every commit reversible. `[P1]` 🔵 IN FLIGHT

### RF1.0 Phase 0 — Codify conventions (no code changes)

- ✅ **RF1.0.1** ~~Write `docs/c_c_naming_conventions.md` as a leaf doc capturing every rule from §2 of the master plan (Go packages, tables, routes, file layout, migrations).~~ `[P1]`
> Commit `8f9f571` (2026-05-13): docs(PLA-0048 / RF1.0): lock canonical naming conventions [RF1.0.1] [RF1.0.2]
- ✅ **RF1.0.2** ~~Add one-line pointer to `CLAUDE.md` index.~~ `[P1]`
> Commit `8f9f571` (2026-05-13): docs(PLA-0048 / RF1.0): lock canonical naming conventions [RF1.0.1] [RF1.0.2]
- ✅ **RF1.0.3** ~~Stop gate: user reviews the conventions doc before any code change happens.~~ **CLEARED 2026-05-14** — Rick confirmed all 5 review points (root families, scheduled renames, multi-FK semantic suffix, audit_logs scope, errors_* split). `[P1]`

### RF1.1 Phase 1 — Install drift-prevention lints BEFORE the rewrite

- ✅ **RF1.1.1** ~~`lint:sql-in-sqlfile-only` — forbids raw SQL outside `sql.go` files. Seeded with wide allow-list from current state; shrinks one package per Phase 2 step.~~ Seed = 58 files. `[P1]`
> Commit `08f5740` (2026-05-14): feat(PLA-0048 / RF1.1): install drift-prevention lints + CI workflow [RF1.1.1] [RF1.1.2] [RF1.1.3] [RF1.1.4] [RF1.1.5] [RF1.1.6]
- ✅ **RF1.1.2** ~~`lint:no-empty-route-block` — fails any `r.Route(...)` with no verb registrations inside.~~ `[P1]`
> Commit `08f5740` (2026-05-14): feat(PLA-0048 / RF1.1): install drift-prevention lints + CI workflow [RF1.1.1] [RF1.1.2] [RF1.1.3] [RF1.1.4] [RF1.1.5] [RF1.1.6]
- ✅ **RF1.1.3** ~~`lint:exemption-ratchet` — `*_exempt.json` files cannot grow commit-to-commit.~~ Walks 11 ledgers, fails on any growth vs HEAD~1. `[P1]`
> Commit `08f5740` (2026-05-14): feat(PLA-0048 / RF1.1): install drift-prevention lints + CI workflow [RF1.1.1] [RF1.1.2] [RF1.1.3] [RF1.1.4] [RF1.1.5] [RF1.1.6]
- ✅ **RF1.1.4** ~~`lint:deferral-needs-td-id` — commit messages containing deferral phrases must reference `TD-*`.~~ Standalone script; commit-msg hook installation deferred (RF1.1.7 follow-up). `[P1]`
> Commit `08f5740` (2026-05-14): feat(PLA-0048 / RF1.1): install drift-prevention lints + CI workflow [RF1.1.1] [RF1.1.2] [RF1.1.3] [RF1.1.4] [RF1.1.5] [RF1.1.6]
- ✅ **RF1.1.5** ~~`lint:package-naming-convention` — fails any `*v\d+` package without a register entry naming the predecessor.~~ Updated to match §1.1.2 v-suffix-with-meaning rule (doc.go must explain predecessor). `[P1]`
> Commit `08f5740` (2026-05-14): feat(PLA-0048 / RF1.1): install drift-prevention lints + CI workflow [RF1.1.1] [RF1.1.2] [RF1.1.3] [RF1.1.4] [RF1.1.5] [RF1.1.6]
- ✅ **RF1.1.6** ~~New CI workflow `tests.yml` running `npm test`, `npx tsc --noEmit`, `go test ./...`, `go vet ./...` on every push (not just PR-to-main).~~ Five jobs: frontend, backend, rf1-lints, existing-lints, plus existing api-contracts.yml unchanged. `[P1]`
> Commit `08f5740` (2026-05-14): feat(PLA-0048 / RF1.1): install drift-prevention lints + CI workflow [RF1.1.1] [RF1.1.2] [RF1.1.3] [RF1.1.4] [RF1.1.5] [RF1.1.6]
- **RF1.1.7** Tighten `dev/scripts/check_callers.py` regex to skip files with `import { apiSite as api }` (closes TD-API-003). `[P2]`
- ✅ ~~**RF1.1.8** Stop gate: all five lints pass against HEAD + user reviews lint configs.~~ Closed 2026-05-18. All five RF1 drift-prevention lints (`sql-in-sqlfile-only`, `no-empty-route-block`, `exemption-ratchet`, `deferral-needs-td-id`, `package-naming-convention`) pass clean against HEAD. CI workflow `tests.yml` runs them on every push alongside `npm test` / `tsc --noEmit` / `go test` / `go vet`. Exemption ledgers stable since 2026-05-14 landing. `[P1]`

### RF1.2 Phase 2 — sql.go consolidation, one package at a time

Order: cleanest-first, highest-leverage-first, sagas last. Per-package shape identical for all 20: create `sql.go`, move every SQL literal to a named const (`sqlVerbResource`), update functions, build, test, smoke, commit, shrink lint allow-list. Stop gate after EVERY package.

- **RF1.2.1** `topology` (post-tonight; includes `orgdesign` → `topology` rename for Section-1 consistency). `[P1]` ✅ done 2026-05-14 — `sql.go` created with 52 named consts (1 in permissions.go, 1 in handler.go, 6 in middleware.go, 7 in commands.go, 37 in service.go); allow-list shrunk 58 → 53. Pre-existing boundary violation in `portfoliomodels/dev_reset.go` captured as **TD-TOP-001**.
> Commit `6190859` (2026-05-14): refactor(PLA-0048 / RF1.2.1): consolidate topology SQL into sql.go [RF1.2.1]
- **RF1.2.2** `auth` — 21 SQL strings, single-DB, foundational. `[P1]` ✅ done 2026-05-14 — `sql.go` created with 21 named consts (role/user lookups + login lifecycle + refresh-token rotation + logout + password change/reset); allow-list shrunk 53 → 52.
> Commit `44e6e68` (2026-05-14): refactor(PLA-0048 / RF1.2.2): consolidate auth SQL into sql.go [RF1.2.2]
- **RF1.2.3** `users` — 15 SQL strings, single-DB. `[P1]` ✅ done 2026-05-14 — `sql.go` created with 14 named consts across service.go / prefs.go / handler.go (Create + List + Update + Delete + IssueResetLink + FindByID + theme-pack get/set + post-reset email lookup); 2 dedupes (sqlInsertPasswordReset shared by Create + IssueResetLink, sqlSelectUserTenantRoleEmail shared by Delete + IssueResetLink); 1 fragment const for the role_id subquery in the sparse Update. Allow-list shrunk 52 → 49.
> Commit `cb1b895` (2026-05-14): refactor(PLA-0048 / RF1.2.3): consolidate users SQL into sql.go [RF1.2.3]
- **RF1.2.4** `roles` — 10 SQL strings, single-DB. `[P1]` ✅ done 2026-05-14 — `sql.go` created with 10 named consts (permission-id resolution + list/get + Create/Update/Archive + role-permission grid upsert/delete/list + permissions catalogue). Allow-list shrunk 49 → 48.
> Commit `15c0ddd` (2026-05-14): refactor(PLA-0048 / RF1.2.4): consolidate roles SQL into sql.go [RF1.2.4]
- **RF1.2.5** `permissions` — 3 SQL strings, single-DB, foundational. `[P2]` ✅ done 2026-05-14 — `sql.go` created with 3 named consts (sqlListPermissionCodes for VerifyParity at boot; sqlSelectUserRoleID + sqlSelectPermissionCodesForRole for the cached PermissionsFor resolver). Allow-list shrunk 48 → 46.
> Commit `09d14fd` (2026-05-14): refactor(PLA-0048 / RF1.2.5): consolidate permissions SQL into sql.go [RF1.2.5]
- **RF1.2.6** `addressables` — 21 SQL strings, single-DB. `[P2]` ✅ done 2026-05-14 — `sql.go` created with 21 named consts (Snapshot + HelpFor + AdminListHelp + UpdateHelp + ArchiveHelp + UpdateHelpable + upsertAddressable family with paired root/child variants + archiveDroppedBuildRows + lookupRowByAddress + addressableExists + peekSibling root/child + touchLastSeen root/child + lookupID + library_help_defaults seed with placeholder/library variants). Allow-list shrunk 46 → 45.
> Commit `66c5973` (2026-05-14): refactor(PLA-0048 / RF1.2.6): consolidate addressables SQL into sql.go [RF1.2.6]
- **RF1.2.7** `nav` — 53 SQL strings, single-DB. `[P2]` ✅ done 2026-05-14 — `sql.go` created with ~46 named consts spanning bookmarks (Pin/Unpin/IsPinned + advisory lock + entity-bookmark page upsert + role-page grants + position compaction) + entities (portfolio+product union) + registry (page_tags + system-pages-with-roles aggregate) + profiles (List/Create/Rename/Delete/Reorder + active/Default resolve + group-placement CRUD) + service (lazy-seed CTEs for non-default first-read, Default backfill, admin-group seed, group-placement seed, prefs CRUD, custom-groups CRUD); 1 fmt.Sprintf template for the EntityKind-parameterised loadEntity SELECT; multiple dedupes across legacy + per-profile DeletePrefs paths. Allow-list shrunk 45 → 40.
> Commit `cf2cfad` (2026-05-14): refactor(PLA-0048 / RF1.2.7): consolidate nav SQL into sql.go [RF1.2.7]
- **RF1.2.8** `flows` — 30 SQL strings, single-DB. `[P2]` ✅ done 2026-05-14 — `sql.go` created with 30 named consts across service.go (catalogue list + exit rules CRUD + state CRUD + transition CRUD), reset_load.go (snapshot diff reads — type/flow/states/transitions live vs snapshot), and reset_service.go (preview impact probe + apply ops: rebind artefacts, archive/update/insert states, transitions). Allow-list shrunk 40 → 37.
> Commit `22ba22b` (2026-05-14): refactor(PLA-0048 / RF1.2.8): consolidate flows SQL into sql.go [RF1.2.8]
- **RF1.2.9** `webhooks` — 11 SQL strings, single-DB. `[P3]` ✅ done 2026-05-14 — `sql.go` created with 11 named consts across service.go (subscription List/Get/Insert/Update sparse template/SoftDelete + Enqueue fan-out: active filters + delivery insert) and worker.go (FOR UPDATE SKIP LOCKED claim + mark claimed + delete on success + record failure with backoff). Allow-list shrunk 37 → 35.
> Commit `fcf9b6c` (2026-05-14): refactor(PLA-0048 / RF1.2.9): consolidate webhooks SQL into sql.go [RF1.2.9]
- **RF1.2.10** `timeboxsprints` + `timeboxreleases` — small, single-DB. `[P3]` ✅ done 2026-05-14 — two `sql.go` files (mirror-shaped packages): timeboxsprints 9 consts (insert/select/list template/update template/archive/start/close + last-end probe root+node), timeboxreleases 5 consts (insert/select/list template/update template/archive). Allow-list shrunk 35 → 33.
> Commit `b090831` (2026-05-14): refactor(PLA-0048 / RF1.2.10): consolidate timebox SQL into sql.go [RF1.2.10]
- **RF1.2.11** `workspaces` — 18 SQL strings, 2 DBs. `[P2]` ✅ done 2026-05-14 — `sql.go` with 18 consts: commands.go (workspace CRUD + creator admin seed + list/load template/for-update), roles.go (workspace_roles grant idempotent + admin-existence + insert + revoke + list), crossdb.go (cross-DB orphan-scan template — VAPool read-only). Allow-list shrunk 33 → 30.
> Commit `a82f165` (2026-05-14): refactor(PLA-0048 / RF1.2.11): consolidate workspaces SQL into sql.go [RF1.2.11]
- **RF1.2.12** `tenantsettings` — 4 SQL strings, 2 DBs. `[P3]` ✅ done 2026-05-14 — 3 consts (ensure-row idempotent insert + select + sparse-update template). False-positive lint hit on user-facing "select at least one day" message fixed by rewording to "must include at least one day". Allow-list shrunk 30 → 29.
> Commit `0eb2675` (2026-05-14): refactor(PLA-0048 / RF1.2.12): consolidate tenantsettings SQL into sql.go [RF1.2.12]
- **RF1.2.13** `fields` — 5 SQL strings, 2 DBs. `[P3]` ✅ done 2026-05-14 — 5 consts across service.go (vectorPool: workspace tenant + membership probe; artefactsPool: bulk admitted-field lookup) and resolver.go (per-field admit probe). Allow-list shrunk 29 → 27.
> Commit `e8215b7` (2026-05-14): refactor(PLA-0048 / RF1.2.13): consolidate fields SQL into sql.go [RF1.2.13]
- **RF1.2.14** `searchworker` — 7 SQL strings, 2 DBs. `[P3]` ✅ done 2026-05-14 — 7 consts (claim outbox + mark-claimed + delete + select-artefact + compute-tsvector + update search/embedding + record-failure). Allow-list shrunk 27 → 26.
> Commit `faaabec` (2026-05-14): refactor(PLA-0048 / RF1.2.14): consolidate searchworker SQL into sql.go [RF1.2.14]
- **RF1.2.15** `errorsreport` — 2 SQL strings, 3 DBs. `[P3]` ✅ done 2026-05-14 — 2 consts (libRO error-code probe + vectorPool error_events insert). Allow-list shrunk 26 → 25.
> Commit `adaabbd` (2026-05-14): refactor(PLA-0048 / RF1.2.15): consolidate errorsreport SQL into sql.go [RF1.2.15]
- **RF1.2.16** `libraryreleases` — 1 SQL string (rest delegated), 3 DBs. `[P3]` ✅ done 2026-05-14 — 1 const (subscription tier lookup); other queries delegate to librarydb. Allow-list shrunk 25 → 24.
> Commit `08adeb6` (2026-05-14): refactor(PLA-0048 / RF1.2.16): consolidate libraryreleases SQL into sql.go [RF1.2.16]
- **RF1.2.17** `librarydb` — 15 SQL strings, 3 DBs (library access layer). `[P2]` ✅ done 2026-05-14 — 15 consts across fetch.go (template + 6 model children + 2 model spine variants), list.go (published-models list), releases.go (audience filter + actions + acks + insert + find). Absorbed the `modelCols` and `releaseCols` concat fragments into full-shot SELECTs so SQL never crosses the const boundary. Allow-list shrunk 24 → 21.
> Commit `e9fe980` (2026-05-14): refactor(PLA-0048 / RF1.2.17): consolidate librarydb SQL into sql.go [RF1.2.17]
- **RF1.2.18** `portfolio` — 6 SQL strings, 2 DBs. `[P2]` ✅ done 2026-05-14 — 6 consts (vectorPool: workspace subscription probe + active membership; vaPool: master record select + upsert + update template + idempotent archive). Allow-list shrunk 21 → 20.
> Commit `833eae0` (2026-05-14): refactor(PLA-0048 / RF1.2.18): consolidate portfolio SQL into sql.go [RF1.2.18]
- **RF1.2.19** `artefactitemsv2` — 26 SQL strings, 1 DB (rename deferred to Phase 4). `[P2]` ✅ done 2026-05-14 — ~30 named consts: shared rollupCTE + sqlWorkItemColumns fragments; list/get/list-children templates; count + summary templates; flow-state list; CreateWorkItem 6-query saga; PatchWorkItem flow-state probe + sparse-template; archive; BulkOps lock + 4 op queries; field-value list/upsert/delete; owner decoration. Allow-list shrunk 20 → 18 (service.go + types.go).
> Commit `5f69241` (2026-05-14): refactor(PLA-0048 / RF1.2.19): consolidate artefactitemsv2 SQL into sql.go [RF1.2.19]
- **RF1.2.20** `portfoliomodels` — 51 SQL strings, 3 DBs. **Hardest. Last.** `[P1]` ✅ done 2026-05-14 — ~50 named consts across 8 files: service surface (workspace/membership/layer list+patch), adoption_state LEFT-JOIN computed state, adopt.go full saga (resolveWorkspaceID + state machine: insert pending / archive completed / archive stale failed / reset failed→in_progress / mark completed / mark failed / append error event), adopt_strategy_types two-phase topo insert (Phase-1 ON CONFLICT + Phase-2 parent update), adopt_flows (default flow per layer + flow_states ON CONFLICT + flow_transitions; libMap/defaultFlowMap/flowStateFlowMap loaders), adopt_readopt placeholder pattern (upsert placeholder type+artefact / repoint orphans / delete old strategy artefacts / archive old strategy types), adopt_work_types system→tenant copy (Phase-1 ON CONFLICT + Phase-2 parent update + system/tenant prefix loaders), dev_reset (16 ops across VA + mmff_vector). Allow-list shrunk 18 → 10.
> **RF1.2 Phase 2 COMPLETE — 11 packages migrated this session; allow-list now contains only 10 files (apikeys×2, artefacttypes, audit, custompages, entityrefs, ranking×2, search, usertaborder) reserved for later phases.**
> Commit `6487dff` (2026-05-14): refactor(PLA-0048 / RF1.2.20): consolidate portfoliomodels SQL into sql.go [RF1.2.20]

### RF1.3 Phase 3 — Per-DB migration directories

- **RF1.3.1** `git mv db/schema/` → `db/mmff_vector/schema/`. `[P1]` ✅ done 2026-05-14 — flat dir moved under per-DB root.
- **RF1.3.2** `git mv db/artefacts_schema/` → `db/vector_artefacts/schema/`. `[P1]` ✅ done 2026-05-14.
- **RF1.3.3** `git mv db/library_schema/` → `db/mmff_library/schema/`. `[P1]` ✅ done 2026-05-14.
- **RF1.3.4** Update `backend/cmd/migrate/main.go`, `c_db-backup.md`, `backup-on-push.sh`, any tooling that walks `db/`. `[P1]` ✅ done 2026-05-14 — migrate runner main.go (3 dir paths + package doc comments), backend/Makefile test-db-reset target (2 refs), apply-phase3.sh (SCRIPT_DIR REPO_ROOT depth + VECTOR_SQL_DIR), lint_writer_boundary.py docstring, plus ~25 Go file comment refs across catalogue.go/sql.go/listener.go/transport.go/handler.go/grants_test.go/releases_test.go/dispatch_triggers_test.go/topology boundary_test.go/permissions catalogue+test/nav catalog/entityrefs service/realtime listener/transport/portfoliomodels (adopt+adopt_stream+adopt_work_types+sql+dev_reset+cross_db_canary_test+scope_resolver_matrix_test+list_test)/workspaces crossdb_test/cmd/server main.go/CustomFieldManager.tsx — and ops docs (c_postgresql.md, c_postgresql_migrations.md, c_bash_postgres.md, c_lint_rules.md, c_schema.md, c_deployment.md) + memory files (project_db_migrations, MEMORY index, feedback_push_often).
- **RF1.3.5** Stop gate: `go run ./cmd/migrate -dry-run -db <each>` reports zero pending. `[P1]` ✅ done 2026-05-14 — all three DBs (`vector`, `library`, `vector_artefacts`) report "up to date — no pending migrations" against dev cluster on tunnel `:5435`.
> **RF1.3 Phase 3 COMPLETE — three per-DB roots now live (`db/mmff_vector/schema/`, `db/mmff_library/schema/`, `db/vector_artefacts/schema/`); migrate runner reads from them; all code and doc refs updated; dry-run gate green.**

### RF1.4 Phase 4 — Naming-convention sweep, one rename at a time

> **Scope expanded 2026-05-14:** the column-prefix rule locked in `c_c_naming_conventions.md §2.3` significantly enlarges Phase 4. RF1.4.2 (table renames) now covers ~40 tables (was 11) — full canonical list maintained in [`docs/c_c_naming_conventions.md §2.8`](docs/c_c_naming_conventions.md#28--scheduled-renames-rf142). RF1.4.1 (Go package renames) — `artefactitemsv2` removed from the list per the §1.1.1 v-suffix-with-meaning clarification. RF1.4.4 (column renames) added as a new sub-phase. Per-package commits keep blast radius bounded.

#### RF1.4.1 — Go package renames

- **RF1.4.1.1** ~~`artefactitemsv2` → `artefactitems`.~~ **Removed 2026-05-14** — version suffix carries real meaning per §1.1.1; keep as-is and document v1 in doc.go. `[N/A]`
- **RF1.4.1.2** `wsperms` → `workspacepermissions` (if package still exists; check first). `[P3]`
- **RF1.4.1.3** `entityrefs` → `polymorphicrefs`. `[P3]`
- **RF1.4.1.4** `dbcheck` → `dbinvariants`. `[P3]`
- **RF1.4.1.5** `models` → `roletypes`. `[P3]`
- **RF1.4.1.6** `messages` → `usermessages`. `[P3]`
- **RF1.4.1.7** `tenantsettings` → `tenantmasterrecord`. `[P3]`
- **RF1.4.1.8** Update `artefactitemsv2/doc.go` to explicitly explain what v1 was and why v2 exists. `[P2]`

#### RF1.4.2 — Table renames (expanded 2026-05-14)

Full canonical list in [`docs/c_c_naming_conventions.md §2.8`](docs/c_c_naming_conventions.md#28--scheduled-renames-rf142). Summary:

- **RF1.4.2.users** — `roles` → `users_roles`, `permissions` → `users_permissions`, `sessions` → `users_sessions`, `password_resets` → `users_password_resets`, `roles_workspaces` → `users_roles_workspaces`, `roles_pages` → `users_roles_pages`, `roles_permissions` → `users_roles_permissions`, `user_*` → `users_*` (root pluralisation across nav/tab-order/custom-pages). `[P1]`
- **RF1.4.2.admin** — `api_keys` → `admin_api_keys`. `[P2]`
- **RF1.4.2.pages** — `page_tags` → `pages_tags`, `page_addressables` → `pages_addressables`, `page_help` → `pages_help`. `[P2]`
- **RF1.4.2.subscriptions** — `subscription_sequence` → `subscriptions_sequence`, `subscription_item_type_icons` → `subscriptions_item_type_icons`, `entity_stakeholders` → `subscriptions_stakeholders`. `[P2]`
- **RF1.4.2.master_record** — `master_record_portfolio` → `master_record_portfolios`, `master_record_tenant` → `master_record_tenants`, `master_record_workspaces` → `workspaces`. `[P1]`
- **RF1.4.2.topology** — `topology_view_state` → `topology_view_states`, `topology_role_grants` + `roles_org_nodes` → merged as `users_roles_topology_nodes`. `[P1]`
- **RF1.4.2.audit** — `audit_log` → `audit_logs`. `[P2]`
- **RF1.4.2.artefacts** — `artefact_types` → `artefacts_types`, `artefact_type_fields` → `artefacts_types_fields`, `artefact_field_library` → `artefacts_fields_library`, `artefact_workspace_fields` → `workspaces_fields`, `artefact_field_values` → `artefacts_fields_values`, `artefact_number_sequence` → `artefacts_number_sequences`, `artefact_adoption_state` → `artefacts_adoption_states`. `[P1]`
- **RF1.4.2.flows** — `flow_states` → `flows_states`, `flow_transitions` → `flows_transitions`, `flow_state_exit_rules` → `flows_states_exit_rules`, `flow_defaults` → `flows_defaults`, plus `_state_defaults` and `_transition_defaults` siblings. `[P1]`
- **RF1.4.2.timeboxes** — `timebox_sprints` → `timeboxes_sprints`, `timebox_releases` → `timeboxes_releases`. `[P2]` ✅ done 2026-05-14 — migration 054 renames tables + 37 columns per §2.3/§2.4 (PK→`<table>_id`, FK→`<table>_id_<target>`, bare→`<table>_<col>`, `created_at`/`updated_at` canonicalised, `org_node_id` → `_id_topology_node`, `_owner` → `_id_user_owner`), renames 14 indexes + 16 constraints, rewrites trigger functions, and renames `artefacts.timebox_(sprint|release)_id` → `artefacts_id_timebox_(sprint|release)` with the auto-named release FK constraint found via `pg_constraint`. Code surgery: 4 sql.go files (timeboxsprints, timeboxreleases, artefactitemsv2, portfoliomodels), 2 service.go (sparse-update column refs + ListFilters WHERE + isOverlapErr constraint-name), 2 types.go (JSON tags switched to column names), 2 handler.go (3 inbound payload structs each), cmd/server/main.go (rank ScopeColumn), db/seed/010_master_reset.sql, ranking registry+test, 2 frontend pages, kinds.ts (rowPrefix=table-name so `${p}_name` resolves canonically), TimeboxManager.tsx (status pill access + rowKey). DOWN script written. Migration applied dev. Build + vet clean. Template established for the 12 remaining domains.
- **RF1.4.2.webhooks** — `webhook_subscriptions` → `webhooks_subscriptions`, `webhook_deliveries` → `webhooks_deliveries`. `[P2]`
- **RF1.4.2.library** — `library_acknowledgements` → `library_releases_acknowledgements`, `library_release_log` → `library_release_logs`, `library_release_actions` → `library_releases_actions`, `portfolio_templates` → `library_portfolio_models`, `portfolio_template_layer_definitions` → `library_portfolio_models_layers`. `[P1]`
- **RF1.4.2.errors** — `error_codes` → `errors_codes`, `error_events` → `errors_events`. `[P2]`

**Scheduled drops:**
- **RF1.4.2.drop.1** Drop legacy `workspace` (singular) table. `[P2]`
- **RF1.4.2.drop.2** Drop legacy `mmff_vector.sprints`. `[P2]`
- **RF1.4.2.drop.3** Drop `subscription_portfolio_model_state` + adoption-mirror tables. `[P2]`
- **RF1.4.2.drop.4** Drop remaining `obj_*` family as last readers migrate. `[P3]`
- **RF1.4.2.drop.5** Drop `topology_role_grants` after merge into `users_roles_topology_nodes`. `[P1]`

#### RF1.4.3 — Route renames

- **RF1.4.3.1** `/workspace/{id}/fields` → `/workspaces/{id}/fields`. `[P1]`
- **RF1.4.3.2** `/workspace/{id}/portfolio/layers` → `/workspaces/{id}/portfolio/layers`. `[P1]`
- **RF1.4.3.3** `/portfolio` → `/portfolios`. `[P2]`
- **RF1.4.3.4** `/nav/bookmark` → `/nav/bookmarks`. `[P3]`
- **RF1.4.3.5** `/user/tab-order/{pageId}` → `/me/tab-order/{pageId}`. `[P3]`
- **RF1.4.3.6** `POST /admin/api-keys/issue` → `POST /admin/api-keys` (REST canonical). `[P3]`
- **RF1.4.3.7** `POST /admin/api-keys/revoke` → `DELETE /admin/api-keys/{id}` (REST canonical). `[P3]`
- **RF1.4.3.8** `/flow-states/{id}` → `/flows/{flowId}/states/{id}` (and exit-rules nested). `[P3]`
- **RF1.4.3.9** `POST /errors/report` → `POST /error-reports`. `[P3]`
- **RF1.4.3.10** `/admin/dev/adoption-reset` → `/admin/dev/reset-adoption-state`. `[P3]`
- **RF1.4.3.11** `/tenant-settings` → `/workspace-settings` (verify what the table actually keys by first). `[P2]`

#### RF1.4.4 — Column renames ✅ DONE 2026-05-14 (TD-NAME-001 closed same day)

Per `c_c_naming_conventions.md §2.3` every column on every renamed §2.6 root-family table now carries the table-name prefix. Pre-req lint (`lint:column-prefix-convention`) shipped warn-only with a 9-package ledger, then flipped to hard fail-on-violation when the ledger emptied. Nine migrations across mmff_vector + vector_artefacts: 186 (users_password_resets) → 063 (master_record_tenants) → 187 (users_sessions) → 064 (artefacts_fields_values + artefactitemsv2→artefactitems Go-package rename) → 188 (users_roles_workspaces) → 189 (RBAC triangle) → 065 (flows family, 7 tables) → 066 (artefacts_types) → 190 (users_nav family, 5 tables). 245 → 0 findings.

Carve-outs (deferred per §2.9 — JSON wire-tag contract): the `artefacts` core table (distinct from artefacts_types / artefacts_fields_values / artefacts_adoption_states which are prefixed), and the `users` core table. Both stay bare until the frontend wire-tag rewrite lands as a separate PLA.

- ✅ **RF1.4.4.PK** ~~Every PK column renamed from `id` to `<table>_id` across all renamed tables.~~ `[P1]`
- ✅ **RF1.4.4.FK** ~~Every FK column renamed from `<target>_id` to `<table>_id_<target>` (function-then-modifier per §2.4).~~ `[P1]`
- ✅ **RF1.4.4.bare** ~~Every bare column renamed to `<table>_<column>`.~~ `[P1]`
- ✅ **RF1.4.4.semantic** ~~Multi-FK-to-same-parent columns gain a semantic-role suffix (e.g. `granted_by` → `*_id_user_granted_by`).~~ `[P2]`
- ⏸️ **RF1.4.4.polymorphic** Polymorphic FKs keep `_kind` + `_entity_id` split per §2.4 (e.g. `page_addressables.entity_id` → `pages_addressables.pages_addressables_entity_id`). `[P2]` — pages_addressables was prefixed under mig 182, but the entity_id polymorphic column kept its shape. Polymorphic-FK convention sweep deferred until polymorphicrefs service hits a real cleanup case (TD-001 has the trigger).
- ✅ **RF1.4.4.indexes** ~~All non-default-named indexes and constraints renamed to match new column names.~~ `[P2]`

### RF1.5 Phase 5 — Cross-DB writer hardening ✅ DONE 2026-05-14 (commit f173b93)

Each of the 5 high-risk cross-DB writers got a stub `*_crossdb_test.go` documenting partial-failure semantics, plus `lint:cross-db-writer-test` enforcing the convention via a shrinking ledger. Live tests are RF1.5.x follow-ups.

- ✅ **RF1.5.1** ~~`portfoliomodels.Orchestrator.Adopt` stub.~~ `[P1]`
- ✅ **RF1.5.2** ~~`portfoliomodels.DevResetHandler.MasterReset` stub.~~ `[P2]`
- ✅ **RF1.5.3** ~~`artefactitems.Service.CreateWorkItem` stub.~~ `[P1]`
- ✅ **RF1.5.4** ~~`libraryreleases.Handler.Ack` stub.~~ `[P2]`
- ✅ **RF1.5.5** ~~`errorsreport.Handler.Report` stub.~~ `[P3]`
- ✅ **RF1.5.6** ~~`lint:cross-db-writer-test` shipped with shrinking ledger (6 packages on ledger).~~ `[P1]`

### RF1.6 Phase 6 — Documentation pass ✅ DONE 2026-05-14 (commit 4e1e171 + closing commit c7f74bc)

- ✅ **RF1.6.1** ~~Regenerate `docs/c_c_db_routing.md` from code reality post-rewrite.~~ `[P1]`
- ✅ **RF1.6.2** ~~Update `docs/c_schema.md` with renamed table names + DB locations.~~ `[P1]`
- ✅ **RF1.6.3** ~~Finalise `docs/c_c_naming_conventions.md` post-Phase-4 — §2.8 now reads "COLUMN-PREFIX SWEEP COMPLETE"; §1.1.2 v-suffix example updated post-artefactitems rename; §3.3 status column added.~~ `[P2]`
- ✅ **RF1.6.4** ~~Reduce CLAUDE.md index to one-line-only entries per the standing rule.~~ `[P2]`
- 🔵 **RF1.6.5** IN FLIGHT Stop gate: user reads the regenerated docs. `[P1]`

### RF1.7 Completion tests (from master doc §6)

- **RF1.7.1** Open `backend/internal/<any-package>/` and find `doc.go` + `service.go` + `handler.go` + `sql.go` + tests, in that order. `[P1]`
- **RF1.7.2** Read `docs/c_c_naming_conventions.md` once and predict every future name. `[P1]`
- **RF1.7.3** Run `go run ./cmd/migrate -dry-run` against each DB and see zero pending migrations. `[P1]`
- **RF1.7.4** Run `npm run api:check && npm test && go test ./...` and see zero failures. `[P1]`
- **RF1.7.5** Open `docs/c_c_db_routing.md` and find every service mapped to its DB and tables — and trust that it matches the code. `[P1]`

---

## FLOW1. Flow-State Kind & Pull-Eligibility Model

Establishes the canonical 6-kind flow primitive plus an `is_pullable` flag on `flow_states`. Pill name and kind align in the seed (Backlog/To Do/Doing/Completed/Accepted) so the lifecycle vocabulary is self-evident. Two orthogonal axes: `kind` answers "where in the lifecycle?" (`backlog | todo | in_progress | done | accepted | cancelled`); `is_pullable` answers "can the team take this from this state right now?". Compliance-gated teams use multiple `kind='todo'` pills (e.g. To Do → In Review → Approved) where only the final pill carries `is_pullable=true`. Standard agile teams keep the seed default — `Backlog` is PO shaping (validation relaxed); `To Do` is the single pullable state. Per-artefact PO-readiness is explicitly a future concern, not bundled here. `[P1]` 🔵 IN FLIGHT

### FLOW1.1 Schema — kind widening + is_pullable flag

- ✅ **FLOW1.1.1** ~~Widen `flow_states.kind` CHECK constraint to `('backlog','todo','in_progress','done','accepted','cancelled')` — adds `backlog` as 6th primitive~~ `[P1]`
> Commit `a2379df` (2026-05-10): feat(FLOW1): kind widening + is_pullable + repair DE/US flows [FLOW1.1.1] [FLOW1.1.2] [FLOW1.1.3] [FLOW1.1.4]
- ✅ **FLOW1.1.2** ~~Add `flow_states.is_pullable BOOLEAN NOT NULL DEFAULT FALSE` — opt-in per pill; default false so new pills are non-pullable until consciously marked~~ `[P1]`
> Commit `a2379df` (2026-05-10): feat(FLOW1): kind widening + is_pullable + repair DE/US flows [FLOW1.1.1] [FLOW1.1.2] [FLOW1.1.3] [FLOW1.1.4]
> Commit `aede1dd` (2026-05-18): fix(login): shift welcome column up 100px
> Commit `a709b37` (2026-05-18): fix(login): shift welcome column up another 100px (total 200px)
> Commit `29b394d` (2026-05-18): feat(login): redesign with horizontal two-column layout
> Commit `4851c50` (2026-05-18): feat(login): add black logo column on left (200px)
> Commit `fa5bd5b` (2026-05-18): fix(login): move vertical Vector into left white column, beige sidebar to center
- ✅ **FLOW1.1.3** ~~Migration `042_seed_kind_aligned_flow_pills.sql` — re-seed default flows with name/kind alignment (Ready → To Do rename in place); set `is_pullable=true` on To Do pill across all default flows; idempotent on re-run~~ `[P1]`
> Commit `a2379df` (2026-05-10): feat(FLOW1): kind widening + is_pullable + repair DE/US flows [FLOW1.1.1] [FLOW1.1.2] [FLOW1.1.3] [FLOW1.1.4]
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
> Commit `c9764a6` (2026-05-12): feat(PLA-0044): UserNodeAssignment picker — gadmin checkbox tree [FE-POR-0003.9.10]
> Commit `376cfef` (2026-05-13): refactor(PLA-0044): nav-primary-rail-1 — fix 6 CSS naming violations [FE-UI-0001]
> Commit `b4627dd` (2026-05-14): docs(PLA-0048 / RF1.4.4): file TD-NAME-001 for deferred column-prefix sweeps [RF1.4.4]
> Commit `b343d51` (2026-05-16): feat(NavigationPie): full-circle pie filter primitive + dev showcase
> Commit `817922b` (2026-05-16): docs: file TD-FILTER-MULTI + URL-state purge backlog item
> Commit `c9c78c5` (2026-05-16): chore(claude): add /migration skill — DB schema scaffolder
> Commit `c630ee7` (2026-05-16): chore(plans): merge orphan ACs + sync 00595/00597 done flags
> Commit `6bbaa70` (2026-05-16): chore(plans): stamp dates + flip backlog/AC status for PLA-0053/0054/0055
> Commit `9c45ef2` (2026-05-17): chore(tech-debt): triage 2026-05-17 — mark 3 resolved, flag DB-002 trigger
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `5ccef56` (2026-05-18): feat(migration): users_reauth_nonces table for step-up reauth [B16.8.10]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
- ✅ **FLOW1.1.4** ~~Fold DE-Default + US-Default corruption repair into 042 — delete junk pills (TEST PILL, Lego, fwerrt, etc.); reset canonical pills to seed values in place (preserves artefact FK refs)~~ `[P1]`
> Commit `a2379df` (2026-05-10): feat(FLOW1): kind widening + is_pullable + repair DE/US flows [FLOW1.1.1] [FLOW1.1.2] [FLOW1.1.3] [FLOW1.1.4]
> Commit `743b077` (2026-05-10): feat(roles): drop MVP single-admin workspace constraint
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `a8c32ec` (2026-05-14): docs(PLA-0048 / RF1.0): lock hierarchical table + column-prefix naming rules
> Commit `4e1e171` (2026-05-14): docs(PLA-0048 / RF1.6): documentation pass — regenerate docs to post-rename truth [RF1.6]
> Commit `d00e3d1` (2026-05-14): chore(PLA-0048 / RF1.4.4): ship lint:column-prefix-convention (warn-only) [RF1.4.4]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `7773c95` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_sessions (§2.3) [RF1.4.4.users_sessions]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `3f4009c` (2026-05-16): test(chip): red — F6 Status context + rename invariance [00606]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `72f2430` (2026-05-16): feat(tree): per-row cog menu in dense tree (edit/duplicate/move/split/delete)
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
- ✅ **FLOW1.1.5** ~~Backfill `is_pullable` on Defect QA flow + strategy-type default flows (BC/BE/PO/SO) — apply same convention (single pullable pill at the team-handoff point)~~ `[P2]`
> 042 set is_pullable=TRUE on every default flow's pullable pill (10 total: each default's "To Do" + DE QA's "Open"); verified via post-migration check 2026-05-10.
> Commit `a7ce180` (2026-05-10): feat(FLOW1.1): work-flow corrections + field library label dedupe [FLOW1.1.5]
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `098ccbb` (2026-05-12): feat(PLA-0044): layoutWithDagre delegates visibility walk to walkTopology [FE-POR-API-0006]
> Commit `6857913` (2026-05-12): feat(PLA-0044): TopologyTreeFlyout rows come from walkTopology [FE-POR-API-0006]
> Commit `c9764a6` (2026-05-12): feat(PLA-0044): UserNodeAssignment picker — gadmin checkbox tree [FE-POR-0003.9.10]
> Commit `816fbf7` (2026-05-12): chore: mcp whisper stdio type + theme slot-name sanitisation
> Commit `fea4fc9` (2026-05-12): feat(PLA-0043): chrome rework — typecase.css, viewport-anchored title, breadcrumbs [FE-POR-0003.1]
> Commit `9c29056` (2026-05-13): feat(001_redesign): Layout 04 shell — icon rail + section flyout at /redesign
> Commit `01347cf` (2026-05-13): feat(001_redesign): swap (user) layout to redesign shell — rail + flyout live site-wide
> Commit `f515b71` (2026-05-13): fix(001_redesign): rail click + bottom util visibility [FE-POR-0003.1]
> Commit `db60132` (2026-05-13): fix(001_redesign): pin rail + flyout to viewport [FE-POR-0003.1]
> Commit `0bf13ed` (2026-05-13): feat(001_redesign): bounce-in animation for rail active indicator [FE-POR-0003.1]
> Commit `fee4481` (2026-05-13): feat(001_redesign): slide-down bounce for rail active indicator [FE-POR-0003.1]
> Commit `b5c4831` (2026-05-13): feat(001_redesign): travelling rail indicator — stretch then elastic settle [FE-POR-0003.1]
> Commit `05cead9` (2026-05-13): fix(001_redesign): nav-v2 route corrections + travel indicator anchor [FE-POR-0003.1]
> Commit `3790542` (2026-05-13): feat(PLA-0043): persist mixed tag+group bucket order per nav profile [FE-POR-0003.1]
> Commit `8825bab` (2026-05-13): feat(PLA-0043): add Workspace Admin / User Management / Vector Admin nav entries [FE-POR-0003.1]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `4d4ec2a` (2026-05-13): feat(PLA-0043): add Vector Admin sub-pages + User Management permissions page [FE-POR-0003.1]
> Commit `3b1a9d6` (2026-05-13): fix(PLA-0043): sort catalogue items by tag_enum before save to satisfy contiguity rule [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `545ebbd` (2026-05-13): feat(PLA-0043): tag bucket icon overrides in nav preferences [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `495b81c` (2026-05-13): feat(PLA-0043): kill admin_settings tag bucket — all admin pages live in named groups [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `0d330a7` (2026-05-13): feat(PLA-0043): dev pages as 2nd-rail nav — remove tab strip, register 13 pages in shell catalogue [FE-POR-0003.1]
> Commit `b8d1e66` (2026-05-13): fix(PLA-0043): dev_tools nav — auto-pin pages, Research first, remove hardcoded gear link [FE-POR-0003.1]
> Commit `e8046c4` (2026-05-13): fix(PLA-0043): restore dev gear icon in rail util tray [FE-POR-0003.1]
> Commit `0941095` (2026-05-13): feat(PLA-0043): rail icon click navigates to first page of section [FE-POR-0003.1]
> Commit `5e06f7d` (2026-05-13): style: remove border from .panel — borderless card surface [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `a743bb3` (2026-05-13): chore(PLA-0023): drop dead defects table from mmff_vector [P0'/P1]
> Commit `a743bb3` (2026-05-13): chore(PLA-0023): drop dead defects table from mmff_vector [P0'/P1]
> Commit `a743bb3` (2026-05-13): chore(PLA-0023): drop dead defects table from mmff_vector [P0'/P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `82951c5` (2026-05-13): fix(PLA-0023): renumber library_ack drop + drop o_search_index_outbox [P1]
> Commit `82951c5` (2026-05-13): fix(PLA-0023): renumber library_ack drop + drop o_search_index_outbox [P1]
> Commit `49b0909` (2026-05-13): chore(PLA-0023): drop 2 dead-leaf legacy tables, hold user_nav_* [P0']
> Commit `b76ed1c` (2026-05-13): chore(PLA-0023): drop obj_flow_* legacy family from mmff_vector [P0']
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `1cbe497` (2026-05-13): chore(PLA-0023): drop shadow master_record_tenant from mmff_vector [P2]
> Commit `3ff59f0` (2026-05-13): chore(PLA-0023): P5 verification pass — drop 2 dead leaves, map blockers [P5]
> Commit `ed446dd` (2026-05-13): fix(001_redesign): hide admin groups from Available when already in Pinned [FE-POR-0003.1]
> Commit `ed446dd` (2026-05-13): fix(001_redesign): hide admin groups from Available when already in Pinned [FE-POR-0003.1]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `4411327` (2026-05-13): feat(PLA-0026/SA1): remove legacy vectorPool saga writes — VA is now sole write path [FE-POR-0003]
> Commit `1bc9958` (2026-05-13): feat(PLA-0026/SA2): add artefact_adoption_state to vector_artefacts [FE-SQL-0019]
> Commit `a998fc5` (2026-05-13): refactor(PLA-0044): remove legacy AppSidebar_2 component — superseded by redesign two-rail nav
> Commit `8264471` (2026-05-13): refactor(PLA-0044): delete legacy PageHeaderBar + dead page-header CSS [FE-UI-0001]
> Commit `8264471` (2026-05-13): refactor(PLA-0044): delete legacy PageHeaderBar + dead page-header CSS [FE-UI-0001]
> Commit `a8c9c3a` (2026-05-13): refactor(PLA-0044): rename rd-topbar → nav-top-bar — CSS naming convention [FE-UI-0001]
> Commit `a8c9c3a` (2026-05-13): refactor(PLA-0044): rename rd-topbar → nav-top-bar — CSS naming convention [FE-UI-0001]
> Commit `376cfef` (2026-05-13): refactor(PLA-0044): nav-primary-rail-1 — fix 6 CSS naming violations [FE-UI-0001]
> Commit `376cfef` (2026-05-13): refactor(PLA-0044): nav-primary-rail-1 — fix 6 CSS naming violations [FE-UI-0001]
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `4ab58a3` (2026-05-13): chore(PLA-0039): delete empty /samantha/v1 chi block from router [FE-POR-0003]
> Commit `4ab58a3` (2026-05-13): chore(PLA-0039): delete empty /samantha/v1 chi block from router [FE-POR-0003]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `952cc41` (2026-05-13): plan(PLA-0048): codebase recovery — lock conventions, install drift gates, consolidate SQL [RF1]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `4e1e171` (2026-05-14): docs(PLA-0048 / RF1.6): documentation pass — regenerate docs to post-rename truth [RF1.6]
> Commit `d00e3d1` (2026-05-14): chore(PLA-0048 / RF1.4.4): ship lint:column-prefix-convention (warn-only) [RF1.4.4]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7773c95` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_sessions (§2.3) [RF1.4.4.users_sessions]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `a6db775` (2026-05-14): fix(nav): AccountFlyout only shows avatar_menu tag, not rail-1 admin buckets
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `b343d51` (2026-05-16): feat(NavigationPie): full-circle pie filter primitive + dev showcase
> Commit `0bab39c` (2026-05-16): refactor(work-items): chip swap StarburstFilter → NavigationPie + multi-value filter shape
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `90a1c04` (2026-05-16): fix(PageSummaryHeader): suppress help icon on the inner Panel
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `6f51bd0` (2026-05-16): feat(redesign): swap V text brand for /logo-vector.png in primary rail
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `44f56a1` (2026-05-16): chore(claude): post-edit lint hook, dev-env lockdown, postgres MCP wrapper
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `f50f4c3` (2026-05-16): feat(stories): auto-provision tracker groups via rg-runner -create-if-missing
> Commit `f944e5a` (2026-05-16): test(artefacttypes): red — F3 slot substrate [00603]
> Commit `09f9fdb` (2026-05-16): feat(vector_artefacts): green — slot enum substrate on artefacts_types [00582]
> Commit `35ecd8d` (2026-05-16): feat(vector_artefacts): green — backfill artefacts_types_slot per workspace [00583]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `955d421` (2026-05-16): chore(claude): un-gitignore .claude/settings.json — single-user multi-machine sync
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `d60981e` (2026-05-16): fix(plans-panel): query param typo + defensive array guards
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `c630ee7` (2026-05-16): chore(plans): merge orphan ACs + sync 00595/00597 done flags
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `6bbaa70` (2026-05-16): chore(plans): stamp dates + flip backlog/AC status for PLA-0053/0054/0055
> Commit `72f2430` (2026-05-16): feat(tree): per-row cog menu in dense tree (edit/duplicate/move/split/delete)
> Commit `481407b` (2026-05-16): feat(001_redesign): share travel-indicator across both nav rails [FE-POR-0003.1]
> Commit `9e4422d` (2026-05-17): feat(tree): paginationPosition prop on ResourceTree (both|bottom) [B21]
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `9c45ef2` (2026-05-17): chore(tech-debt): triage 2026-05-17 — mark 3 resolved, flag DB-002 trigger
> Commit `e41ed3c` (2026-05-17): fix(errorsreport): correct wire-shape assertion in TestReport_UnknownCode (TD-ERRORSREPORT-WIRE-SHAPE)
> Commit `36a15a6` (2026-05-17): feat(page-summary): add danger tone to SummaryCellTone (TD-SUMMARY-TONE)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `28a4c8e` (2026-05-18): fix(login): remove duplicate logo from beige panel
> Commit `fa5bd5b` (2026-05-18): fix(login): move vertical Vector into left white column, beige sidebar to center
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
> Commit `c40d494` (2026-05-18): fix(realtime): gate ServeWS conn.Close so first frame wins [B16.8.12]
> Commit `d6c660e` (2026-05-18): docs(claude): add swarm stack pointer to working-practices index
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]

> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
### FLOW1.2 Backend — service surface
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
> Commit `96b7f25` (2026-05-12): docs(research): R052 Rally scope mechanics + R053 Rally/Jira/ADO comparison; backfill PLA-0042.md
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `cc38e98` (2026-05-12): docs(PLA-0043): handover for cross-machine continuation [FE-POR-API-0002]
> Commit `3963bbb` (2026-05-12): feat(PLA-0043): scope rail polish — auto-width, spine elbows, vector scrollbar [FE-POR-0003.1]
> Commit `32002b3` (2026-05-12): docs(R054): Rally user-to-project assignment UX research
> Commit `6d568c0` (2026-05-12): docs(PLA-0044,PLA-0045): plan JSONs for /dev Plans tab + story-index bump to 00549 [FE-DEV-0025]
> Commit `6d568c0` (2026-05-12): docs(PLA-0044,PLA-0045): plan JSONs for /dev Plans tab + story-index bump to 00549 [FE-DEV-0025]
> Commit `bb18aa4` (2026-05-12): feat(PLA-0044): walkTopology Go mirror + cross-runtime parity tests [FE-POR-API-0006]
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `eaf4feb` (2026-05-12): feat(PLA-0044): useTopologyTreeState sources childrenOf from walkTopology [FE-POR-API-0006]
> Commit `ea4862c` (2026-05-12): fix(PLA-0044): ScopeRail uses walkTopology + byPosition — kills phantom-D orphan re-root [FE-POR-API-0006]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `0a2ee86` (2026-05-12): docs(PLA-0044): close out plan — catalogue row + index + plan JSON [FE-DEV-0025]
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]

- ✅ **FLOW1.2.1** ~~Add `'backlog'` to `validKinds` map in `backend/internal/flows/service.go`~~ `[P1]`
> Commit `d3d47f4` (2026-05-10): feat(FLOW1.2): backlog kind + is_pullable wired through flows service [FLOW1.2.1] [FLOW1.2.2] [FLOW1.2.3]
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
> Commit `1e010e2` (2026-05-12): chore(scope): Vector_Scope progress sweep + PLA-0022 date bump + R051 research entry
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `96b7f25` (2026-05-12): docs(research): R052 Rally scope mechanics + R053 Rally/Jira/ADO comparison; backfill PLA-0042.md
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `bb18aa4` (2026-05-12): feat(PLA-0044): walkTopology Go mirror + cross-runtime parity tests [FE-POR-API-0006]
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `3790542` (2026-05-13): feat(PLA-0043): persist mixed tag+group bucket order per nav profile [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `545ebbd` (2026-05-13): feat(PLA-0043): tag bucket icon overrides in nav preferences [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `3ff59f0` (2026-05-13): chore(PLA-0023): P5 verification pass — drop 2 dead leaves, map blockers [P5]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `4411327` (2026-05-13): feat(PLA-0026/SA1): remove legacy vectorPool saga writes — VA is now sole write path [FE-POR-0003]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `4ab58a3` (2026-05-13): chore(PLA-0039): delete empty /samantha/v1 chi block from router [FE-POR-0003]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7773c95` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_sessions (§2.3) [RF1.4.4.users_sessions]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `5b7fac9` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `817922b` (2026-05-16): docs: file TD-FILTER-MULTI + URL-state purge backlog item
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `f944e5a` (2026-05-16): test(artefacttypes): red — F3 slot substrate [00603]
> Commit `454004c` (2026-05-16): test(artefactitems): red — F4 UUID wire end-to-end [00604]
> Commit `09f9fdb` (2026-05-16): feat(vector_artefacts): green — slot enum substrate on artefacts_types [00582]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `146430c` (2026-05-16): test(priority): red — F7 substrate [00607]
> Commit `cb77d87` (2026-05-16): test(priority): red — F8 CRUD + UUID wire [00608]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `5eba458` (2026-05-16): fix(test): bulk set_priority payload uses priority_id UUID [00595,00597 fixup]
> Commit `206b5e2` (2026-05-16): docs(tech-debt): file 6 TD entries from backend test-failure inventory
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `6bbaa70` (2026-05-16): chore(plans): stamp dates + flip backlog/AC status for PLA-0053/0054/0055
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `e41ed3c` (2026-05-17): fix(errorsreport): correct wire-shape assertion in TestReport_UnknownCode (TD-ERRORSREPORT-WIRE-SHAPE)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `7839d3d` (2026-05-18): feat(auth): stamp + validate JWT iss/aud claims [B16.8.8]
> Commit `d32ebd9` (2026-05-18): test(realtime): failing WS-revoke integration + registry unit tests [B16.8.12]
> Commit `47c2ca8` (2026-05-18): feat(realtime): WS session registry [B16.8.12]
> Commit `55a679d` (2026-05-18): feat(realtime): WS session sweeper + immediate-close [B16.8.12]
> Commit `c5d96ba` (2026-05-18): feat(auth/realtime): plumb sid into WS via context + Hub.CloseSession [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `c40d494` (2026-05-18): fix(realtime): gate ServeWS conn.Close so first frame wins [B16.8.12]
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
- ✅ **FLOW1.2.2** ~~Extend `PatchStateInput` + `CreateStateInput` to accept optional `is_pullable bool` — UPDATE/INSERT propagates the flag~~ `[P1]`
> Commit `d3d47f4` (2026-05-10): feat(FLOW1.2): backlog kind + is_pullable wired through flows service [FLOW1.2.1] [FLOW1.2.2] [FLOW1.2.3]
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
- ✅ **FLOW1.2.3** ~~`listByScope` query selects `fs.is_pullable` and surfaces it in the `FlowState` DTO~~ `[P1]`
> Commit `d3d47f4` (2026-05-10): feat(FLOW1.2): backlog kind + is_pullable wired through flows service [FLOW1.2.1] [FLOW1.2.2] [FLOW1.2.3]
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `f944e5a` (2026-05-16): test(artefacttypes): red — F3 slot substrate [00603]
> Commit `d60981e` (2026-05-16): fix(plans-panel): query param typo + defensive array guards
- **FLOW1.2.4** Pull-surface query helper — canonical filter `is_pullable=true OR kind IN ('in_progress','done','accepted')` for team boards `[P2]`
- **FLOW1.2.5** PO-backlog query helper — `kind='backlog' OR (kind='todo' AND is_pullable=false)` for PO grooming views `[P2]`
> Last checked: 2026-05-10 — service.go validKinds includes "backlog"; types.go FlowState/PatchStateInput/CreateStateInput carry IsPullable; listByScope SELECT + scan + PatchFlowState UPDATE/RETURNING + CreateState INSERT/RETURNING all wire fs.is_pullable through. `go build ./internal/flows/... ./cmd/server/...` clean.
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `cc38e98` (2026-05-12): docs(PLA-0043): handover for cross-machine continuation [FE-POR-API-0002]
> Commit `3963bbb` (2026-05-12): feat(PLA-0043): scope rail polish — auto-width, spine elbows, vector scrollbar [FE-POR-0003.1]
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `bb18aa4` (2026-05-12): feat(PLA-0044): walkTopology Go mirror + cross-runtime parity tests [FE-POR-API-0006]
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `098ccbb` (2026-05-12): feat(PLA-0044): layoutWithDagre delegates visibility walk to walkTopology [FE-POR-API-0006]
> Commit `eaf4feb` (2026-05-12): feat(PLA-0044): useTopologyTreeState sources childrenOf from walkTopology [FE-POR-API-0006]
> Commit `6857913` (2026-05-12): feat(PLA-0044): TopologyTreeFlyout rows come from walkTopology [FE-POR-API-0006]
> Commit `ea4862c` (2026-05-12): fix(PLA-0044): ScopeRail uses walkTopology + byPosition — kills phantom-D orphan re-root [FE-POR-API-0006]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `c9764a6` (2026-05-12): feat(PLA-0044): UserNodeAssignment picker — gadmin checkbox tree [FE-POR-0003.9.10]
> Commit `fea4fc9` (2026-05-12): feat(PLA-0043): chrome rework — typecase.css, viewport-anchored title, breadcrumbs [FE-POR-0003.1]
> Commit `9c29056` (2026-05-13): feat(001_redesign): Layout 04 shell — icon rail + section flyout at /redesign
> Commit `01347cf` (2026-05-13): feat(001_redesign): swap (user) layout to redesign shell — rail + flyout live site-wide
> Commit `01347cf` (2026-05-13): feat(001_redesign): swap (user) layout to redesign shell — rail + flyout live site-wide
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `f515b71` (2026-05-13): fix(001_redesign): rail click + bottom util visibility [FE-POR-0003.1]
> Commit `db60132` (2026-05-13): fix(001_redesign): pin rail + flyout to viewport [FE-POR-0003.1]
> Commit `0bf13ed` (2026-05-13): feat(001_redesign): bounce-in animation for rail active indicator [FE-POR-0003.1]
> Commit `fee4481` (2026-05-13): feat(001_redesign): slide-down bounce for rail active indicator [FE-POR-0003.1]
> Commit `b5c4831` (2026-05-13): feat(001_redesign): travelling rail indicator — stretch then elastic settle [FE-POR-0003.1]
> Commit `05cead9` (2026-05-13): fix(001_redesign): nav-v2 route corrections + travel indicator anchor [FE-POR-0003.1]
> Commit `3790542` (2026-05-13): feat(PLA-0043): persist mixed tag+group bucket order per nav profile [FE-POR-0003.1]
> Commit `8825bab` (2026-05-13): feat(PLA-0043): add Workspace Admin / User Management / Vector Admin nav entries [FE-POR-0003.1]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `4d4ec2a` (2026-05-13): feat(PLA-0043): add Vector Admin sub-pages + User Management permissions page [FE-POR-0003.1]
> Commit `3b1a9d6` (2026-05-13): fix(PLA-0043): sort catalogue items by tag_enum before save to satisfy contiguity rule [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `545ebbd` (2026-05-13): feat(PLA-0043): tag bucket icon overrides in nav preferences [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `495b81c` (2026-05-13): feat(PLA-0043): kill admin_settings tag bucket — all admin pages live in named groups [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `0d330a7` (2026-05-13): feat(PLA-0043): dev pages as 2nd-rail nav — remove tab strip, register 13 pages in shell catalogue [FE-POR-0003.1]
> Commit `b8d1e66` (2026-05-13): fix(PLA-0043): dev_tools nav — auto-pin pages, Research first, remove hardcoded gear link [FE-POR-0003.1]
> Commit `e8046c4` (2026-05-13): fix(PLA-0043): restore dev gear icon in rail util tray [FE-POR-0003.1]
> Commit `0941095` (2026-05-13): feat(PLA-0043): rail icon click navigates to first page of section [FE-POR-0003.1]
> Commit `5e06f7d` (2026-05-13): style: remove border from .panel — borderless card surface [FE-POR-0003.1]
> Commit `5e06f7d` (2026-05-13): style: remove border from .panel — borderless card surface [FE-POR-0003.1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `ed446dd` (2026-05-13): fix(001_redesign): hide admin groups from Available when already in Pinned [FE-POR-0003.1]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `4411327` (2026-05-13): feat(PLA-0026/SA1): remove legacy vectorPool saga writes — VA is now sole write path [FE-POR-0003]
> Commit `a998fc5` (2026-05-13): refactor(PLA-0044): remove legacy AppSidebar_2 component — superseded by redesign two-rail nav
> Commit `8264471` (2026-05-13): refactor(PLA-0044): delete legacy PageHeaderBar + dead page-header CSS [FE-UI-0001]
> Commit `a8c9c3a` (2026-05-13): refactor(PLA-0044): rename rd-topbar → nav-top-bar — CSS naming convention [FE-UI-0001]
> Commit `376cfef` (2026-05-13): refactor(PLA-0044): nav-primary-rail-1 — fix 6 CSS naming violations [FE-UI-0001]
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `4ab58a3` (2026-05-13): chore(PLA-0039): delete empty /samantha/v1 chi block from router [FE-POR-0003]
> Commit `71f127e` (2026-05-13): feat: dev/scripts/pace.sh — commit-mix + TD-register scoreboard
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `4e1e171` (2026-05-14): docs(PLA-0048 / RF1.6): documentation pass — regenerate docs to post-rename truth [RF1.6]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `a6db775` (2026-05-14): fix(nav): AccountFlyout only shows avatar_menu tag, not rail-1 admin buckets
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `b343d51` (2026-05-16): feat(NavigationPie): full-circle pie filter primitive + dev showcase
> Commit `b343d51` (2026-05-16): feat(NavigationPie): full-circle pie filter primitive + dev showcase
> Commit `0bab39c` (2026-05-16): refactor(work-items): chip swap StarburstFilter → NavigationPie + multi-value filter shape
> Commit `0bab39c` (2026-05-16): refactor(work-items): chip swap StarburstFilter → NavigationPie + multi-value filter shape
> Commit `817922b` (2026-05-16): docs: file TD-FILTER-MULTI + URL-state purge backlog item
> Commit `817922b` (2026-05-16): docs: file TD-FILTER-MULTI + URL-state purge backlog item
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `90a1c04` (2026-05-16): fix(PageSummaryHeader): suppress help icon on the inner Panel
> Commit `6f51bd0` (2026-05-16): feat(redesign): swap V text brand for /logo-vector.png in primary rail
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `44f56a1` (2026-05-16): chore(claude): post-edit lint hook, dev-env lockdown, postgres MCP wrapper
> Commit `454004c` (2026-05-16): test(artefactitems): red — F4 UUID wire end-to-end [00604]
> Commit `454004c` (2026-05-16): test(artefactitems): red — F4 UUID wire end-to-end [00604]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `d60981e` (2026-05-16): fix(plans-panel): query param typo + defensive array guards
> Commit `d60981e` (2026-05-16): fix(plans-panel): query param typo + defensive array guards
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `6bbaa70` (2026-05-16): chore(plans): stamp dates + flip backlog/AC status for PLA-0053/0054/0055
> Commit `72f2430` (2026-05-16): feat(tree): per-row cog menu in dense tree (edit/duplicate/move/split/delete)
> Commit `481407b` (2026-05-16): feat(001_redesign): share travel-indicator across both nav rails [FE-POR-0003.1]
> Commit `9e4422d` (2026-05-17): feat(tree): paginationPosition prop on ResourceTree (both|bottom) [B21]
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `e41ed3c` (2026-05-17): fix(errorsreport): correct wire-shape assertion in TestReport_UnknownCode (TD-ERRORSREPORT-WIRE-SHAPE)
> Commit `36a15a6` (2026-05-17): feat(page-summary): add danger tone to SummaryCellTone (TD-SUMMARY-TONE)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
> Commit `d6c660e` (2026-05-18): docs(claude): add swarm stack pointer to working-practices index
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]

> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
### FLOW1.3 Frontend — customisation page + KIND_LABEL
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules

- ✅ **FLOW1.3.1** ~~Add `backlog → "Backlog"` to `KIND_LABEL` map; flow-map's left master-state column adds 6th row~~ `[P1]`
> Commit `9b758ee` (2026-05-10): feat(FLOW1.3): backlog kind label + is_pullable toggle column [FLOW1.3.1] [FLOW1.3.2]
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `a8c32ec` (2026-05-14): docs(PLA-0048 / RF1.0): lock hierarchical table + column-prefix naming rules
> Commit `b4627dd` (2026-05-14): docs(PLA-0048 / RF1.4.4): file TD-NAME-001 for deferred column-prefix sweeps [RF1.4.4]
> Commit `d00e3d1` (2026-05-14): chore(PLA-0048 / RF1.4.4): ship lint:column-prefix-convention (warn-only) [RF1.4.4]
> Commit `7773c95` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_sessions (§2.3) [RF1.4.4.users_sessions]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `817922b` (2026-05-16): docs: file TD-FILTER-MULTI + URL-state purge backlog item
> Commit `6bbaa70` (2026-05-16): chore(plans): stamp dates + flip backlog/AC status for PLA-0053/0054/0055
> Commit `31feaed` (2026-05-18): feat(login): complete redesign — welcome (left) + form (right) layout
> Commit `aede1dd` (2026-05-18): fix(login): shift welcome column up 100px
> Commit `a709b37` (2026-05-18): fix(login): shift welcome column up another 100px (total 200px)
> Commit `29b394d` (2026-05-18): feat(login): redesign with horizontal two-column layout
> Commit `4851c50` (2026-05-18): feat(login): add black logo column on left (200px)
> Commit `fa5bd5b` (2026-05-18): fix(login): move vertical Vector into left white column, beige sidebar to center
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
- ✅ **FLOW1.3.2** ~~`is_pullable` toggle on each pill row in the flow-states settings page — PO sets per-pill, persists via `flowStatesApi.patchState`~~ `[P2]`
> Commit `9b758ee` (2026-05-10): feat(FLOW1.3): backlog kind label + is_pullable toggle column [FLOW1.3.1] [FLOW1.3.2]
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `495b81c` (2026-05-13): feat(PLA-0043): kill admin_settings tag bucket — all admin pages live in named groups [FE-POR-0003.1]
> Commit `376cfef` (2026-05-13): refactor(PLA-0044): nav-primary-rail-1 — fix 6 CSS naming violations [FE-UI-0001]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `d28b2f5` (2026-05-14): refactor(nav): final bucket reshape per Rick's locked spec (mig 192)
> Commit `955d421` (2026-05-16): chore(claude): un-gitignore .claude/settings.json — single-user multi-machine sync
> Commit `72f2430` (2026-05-16): feat(tree): per-row cog menu in dense tree (edit/duplicate/move/split/delete)
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
- **FLOW1.3.3** Visual treatment: pullable pill carries a subtle "team can pull" indicator (icon, accent border) — distinct from any future PO-readiness badge `[P2]`
> Commit `1ede082` (2026-05-10): feat(FLOW1.3): vertical 3-col flow-map grid + dedicated drop slots [FLOW1.3.3]
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `1cb8b7d` (2026-05-11): refactor: tenant-aware subtitle on Vector Admin tab
> Commit `6857913` (2026-05-12): feat(PLA-0044): TopologyTreeFlyout rows come from walkTopology [FE-POR-API-0006]
> Commit `fea4fc9` (2026-05-12): feat(PLA-0043): chrome rework — typecase.css, viewport-anchored title, breadcrumbs [FE-POR-0003.1]
> Commit `9c29056` (2026-05-13): feat(001_redesign): Layout 04 shell — icon rail + section flyout at /redesign
> Commit `01347cf` (2026-05-13): feat(001_redesign): swap (user) layout to redesign shell — rail + flyout live site-wide
> Commit `0bf13ed` (2026-05-13): feat(001_redesign): bounce-in animation for rail active indicator [FE-POR-0003.1]
> Commit `fee4481` (2026-05-13): feat(001_redesign): slide-down bounce for rail active indicator [FE-POR-0003.1]
> Commit `b5c4831` (2026-05-13): feat(001_redesign): travelling rail indicator — stretch then elastic settle [FE-POR-0003.1]
> Commit `05cead9` (2026-05-13): fix(001_redesign): nav-v2 route corrections + travel indicator anchor [FE-POR-0003.1]
> Commit `545ebbd` (2026-05-13): feat(PLA-0043): tag bucket icon overrides in nav preferences [FE-POR-0003.1]
> Commit `b8d1e66` (2026-05-13): fix(PLA-0043): dev_tools nav — auto-pin pages, Research first, remove hardcoded gear link [FE-POR-0003.1]
> Commit `e8046c4` (2026-05-13): fix(PLA-0043): restore dev gear icon in rail util tray [FE-POR-0003.1]
> Commit `0941095` (2026-05-13): feat(PLA-0043): rail icon click navigates to first page of section [FE-POR-0003.1]
> Commit `5e06f7d` (2026-05-13): style: remove border from .panel — borderless card surface [FE-POR-0003.1]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `90a1c04` (2026-05-16): fix(PageSummaryHeader): suppress help icon on the inner Panel
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `481407b` (2026-05-16): feat(001_redesign): share travel-indicator across both nav rails [FE-POR-0003.1]
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
- **FLOW1.3.4** Flow-map shows the implicit Backlog-zone boundary visually (left edge of pullable pill = "team handoff line") `[P3]`
> Last checked: 2026-05-10 — KIND_LABEL/KIND_STROKE include backlog (slate-300 stroke); inferKind ORDER+KEY widened to 6 kinds; FlowState DTO + flowStatesApi + apiSite registry carry is_pullable; new "Pullable" checkbox column in StateRow PATCHes `{ is_pullable }`. tsc clean for touched files.
> Commit `8ada5e5` (2026-05-11): refactor: nest Organisation & Work Items under Vector Admin tab
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `0a2ee86` (2026-05-12): docs(PLA-0044): close out plan — catalogue row + index + plan JSON [FE-DEV-0025]
> Commit `fea4fc9` (2026-05-12): feat(PLA-0043): chrome rework — typecase.css, viewport-anchored title, breadcrumbs [FE-POR-0003.1]
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `e367266` (2026-05-15): docs: handover — table catalog restyle + permissions tree-lines session
> Commit `817922b` (2026-05-16): docs: file TD-FILTER-MULTI + URL-state purge backlog item
> Commit `6bbaa70` (2026-05-16): chore(plans): stamp dates + flip backlog/AC status for PLA-0053/0054/0055
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]

> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
### FLOW1.5 Reset to factory-default per artefact type

> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
- **FLOW1.5.1** Snapshot tables in `vector_artefacts` (`flow_defaults`, `flow_state_defaults`, `flow_transition_defaults`) baked at seed time; idempotent rebuild from current live default flows `[P1]` ✅
> Commit `4c21968` (2026-05-10): fix(FLOW1.5): canonical hardcoded snapshot — decouple from polluted live [FLOW1.5.1]
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
- **FLOW1.5.2** Backend Reset service — `loadResetData` + `pickSuccessor` walk-back helper + `PreviewReset` (diff only) + `ApplyReset` (single-tx rebind→archive→update→insert→rewrite-edges); routes `POST /_site/flows/reset/{preview,apply}` `[P1]`
> Commit `cf03ad2` (2026-05-10): feat(FLOW1.5): backend reset preview/apply with walk-back rebind [FLOW1.5.2]
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
- **FLOW1.5.3** Frontend Reset button on `TypeSection` heading + inline preview banner showing pill/transition deltas + artefact-rebind impact counts; user confirmation before Apply `[P1]`
> Commit `1bf8f1c` (2026-05-10): feat(FLOW1.5): TypeSection Reset button + inline preview banner [FLOW1.5.3]
> Commit `63c9331` (2026-05-10): fix(FLOW1.5): empty-slice ResetPreview so JSON emits [] not null [FLOW1.5.3]
> Commit `ca9bbe4` (2026-05-10): fix(FLOW1.5): remount TypeSection on reload so map drops stale pills [FLOW1.5.3]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `49b0909` (2026-05-13): chore(PLA-0023): drop 2 dead-leaf legacy tables, hold user_nav_* [P0']
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element

> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
### FLOW1.4 Future — explicitly out of scope here
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks

> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
- **FLOW1.4.1** Per-artefact `po_ready` flag on `artefacts` table — visual aid for PO grooming, independent of flow state; sort-to-top/badge UI; optional DoR validation on toggle `[P3]`
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `3b1a9d6` (2026-05-13): fix(PLA-0043): sort catalogue items by tag_enum before save to satisfy contiguity rule [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `09f9fdb` (2026-05-16): feat(vector_artefacts): green — slot enum substrate on artefacts_types [00582]
> Commit `35ecd8d` (2026-05-16): feat(vector_artefacts): green — backfill artefacts_types_slot per workspace [00583]
> Commit `c630ee7` (2026-05-16): chore(plans): merge orphan ACs + sync 00595/00597 done flags
> Commit `9c45ef2` (2026-05-17): chore(tech-debt): triage 2026-05-17 — mark 3 resolved, flag DB-002 trigger
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element

> Last checked: 2026-05-10
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props

> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `1bc9958` (2026-05-13): feat(PLA-0026/SA2): add artefact_adoption_state to vector_artefacts [FE-SQL-0019]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
---
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]

> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
## F1. Artefact Type and Flow State Customisation
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]

> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
Workspace Settings > Customisation page — two sections. Section 1 (artefact type tags, prefix, name, description, colour) is already built. Section 2 adds a third-level tab nav (mirroring Custom Fields) for flow state management: one tab per artefact type, showing that type's flow states with colour editing. Covers data-correction migrations to fix wrong seeded states for all work types and missing states for strategy types. `[P2]` 🔵 IN FLIGHT

> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
### F1.1 Data Migrations — correct seeded flow states

- ✅ **F1.1.1** ~~Migrate Task flow states to: Ready (todo), Doing (in_progress), Completed (done) — remove Cancelled~~ `[P1]`
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
> Commit `b76ed1c` (2026-05-13): chore(PLA-0023): drop obj_flow_* legacy family from mmff_vector [P0']
> Commit `1cbe497` (2026-05-13): chore(PLA-0023): drop shadow master_record_tenant from mmff_vector [P2]
> Commit `3ff59f0` (2026-05-13): chore(PLA-0023): P5 verification pass — drop 2 dead leaves, map blockers [P5]
> Commit `ed446dd` (2026-05-13): fix(001_redesign): hide admin groups from Available when already in Pinned [FE-POR-0003.1]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `c9c78c5` (2026-05-16): chore(claude): add /migration skill — DB schema scaffolder
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `5ccef56` (2026-05-18): feat(migration): users_reauth_nonces table for step-up reauth [B16.8.10]
- ✅ **F1.1.2** ~~Migrate Story flow states to: Backlog (todo), Ready (todo), Doing (in_progress), Completed (done), Accepted (done) — remove To Do, In Progress, Done, Cancelled~~ `[P1]`
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `a743bb3` (2026-05-13): chore(PLA-0023): drop dead defects table from mmff_vector [P0'/P1]
> Commit `a743bb3` (2026-05-13): chore(PLA-0023): drop dead defects table from mmff_vector [P0'/P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `82951c5` (2026-05-13): fix(PLA-0023): renumber library_ack drop + drop o_search_index_outbox [P1]
> Commit `82951c5` (2026-05-13): fix(PLA-0023): renumber library_ack drop + drop o_search_index_outbox [P1]
> Commit `49b0909` (2026-05-13): chore(PLA-0023): drop 2 dead-leaf legacy tables, hold user_nav_* [P0']
> Commit `49b0909` (2026-05-13): chore(PLA-0023): drop 2 dead-leaf legacy tables, hold user_nav_* [P0']
> Commit `b76ed1c` (2026-05-13): chore(PLA-0023): drop obj_flow_* legacy family from mmff_vector [P0']
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `1cbe497` (2026-05-13): chore(PLA-0023): drop shadow master_record_tenant from mmff_vector [P2]
> Commit `3ff59f0` (2026-05-13): chore(PLA-0023): P5 verification pass — drop 2 dead leaves, map blockers [P5]
> Commit `ed446dd` (2026-05-13): fix(001_redesign): hide admin groups from Available when already in Pinned [FE-POR-0003.1]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `817922b` (2026-05-16): docs: file TD-FILTER-MULTI + URL-state purge backlog item
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `c9c78c5` (2026-05-16): chore(claude): add /migration skill — DB schema scaffolder
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `6bbaa70` (2026-05-16): chore(plans): stamp dates + flip backlog/AC status for PLA-0053/0054/0055
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `5ccef56` (2026-05-18): feat(migration): users_reauth_nonces table for step-up reauth [B16.8.10]
- ✅ **F1.1.3** ~~Migrate Epic flow states to match Story (same 5-state set)~~ `[P1]`
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `6d568c0` (2026-05-12): docs(PLA-0044,PLA-0045): plan JSONs for /dev Plans tab + story-index bump to 00549 [FE-DEV-0025]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `a743bb3` (2026-05-13): chore(PLA-0023): drop dead defects table from mmff_vector [P0'/P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `82951c5` (2026-05-13): fix(PLA-0023): renumber library_ack drop + drop o_search_index_outbox [P1]
> Commit `49b0909` (2026-05-13): chore(PLA-0023): drop 2 dead-leaf legacy tables, hold user_nav_* [P0']
> Commit `b76ed1c` (2026-05-13): chore(PLA-0023): drop obj_flow_* legacy family from mmff_vector [P0']
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `1cbe497` (2026-05-13): chore(PLA-0023): drop shadow master_record_tenant from mmff_vector [P2]
> Commit `3ff59f0` (2026-05-13): chore(PLA-0023): P5 verification pass — drop 2 dead leaves, map blockers [P5]
> Commit `ed446dd` (2026-05-13): fix(001_redesign): hide admin groups from Available when already in Pinned [FE-POR-0003.1]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `817922b` (2026-05-16): docs: file TD-FILTER-MULTI + URL-state purge backlog item
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `c9c78c5` (2026-05-16): chore(claude): add /migration skill — DB schema scaffolder
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `6bbaa70` (2026-05-16): chore(plans): stamp dates + flip backlog/AC status for PLA-0053/0054/0055
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `5ccef56` (2026-05-18): feat(migration): users_reauth_nonces table for step-up reauth [B16.8.10]
- ✅ **F1.1.4** ~~Migrate Defect work-execution flow states to match Story (same 5-state set)~~ `[P1]`
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `a743bb3` (2026-05-13): chore(PLA-0023): drop dead defects table from mmff_vector [P0'/P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `82951c5` (2026-05-13): fix(PLA-0023): renumber library_ack drop + drop o_search_index_outbox [P1]
> Commit `49b0909` (2026-05-13): chore(PLA-0023): drop 2 dead-leaf legacy tables, hold user_nav_* [P0']
> Commit `b76ed1c` (2026-05-13): chore(PLA-0023): drop obj_flow_* legacy family from mmff_vector [P0']
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `1cbe497` (2026-05-13): chore(PLA-0023): drop shadow master_record_tenant from mmff_vector [P2]
> Commit `3ff59f0` (2026-05-13): chore(PLA-0023): P5 verification pass — drop 2 dead leaves, map blockers [P5]
> Commit `ed446dd` (2026-05-13): fix(001_redesign): hide admin groups from Available when already in Pinned [FE-POR-0003.1]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `817922b` (2026-05-16): docs: file TD-FILTER-MULTI + URL-state purge backlog item
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `c9c78c5` (2026-05-16): chore(claude): add /migration skill — DB schema scaffolder
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `6bbaa70` (2026-05-16): chore(plans): stamp dates + flip backlog/AC status for PLA-0053/0054/0055
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `5ccef56` (2026-05-18): feat(migration): users_reauth_nonces table for step-up reauth [B16.8.10]
- ✅ **F1.1.5** ~~Seed Defect QA/business flow: Submitted (todo), Open (todo), Fixed (in_progress), In Test (in_progress), Not Reproducible (done), Deferred (done) — new second flow on the Defect type~~ `[P1]`
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `a743bb3` (2026-05-13): chore(PLA-0023): drop dead defects table from mmff_vector [P0'/P1]
> Commit `b76ed1c` (2026-05-13): chore(PLA-0023): drop obj_flow_* legacy family from mmff_vector [P0']
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `4411327` (2026-05-13): feat(PLA-0026/SA1): remove legacy vectorPool saga writes — VA is now sole write path [FE-POR-0003]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `5bdf3be` (2026-05-13): docs(PLA-0030): document 5 missing /samantha/v2 routes in openapi-v2.yaml
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `b4627dd` (2026-05-14): docs(PLA-0048 / RF1.4.4): file TD-NAME-001 for deferred column-prefix sweeps [RF1.4.4]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `9ec3523` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `5b7fac9` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `b343d51` (2026-05-16): feat(NavigationPie): full-circle pie filter primitive + dev showcase
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `f50f4c3` (2026-05-16): feat(stories): auto-provision tracker groups via rg-runner -create-if-missing
> Commit `f944e5a` (2026-05-16): test(artefacttypes): red — F3 slot substrate [00603]
> Commit `454004c` (2026-05-16): test(artefactitems): red — F4 UUID wire end-to-end [00604]
> Commit `162d382` (2026-05-16): test(catalogue): red — F5 catalogue + chip + localStorage + sidecar [00605]
> Commit `3f4009c` (2026-05-16): test(chip): red — F6 Status context + rename invariance [00606]
> Commit `09f9fdb` (2026-05-16): feat(vector_artefacts): green — slot enum substrate on artefacts_types [00582]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `146430c` (2026-05-16): test(priority): red — F7 substrate [00607]
> Commit `cb77d87` (2026-05-16): test(priority): red — F8 CRUD + UUID wire [00608]
> Commit `37c9929` (2026-05-16): test(priority): red — F9 catalogue + chip + Showstopper [00609]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `5eba458` (2026-05-16): fix(test): bulk set_priority payload uses priority_id UUID [00595,00597 fixup]
> Commit `206b5e2` (2026-05-16): docs(tech-debt): file 6 TD entries from backend test-failure inventory
> Commit `7ed1728` (2026-05-16): feat(skill): add <tests> shortcut for Tracker red-green test queries
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `e41ed3c` (2026-05-17): fix(errorsreport): correct wire-shape assertion in TestReport_UnknownCode (TD-ERRORSREPORT-WIRE-SHAPE)
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `7839d3d` (2026-05-18): feat(auth): stamp + validate JWT iss/aud claims [B16.8.8]
> Commit `d32ebd9` (2026-05-18): test(realtime): failing WS-revoke integration + registry unit tests [B16.8.12]
> Commit `55a679d` (2026-05-18): feat(realtime): WS session sweeper + immediate-close [B16.8.12]
> Commit `c5d96ba` (2026-05-18): feat(auth/realtime): plumb sid into WS via context + Hub.CloseSession [B16.8.12]
> Commit `c40d494` (2026-05-18): fix(realtime): gate ServeWS conn.Close so first frame wins [B16.8.12]
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
- ✅ **F1.1.6** ~~Seed flow states for BC, BE, PO, SO strategy types (flows exist, 0 states): Backlog (todo), Ready (todo), Doing (in_progress), Completed (done), Accepted (done)~~ `[P1]`
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `cc38e98` (2026-05-12): docs(PLA-0043): handover for cross-machine continuation [FE-POR-API-0002]
> Commit `3963bbb` (2026-05-12): feat(PLA-0043): scope rail polish — auto-width, spine elbows, vector scrollbar [FE-POR-0003.1]
> Commit `32002b3` (2026-05-12): docs(R054): Rally user-to-project assignment UX research
> Commit `6d568c0` (2026-05-12): docs(PLA-0044,PLA-0045): plan JSONs for /dev Plans tab + story-index bump to 00549 [FE-DEV-0025]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `bb18aa4` (2026-05-12): feat(PLA-0044): walkTopology Go mirror + cross-runtime parity tests [FE-POR-API-0006]
> Commit `bb18aa4` (2026-05-12): feat(PLA-0044): walkTopology Go mirror + cross-runtime parity tests [FE-POR-API-0006]
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `098ccbb` (2026-05-12): feat(PLA-0044): layoutWithDagre delegates visibility walk to walkTopology [FE-POR-API-0006]
> Commit `eaf4feb` (2026-05-12): feat(PLA-0044): useTopologyTreeState sources childrenOf from walkTopology [FE-POR-API-0006]
> Commit `6857913` (2026-05-12): feat(PLA-0044): TopologyTreeFlyout rows come from walkTopology [FE-POR-API-0006]
> Commit `ea4862c` (2026-05-12): fix(PLA-0044): ScopeRail uses walkTopology + byPosition — kills phantom-D orphan re-root [FE-POR-API-0006]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `c9764a6` (2026-05-12): feat(PLA-0044): UserNodeAssignment picker — gadmin checkbox tree [FE-POR-0003.9.10]
> Commit `0a2ee86` (2026-05-12): docs(PLA-0044): close out plan — catalogue row + index + plan JSON [FE-DEV-0025]
> Commit `816fbf7` (2026-05-12): chore: mcp whisper stdio type + theme slot-name sanitisation
> Commit `fea4fc9` (2026-05-12): feat(PLA-0043): chrome rework — typecase.css, viewport-anchored title, breadcrumbs [FE-POR-0003.1]
> Commit `9c29056` (2026-05-13): feat(001_redesign): Layout 04 shell — icon rail + section flyout at /redesign
> Commit `01347cf` (2026-05-13): feat(001_redesign): swap (user) layout to redesign shell — rail + flyout live site-wide
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `f515b71` (2026-05-13): fix(001_redesign): rail click + bottom util visibility [FE-POR-0003.1]
> Commit `db60132` (2026-05-13): fix(001_redesign): pin rail + flyout to viewport [FE-POR-0003.1]
> Commit `0bf13ed` (2026-05-13): feat(001_redesign): bounce-in animation for rail active indicator [FE-POR-0003.1]
> Commit `fee4481` (2026-05-13): feat(001_redesign): slide-down bounce for rail active indicator [FE-POR-0003.1]
> Commit `b5c4831` (2026-05-13): feat(001_redesign): travelling rail indicator — stretch then elastic settle [FE-POR-0003.1]
> Commit `05cead9` (2026-05-13): fix(001_redesign): nav-v2 route corrections + travel indicator anchor [FE-POR-0003.1]
> Commit `3790542` (2026-05-13): feat(PLA-0043): persist mixed tag+group bucket order per nav profile [FE-POR-0003.1]
> Commit `8825bab` (2026-05-13): feat(PLA-0043): add Workspace Admin / User Management / Vector Admin nav entries [FE-POR-0003.1]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `4d4ec2a` (2026-05-13): feat(PLA-0043): add Vector Admin sub-pages + User Management permissions page [FE-POR-0003.1]
> Commit `3b1a9d6` (2026-05-13): fix(PLA-0043): sort catalogue items by tag_enum before save to satisfy contiguity rule [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `545ebbd` (2026-05-13): feat(PLA-0043): tag bucket icon overrides in nav preferences [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `495b81c` (2026-05-13): feat(PLA-0043): kill admin_settings tag bucket — all admin pages live in named groups [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `0d330a7` (2026-05-13): feat(PLA-0043): dev pages as 2nd-rail nav — remove tab strip, register 13 pages in shell catalogue [FE-POR-0003.1]
> Commit `b8d1e66` (2026-05-13): fix(PLA-0043): dev_tools nav — auto-pin pages, Research first, remove hardcoded gear link [FE-POR-0003.1]
> Commit `e8046c4` (2026-05-13): fix(PLA-0043): restore dev gear icon in rail util tray [FE-POR-0003.1]
> Commit `0941095` (2026-05-13): feat(PLA-0043): rail icon click navigates to first page of section [FE-POR-0003.1]
> Commit `5e06f7d` (2026-05-13): style: remove border from .panel — borderless card surface [FE-POR-0003.1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `82951c5` (2026-05-13): fix(PLA-0023): renumber library_ack drop + drop o_search_index_outbox [P1]
> Commit `b76ed1c` (2026-05-13): chore(PLA-0023): drop obj_flow_* legacy family from mmff_vector [P0']
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `ed446dd` (2026-05-13): fix(001_redesign): hide admin groups from Available when already in Pinned [FE-POR-0003.1]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `4411327` (2026-05-13): feat(PLA-0026/SA1): remove legacy vectorPool saga writes — VA is now sole write path [FE-POR-0003]
> Commit `1bc9958` (2026-05-13): feat(PLA-0026/SA2): add artefact_adoption_state to vector_artefacts [FE-SQL-0019]
> Commit `a998fc5` (2026-05-13): refactor(PLA-0044): remove legacy AppSidebar_2 component — superseded by redesign two-rail nav
> Commit `8264471` (2026-05-13): refactor(PLA-0044): delete legacy PageHeaderBar + dead page-header CSS [FE-UI-0001]
> Commit `a8c9c3a` (2026-05-13): refactor(PLA-0044): rename rd-topbar → nav-top-bar — CSS naming convention [FE-UI-0001]
> Commit `376cfef` (2026-05-13): refactor(PLA-0044): nav-primary-rail-1 — fix 6 CSS naming violations [FE-UI-0001]
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `4ab58a3` (2026-05-13): chore(PLA-0039): delete empty /samantha/v1 chi block from router [FE-POR-0003]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `952cc41` (2026-05-13): plan(PLA-0048): codebase recovery — lock conventions, install drift gates, consolidate SQL [RF1]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `4e1e171` (2026-05-14): docs(PLA-0048 / RF1.6): documentation pass — regenerate docs to post-rename truth [RF1.6]
> Commit `d00e3d1` (2026-05-14): chore(PLA-0048 / RF1.4.4): ship lint:column-prefix-convention (warn-only) [RF1.4.4]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7773c95` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_sessions (§2.3) [RF1.4.4.users_sessions]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `a6db775` (2026-05-14): fix(nav): AccountFlyout only shows avatar_menu tag, not rail-1 admin buckets
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `b343d51` (2026-05-16): feat(NavigationPie): full-circle pie filter primitive + dev showcase
> Commit `0bab39c` (2026-05-16): refactor(work-items): chip swap StarburstFilter → NavigationPie + multi-value filter shape
> Commit `817922b` (2026-05-16): docs: file TD-FILTER-MULTI + URL-state purge backlog item
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `90a1c04` (2026-05-16): fix(PageSummaryHeader): suppress help icon on the inner Panel
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `6f51bd0` (2026-05-16): feat(redesign): swap V text brand for /logo-vector.png in primary rail
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `44f56a1` (2026-05-16): chore(claude): post-edit lint hook, dev-env lockdown, postgres MCP wrapper
> Commit `f50f4c3` (2026-05-16): feat(stories): auto-provision tracker groups via rg-runner -create-if-missing
> Commit `955d421` (2026-05-16): chore(claude): un-gitignore .claude/settings.json — single-user multi-machine sync
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `d60981e` (2026-05-16): fix(plans-panel): query param typo + defensive array guards
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `c630ee7` (2026-05-16): chore(plans): merge orphan ACs + sync 00595/00597 done flags
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `6bbaa70` (2026-05-16): chore(plans): stamp dates + flip backlog/AC status for PLA-0053/0054/0055
> Commit `72f2430` (2026-05-16): feat(tree): per-row cog menu in dense tree (edit/duplicate/move/split/delete)
> Commit `481407b` (2026-05-16): feat(001_redesign): share travel-indicator across both nav rails [FE-POR-0003.1]
> Commit `9e4422d` (2026-05-17): feat(tree): paginationPosition prop on ResourceTree (both|bottom) [B21]
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `9c45ef2` (2026-05-17): chore(tech-debt): triage 2026-05-17 — mark 3 resolved, flag DB-002 trigger
> Commit `e41ed3c` (2026-05-17): fix(errorsreport): correct wire-shape assertion in TestReport_UnknownCode (TD-ERRORSREPORT-WIRE-SHAPE)
> Commit `36a15a6` (2026-05-17): feat(page-summary): add danger tone to SummaryCellTone (TD-SUMMARY-TONE)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `28a4c8e` (2026-05-18): fix(login): remove duplicate logo from beige panel
> Commit `fa5bd5b` (2026-05-18): fix(login): move vertical Vector into left white column, beige sidebar to center
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
> Commit `c40d494` (2026-05-18): fix(realtime): gate ServeWS conn.Close so first frame wins [B16.8.12]
> Commit `d6c660e` (2026-05-18): docs(claude): add swarm stack pointer to working-practices index
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
- ✅ **F1.1.7** ~~Add `accepted` kind to `flow_states` CHECK constraint — needed to distinguish Accepted from Completed in metrics; update existing Accepted seeds to use it~~ `[P2]`
> Last checked: 2026-05-10 — F1.1.1–F1.1.7 covered by migration 041 + 042 (Story/Epic/Defect 5-state, Task 3-state, DE QA exists, BC/BE/PO/SO seeded, accepted in CHECK widened to 6 in 042). Note: FLOW1's seed-kind alignment renamed `Ready → To Do` and added `backlog` kind, superseding F1.1's `Ready (todo)` naming — current DB reflects FLOW1's model.
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `1e010e2` (2026-05-12): chore(scope): Vector_Scope progress sweep + PLA-0022 date bump + R051 research entry
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `96b7f25` (2026-05-12): docs(research): R052 Rally scope mechanics + R053 Rally/Jira/ADO comparison; backfill PLA-0042.md
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `c9764a6` (2026-05-12): feat(PLA-0044): UserNodeAssignment picker — gadmin checkbox tree [FE-POR-0003.9.10]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `a743bb3` (2026-05-13): chore(PLA-0023): drop dead defects table from mmff_vector [P0'/P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `82951c5` (2026-05-13): fix(PLA-0023): renumber library_ack drop + drop o_search_index_outbox [P1]
> Commit `49b0909` (2026-05-13): chore(PLA-0023): drop 2 dead-leaf legacy tables, hold user_nav_* [P0']
> Commit `b76ed1c` (2026-05-13): chore(PLA-0023): drop obj_flow_* legacy family from mmff_vector [P0']
> Commit `1cbe497` (2026-05-13): chore(PLA-0023): drop shadow master_record_tenant from mmff_vector [P2]
> Commit `3ff59f0` (2026-05-13): chore(PLA-0023): P5 verification pass — drop 2 dead leaves, map blockers [P5]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `c9c78c5` (2026-05-16): chore(claude): add /migration skill — DB schema scaffolder
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `5ccef56` (2026-05-18): feat(migration): users_reauth_nonces table for step-up reauth [B16.8.10]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]

> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
### F1.2 Backend — flow state colour PATCH API
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap

> Commit `743b077` (2026-05-10): feat(roles): drop MVP single-admin workspace constraint
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
- ✅ **F1.2.1** ~~Add `PATCH /_site/flow-states/{id}` handler (colour only for now) — validates `#RRGGBB`, returns updated state~~ `[P1]`
> Commit `29dca0e` (2026-05-10): feat(F1): flow states Customisation tab — tertiary nav per artefact type, colour PATCH [F1.2.1] [F1.2.2] [F1.2.3]
> Commit `b184f96` (2026-05-10): refactor(F1): flow states — single-page layout with PageAnchorNav TOC [F1.2.1] [F1.2.2]
> Commit `8d4ab8e` (2026-05-10): refactor(F1): route flows + flowStates through apiSite registry [F1.2.1] [F1.2.2]
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `01347cf` (2026-05-13): feat(001_redesign): swap (user) layout to redesign shell — rail + flyout live site-wide
> Commit `3790542` (2026-05-13): feat(PLA-0043): persist mixed tag+group bucket order per nav profile [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `b76ed1c` (2026-05-13): chore(PLA-0023): drop obj_flow_* legacy family from mmff_vector [P0']
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `5eba458` (2026-05-16): fix(test): bulk set_priority payload uses priority_id UUID [00595,00597 fixup]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `e41ed3c` (2026-05-17): fix(errorsreport): correct wire-shape assertion in TestReport_UnknownCode (TD-ERRORSREPORT-WIRE-SHAPE)
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
- ✅ **F1.2.2** ~~Register route in `mountSiteRoutes` with `RequireAuth` + `RequireFreshPassword`~~ `[P1]`
> Commit `29dca0e` (2026-05-10): feat(F1): flow states Customisation tab — tertiary nav per artefact type, colour PATCH [F1.2.1] [F1.2.2] [F1.2.3]
> Commit `b184f96` (2026-05-10): refactor(F1): flow states — single-page layout with PageAnchorNav TOC [F1.2.1] [F1.2.2]
> Commit `e95608b` (2026-05-10): feat(F1): flow map SVG diagram above each flow's state table [F1.2.2]
> Commit `8d4ab8e` (2026-05-10): refactor(F1): route flows + flowStates through apiSite registry [F1.2.1] [F1.2.2]
> Commit `f0f0aa9` (2026-05-10): fix(F1): transitions not iterable — init empty slice, add null guard [F1.2.2]
> Commit `4ba5bfc` (2026-05-10): fix(F1): flow map — transparent bg, 5px arrow gap from pill edges [F1.2.2]
> Commit `96f9bd6` (2026-05-10): fix(F1): flow map pills — border-only style when no custom colour set [F1.2.2]
> Commit `b471bea` (2026-05-10): fix(F1): flow map pills — always transparent fill, colour as border, square corners [F1.2.2]
> Commit `5ee6c8b` (2026-05-10): fix(F1): flow map pills — text colour matches border colour [F1.2.2]
> Commit `06966c7` (2026-05-10): fix(F1): flow map pills — standard ink text colour [F1.2.2]
> Commit `71e8b2e` (2026-05-10): feat(F1): add state + transition matrix editor [F1.2.2]
> Commit `d3c5b7f` (2026-05-10): feat(F1): drag-to-reorder states in flow table [F1.2.2]
> Commit `990733a` (2026-05-10): fix(F1): all states draggable — fix dnd-kit handle registration [F1.2.2]
> Commit `d9a54d7` (2026-05-10): feat(F1): inline flow map editor — insert/remove states with animation [F1.2.2]
> Commit `9414010` (2026-05-10): feat(F1): drag-to-reorder pills in flow map — horizontal axis only [F1.2.2]
> Commit `682f6b3` (2026-05-10): feat(F1): pill toolbar with position-aware drag handle + live drag movement [F1.2.2]
> Commit `6f4b4b2` (2026-05-10): feat(F1): DragOverlay for live pill ghost + large always-visible toolbar buttons [F1.2.2]
> Last checked: 2026-05-10 — `PATCH /_site/flow-states/{id}` registered at `backend/cmd/server/main.go` lines 921–927 with `RequireAuth` + `RequireFreshPassword`; handler `flowsH.PatchFlowState` in `backend/internal/flows/handler.go`. Confirmed wired through apiSite registry.
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `05cead9` (2026-05-13): fix(001_redesign): nav-v2 route corrections + travel indicator anchor [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `0d330a7` (2026-05-13): feat(PLA-0043): dev pages as 2nd-rail nav — remove tab strip, register 13 pages in shell catalogue [FE-POR-0003.1]
> Commit `b76ed1c` (2026-05-13): chore(PLA-0023): drop obj_flow_* legacy family from mmff_vector [P0']
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `4ab58a3` (2026-05-13): chore(PLA-0039): delete empty /samantha/v1 chi block from router [FE-POR-0003]
> Commit `5bdf3be` (2026-05-13): docs(PLA-0030): document 5 missing /samantha/v2 routes in openapi-v2.yaml
> Commit `2e9ff2d` (2026-05-13): chore: memory rule + 4 deferrals filed in tech-debt register [TD-AUTH-001 TD-API-002 TD-API-003 TD-API-004]
> Commit `71f127e` (2026-05-13): feat: dev/scripts/pace.sh — commit-mix + TD-register scoreboard
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]

### F1.3 Frontend — Customisation page flow states section

- **F1.3.1** Move existing Work Items page (`/workspace-settings/work-items`) content into Customisation as third-level tab section `[P2]`
> Commit `4995027` (2026-05-12): fix(css): sticky TOC rail + section anchors clear L2+L3 nav stack
> Commit `9c29056` (2026-05-13): feat(001_redesign): Layout 04 shell — icon rail + section flyout at /redesign
> Commit `01347cf` (2026-05-13): feat(001_redesign): swap (user) layout to redesign shell — rail + flyout live site-wide
> Commit `05cead9` (2026-05-13): fix(001_redesign): nav-v2 route corrections + travel indicator anchor [FE-POR-0003.1]
> Commit `8825bab` (2026-05-13): feat(PLA-0043): add Workspace Admin / User Management / Vector Admin nav entries [FE-POR-0003.1]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `4d4ec2a` (2026-05-13): feat(PLA-0043): add Vector Admin sub-pages + User Management permissions page [FE-POR-0003.1]
> Commit `3b1a9d6` (2026-05-13): fix(PLA-0043): sort catalogue items by tag_enum before save to satisfy contiguity rule [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `545ebbd` (2026-05-13): feat(PLA-0043): tag bucket icon overrides in nav preferences [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `495b81c` (2026-05-13): feat(PLA-0043): kill admin_settings tag bucket — all admin pages live in named groups [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `0d330a7` (2026-05-13): feat(PLA-0043): dev pages as 2nd-rail nav — remove tab strip, register 13 pages in shell catalogue [FE-POR-0003.1]
> Commit `b8d1e66` (2026-05-13): fix(PLA-0043): dev_tools nav — auto-pin pages, Research first, remove hardcoded gear link [FE-POR-0003.1]
> Commit `0941095` (2026-05-13): feat(PLA-0043): rail icon click navigates to first page of section [FE-POR-0003.1]
> Commit `5e06f7d` (2026-05-13): style: remove border from .panel — borderless card surface [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `49b0909` (2026-05-13): chore(PLA-0023): drop 2 dead-leaf legacy tables, hold user_nav_* [P0']
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `ed446dd` (2026-05-13): fix(001_redesign): hide admin groups from Available when already in Pinned [FE-POR-0003.1]
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `4411327` (2026-05-13): feat(PLA-0026/SA1): remove legacy vectorPool saga writes — VA is now sole write path [FE-POR-0003]
> Commit `a998fc5` (2026-05-13): refactor(PLA-0044): remove legacy AppSidebar_2 component — superseded by redesign two-rail nav
> Commit `8264471` (2026-05-13): refactor(PLA-0044): delete legacy PageHeaderBar + dead page-header CSS [FE-UI-0001]
> Commit `a8c9c3a` (2026-05-13): refactor(PLA-0044): rename rd-topbar → nav-top-bar — CSS naming convention [FE-UI-0001]
> Commit `376cfef` (2026-05-13): refactor(PLA-0044): nav-primary-rail-1 — fix 6 CSS naming violations [FE-UI-0001]
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `d28b2f5` (2026-05-14): refactor(nav): final bucket reshape per Rick's locked spec (mig 192)
> Commit `2882270` (2026-05-14): chore(nav): grant gadmin + padmin universal page visibility (mig 193)
> Commit `a6db775` (2026-05-14): fix(nav): AccountFlyout only shows avatar_menu tag, not rail-1 admin buckets
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `b343d51` (2026-05-16): feat(NavigationPie): full-circle pie filter primitive + dev showcase
> Commit `0bab39c` (2026-05-16): refactor(work-items): chip swap StarburstFilter → NavigationPie + multi-value filter shape
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `90a1c04` (2026-05-16): fix(PageSummaryHeader): suppress help icon on the inner Panel
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `6f51bd0` (2026-05-16): feat(redesign): swap V text brand for /logo-vector.png in primary rail
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `37c9929` (2026-05-16): test(priority): red — F9 catalogue + chip + Showstopper [00609]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `d60981e` (2026-05-16): fix(plans-panel): query param typo + defensive array guards
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `72f2430` (2026-05-16): feat(tree): per-row cog menu in dense tree (edit/duplicate/move/split/delete)
> Commit `481407b` (2026-05-16): feat(001_redesign): share travel-indicator across both nav rails [FE-POR-0003.1]
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `36a15a6` (2026-05-17): feat(page-summary): add danger tone to SummaryCellTone (TD-SUMMARY-TONE)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `ddbca1f` (2026-05-18): feat(login): redesigned login page with quiet sidebar layout
> Commit `1a5abc5` (2026-05-18): feat(login): pixel-perfect redesigned login matching design mockup
> Commit `6814e7d` (2026-05-18): feat(login): update sidebar branding — white bg, vertical red VECTOR wordmark
> Commit `31feaed` (2026-05-18): feat(login): complete redesign — welcome (left) + form (right) layout
> Commit `7c9af17` (2026-05-18): fix(login): sidebar branding — black V + red ector, proper fill and spacing
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `d8cf68b` (2026-05-18): fix(login): sidebar wordmark — vertical text with rotation
> Commit `bb5412f` (2026-05-18): fix(login): sidebar wordmark — Vector with lowercase ector
> Commit `29b394d` (2026-05-18): feat(login): redesign with horizontal two-column layout
> Commit `4851c50` (2026-05-18): feat(login): add black logo column on left (200px)
> Commit `28a4c8e` (2026-05-18): fix(login): remove duplicate logo from beige panel
> Commit `fa5bd5b` (2026-05-18): fix(login): move vertical Vector into left white column, beige sidebar to center
> Commit `573c633` (2026-05-18): fix(login): scale entire auth card to 50% size
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
- **F1.3.2** Add third-level tab nav to Customisation page: work-type tabs (Story, Epic, Task, Defect) + strategy-type tabs (SO, PO, BE, BC, FE) + Defect QA tab `[P2]`
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
> Commit `4995027` (2026-05-12): fix(css): sticky TOC rail + section anchors clear L2+L3 nav stack
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `816fbf7` (2026-05-12): chore: mcp whisper stdio type + theme slot-name sanitisation
> Commit `10eea24` (2026-05-12): feat(theme-classic): restore historic Theme Maker at /theme-classic
> Commit `fea4fc9` (2026-05-12): feat(PLA-0043): chrome rework — typecase.css, viewport-anchored title, breadcrumbs [FE-POR-0003.1]
> Commit `fea4fc9` (2026-05-12): feat(PLA-0043): chrome rework — typecase.css, viewport-anchored title, breadcrumbs [FE-POR-0003.1]
> Commit `9c29056` (2026-05-13): feat(001_redesign): Layout 04 shell — icon rail + section flyout at /redesign
> Commit `01347cf` (2026-05-13): feat(001_redesign): swap (user) layout to redesign shell — rail + flyout live site-wide
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `05cead9` (2026-05-13): fix(001_redesign): nav-v2 route corrections + travel indicator anchor [FE-POR-0003.1]
> Commit `3790542` (2026-05-13): feat(PLA-0043): persist mixed tag+group bucket order per nav profile [FE-POR-0003.1]
> Commit `3790542` (2026-05-13): feat(PLA-0043): persist mixed tag+group bucket order per nav profile [FE-POR-0003.1]
> Commit `8825bab` (2026-05-13): feat(PLA-0043): add Workspace Admin / User Management / Vector Admin nav entries [FE-POR-0003.1]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `3b1a9d6` (2026-05-13): fix(PLA-0043): sort catalogue items by tag_enum before save to satisfy contiguity rule [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `545ebbd` (2026-05-13): feat(PLA-0043): tag bucket icon overrides in nav preferences [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `0d330a7` (2026-05-13): feat(PLA-0043): dev pages as 2nd-rail nav — remove tab strip, register 13 pages in shell catalogue [FE-POR-0003.1]
> Commit `b8d1e66` (2026-05-13): fix(PLA-0043): dev_tools nav — auto-pin pages, Research first, remove hardcoded gear link [FE-POR-0003.1]
> Commit `0941095` (2026-05-13): feat(PLA-0043): rail icon click navigates to first page of section [FE-POR-0003.1]
> Commit `a743bb3` (2026-05-13): chore(PLA-0023): drop dead defects table from mmff_vector [P0'/P1]
> Commit `49b0909` (2026-05-13): chore(PLA-0023): drop 2 dead-leaf legacy tables, hold user_nav_* [P0']
> Commit `b76ed1c` (2026-05-13): chore(PLA-0023): drop obj_flow_* legacy family from mmff_vector [P0']
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `ed446dd` (2026-05-13): fix(001_redesign): hide admin groups from Available when already in Pinned [FE-POR-0003.1]
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `a998fc5` (2026-05-13): refactor(PLA-0044): remove legacy AppSidebar_2 component — superseded by redesign two-rail nav
> Commit `a8c9c3a` (2026-05-13): refactor(PLA-0044): rename rd-topbar → nav-top-bar — CSS naming convention [FE-UI-0001]
> Commit `376cfef` (2026-05-13): refactor(PLA-0044): nav-primary-rail-1 — fix 6 CSS naming violations [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `a8c32ec` (2026-05-14): docs(PLA-0048 / RF1.0): lock hierarchical table + column-prefix naming rules
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `d28b2f5` (2026-05-14): refactor(nav): final bucket reshape per Rick's locked spec (mig 192)
> Commit `2882270` (2026-05-14): chore(nav): grant gadmin + padmin universal page visibility (mig 193)
> Commit `a6db775` (2026-05-14): fix(nav): AccountFlyout only shows avatar_menu tag, not rail-1 admin buckets
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `e367266` (2026-05-15): docs: handover — table catalog restyle + permissions tree-lines session
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `b343d51` (2026-05-16): feat(NavigationPie): full-circle pie filter primitive + dev showcase
> Commit `0bab39c` (2026-05-16): refactor(work-items): chip swap StarburstFilter → NavigationPie + multi-value filter shape
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `6f51bd0` (2026-05-16): feat(redesign): swap V text brand for /logo-vector.png in primary rail
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `35ecd8d` (2026-05-16): feat(vector_artefacts): green — backfill artefacts_types_slot per workspace [00583]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `37c9929` (2026-05-16): test(priority): red — F9 catalogue + chip + Showstopper [00609]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `481407b` (2026-05-16): feat(001_redesign): share travel-indicator across both nav rails [FE-POR-0003.1]
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `5ccef56` (2026-05-18): feat(migration): users_reauth_nonces table for step-up reauth [B16.8.10]
> Commit `d6c660e` (2026-05-18): docs(claude): add swarm stack pointer to working-practices index
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
- **F1.3.3** Flow state colour picker per state row (same `ColourPicker` component) — PATCH calls `/_site/flow-states/{id}` `[P2]`
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
> Commit `4efd532` (2026-05-12): fix(dev): drop accidental /api prefix from page-help admin calls
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `cc38e98` (2026-05-12): docs(PLA-0043): handover for cross-machine continuation [FE-POR-API-0002]
> Commit `32002b3` (2026-05-12): docs(R054): Rally user-to-project assignment UX research
> Commit `6d568c0` (2026-05-12): docs(PLA-0044,PLA-0045): plan JSONs for /dev Plans tab + story-index bump to 00549 [FE-DEV-0025]
> Commit `eaf4feb` (2026-05-12): feat(PLA-0044): useTopologyTreeState sources childrenOf from walkTopology [FE-POR-API-0006]
> Commit `c9764a6` (2026-05-12): feat(PLA-0044): UserNodeAssignment picker — gadmin checkbox tree [FE-POR-0003.9.10]
> Commit `01347cf` (2026-05-13): feat(001_redesign): swap (user) layout to redesign shell — rail + flyout live site-wide
> Commit `b76ed1c` (2026-05-13): chore(PLA-0023): drop obj_flow_* legacy family from mmff_vector [P0']
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `1bc9958` (2026-05-13): feat(PLA-0026/SA2): add artefact_adoption_state to vector_artefacts [FE-SQL-0019]
> Commit `952cc41` (2026-05-13): plan(PLA-0048): codebase recovery — lock conventions, install drift gates, consolidate SQL [RF1]
> Commit `a8c32ec` (2026-05-14): docs(PLA-0048 / RF1.0): lock hierarchical table + column-prefix naming rules
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `817922b` (2026-05-16): docs: file TD-FILTER-MULTI + URL-state purge backlog item
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `8729c54` (2026-05-18): feat(ops): vector-dev swarm stack as infra-as-code + pg_stat_statements
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
- **F1.3.4** Frontend `flowStatesApi` — `listByType(artefactTypeId)` + `patch(stateId, {colour})` via `apiSite` `[P2]`
> Commit `8ada5e5` (2026-05-11): refactor: nest Organisation & Work Items under Vector Admin tab
> Commit `1cb8b7d` (2026-05-11): refactor: tenant-aware subtitle on Vector Admin tab
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
- **F1.3.5** Update `useWorkItemFlowStates` to pass state colours through to `FlowStatePillRow` for coloured pills in the tree `[P3]`
> Commit `8ada5e5` (2026-05-11): refactor: nest Organisation & Work Items under Vector Admin tab
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `eaf4feb` (2026-05-12): feat(PLA-0044): useTopologyTreeState sources childrenOf from walkTopology [FE-POR-API-0006]
> Commit `6857913` (2026-05-12): feat(PLA-0044): TopologyTreeFlyout rows come from walkTopology [FE-POR-API-0006]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `c9764a6` (2026-05-12): feat(PLA-0044): UserNodeAssignment picker — gadmin checkbox tree [FE-POR-0003.9.10]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `e367266` (2026-05-15): docs: handover — table catalog restyle + permissions tree-lines session
> Commit `0bab39c` (2026-05-16): refactor(work-items): chip swap StarburstFilter → NavigationPie + multi-value filter shape
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `72f2430` (2026-05-16): feat(tree): per-row cog menu in dense tree (edit/duplicate/move/split/delete)
> Commit `9e4422d` (2026-05-17): feat(tree): paginationPosition prop on ResourceTree (both|bottom) [B21]
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]

> Commit `743b077` (2026-05-10): feat(roles): drop MVP single-admin workspace constraint
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
---
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]

> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
## M1. Flows
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap

> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
Workflow definitions and states for work items. Currently reads from `obj_flow_tenant` in the old database (`mmff_vector`). The new database already has the correct tables (`flows`, `flow_states`, `flow_transitions`) — the data needs copying across and the handler switching over. Plan: [PLA-0031](dev/plans/PLA-0031.json)
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs

> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
### ✅ ~~M1.1 API — Register `/flows` on v2~~

- ✅ **M1.1.1** Register `GET /flows` under `/samantha/v2` in `main.go` `[P2]`
  `[✓] M1.2.3 Service rewritten → [✓] M1.2.4 Query rewritten → [ ] M1.3.3 ETL verified (pending dev run)`
- ✅ **M1.1.2** Remove `GET /flows` from `/samantha/v1` block `[P2]`
  `[✓] M1.1.1 v2 route registered`
- ✅ **M1.1.3** Update `openapi-v2.yaml` with `/flows` path spec `[P2]`
  `[✓] M1.1.1 v2 route live`
- ✅ **M1.1.4** Switch frontend caller (`workspace-settings/work-items/page.tsx`) from `api('/flows/')` to `apiV2('/flows/')` `[P2]`
  `[✓] M1.1.1 v2 route live → [✓] M1.1.3 spec updated`

### ✅ ~~M1.2 New Database — `vector_artefacts`~~

- ✅ **M1.2.1** `flows` table already exists — verify `artefact_type_id`, `name`, `is_default`, `archived_at` columns are sufficient `[P2]`
  `[✓] 004_flows.sql applied — all required columns confirmed`
- ✅ **M1.2.2** `flow_states` table already exists — verify `flow_id`, `name`, `kind`, `sort_order`, `is_initial` columns are sufficient `[P2]`
  `[✓] 004_flows.sql applied — all required columns confirmed`
- ✅ **M1.2.3** Rewrite `flows.Service` constructor to accept `vectorArtefactsPool` instead of `pool` `[P2]`
  `[✓] M1.2.1 flows table verified → [✓] M1.2.2 flow_states table verified`
- ✅ **M1.2.4** Rewrite `ListBySubscription` query to read from `flows JOIN artefact_types` scoped by `workspace_id` `[P2]`
  `[✓] M1.2.3 Service constructor rewritten → [ ] M1.3.3 ETL run and verified (pending dev run)`

### M1.3 Old Database — `mmff_vector`

- ✅ **M1.3.1** Map `obj_flow_tenant` columns to `flows`/`flow_states` — document the `subscription_id → workspace_id` translation and the three polymorphic FK variants (system / tenant / portfolio) `[P2]`
  *(captured in etl_flows.sql column map header)*
- ✅ **M1.3.2** Write ETL script: read `obj_flow_tenant` rows, resolve `artefact_type_id` via `artefact_types`, insert into `flows` + `flow_states` in `vector_artefacts` `[P2]`
  `[✓] M1.3.1 Column map complete → [✓] M1.2.1 flows table verified → [✓] M1.2.2 flow_states table verified`
- ✅ ~~**M1.3.3** Run ETL on dev DB; verify row counts and spot-check data `[P2]`~~
  > Run 2026-05-08 via FDW (both DBs on same server). 21 total flow_states in VA: Defect/Epic/Story/Task have seeded 4-state flows (To Do→In Progress→Done→Cancelled) kept as-is; Feature populated with 5 legacy states (Backlog→Ready→Doing→Completed→Accepted). Strategy types empty — no legacy data. 4 source type_labels (Defect State, Portfolio Item, Test Case, Work Item) had no VA artefact_types match and were skipped. ETL script updated: `backlog`/`doing` canonical codes added, "empty flows only" guard added. FDW tables `fdw_obj_flow_tenant_full`, `fdw_obj_execution_types`, `fdw_obj_strategy_types`, `fdw_obj_execution_types_tenant` created in vector_artefacts.
  > Last checked: 2026-05-08
  >
- ✅ **M1.3.4** Retain `mmff_vector` pool in handler for tenancy gate only (membership check) — do not remove pool reference entirely `[P2]`
  `[✓] M1.2.3 Service rewritten → [✓] M1.2.4 Query rewritten`

---

## M2. Tenant Settings

Org-level configuration — name, branding, timezone. `master_record_tenant` now exists in both `mmff_vector` (source) and `vector_artefacts` (target). Service rewired. Pending: ETL run on dev DB. Plan: [PLA-0032](dev/plans/PLA-0032.json)

### M2.1 API — `/tenant-settings` route

- ✅ **M2.1.1** Route already at `/api/tenant-settings` — not under `/samantha/v1`; no v2 registration needed `[P2]`
  > Mounted independently in `main.go`; outside the deprecation path
  >
- ❌ NFA **M2.1.2** Remove from `/samantha/v1` — N/A, was never under v1
- ❌ NFA **M2.1.3** `openapi-v2.yaml` spec update — N/A, route is outside v2 block
- ❌ NFA **M2.1.4** Switch `api()` → `apiV2()` — N/A, route path unchanged

### ✅ ~~M2.2 New Database — `vector_artefacts`~~

- ✅ **M2.2.1** Design `master_record_tenant` in `vector_artefacts` — `workspace_id` PK (bare UUID, same pattern as `artefacts`) `[P2]`
  > 17 columns from mmff_vector post-mig-127/128; 3 feature-flag cols dropped (not in service model)
  >
- ✅ **M2.2.2** Write migration `036_master_record_tenant.sql` `[P2]`
  `[✓] M2.2.1 Table designed` — `db/artefacts_schema/036_master_record_tenant.sql`
- ✅ **M2.2.3** Rewrite `tenantsettings.Service` to use `vaPool` `[P2]`
  `[✓] M2.2.2 Migration written` — queries updated to `workspace_id` PK; cross-DB owner-user existence check removed (trust-caller)
- ✅ **M2.2.4** All queries rewritten for `vector_artefacts.master_record_tenant` `[P2]`
  `[✓] M2.2.3 Service rewritten` — `main.go` passes `vaPool` (falls back to `pool` until mig 036 applied on dev)

### M2.3 Old Database — `mmff_vector`

- ✅ **M2.3.1** Audit `master_record_tenant` columns — 17 columns map 1:1; only rename is `tenant_id → workspace_id` `[P2]`
  > Column map in `dev/scripts/etl_tenant_settings.sql` header
  >
- ✅ **M2.3.2** Write ETL script `[P2]`
  `[✓] M2.3.1 Audit complete → [✓] M2.2.2 Migration written` — `dev/scripts/etl_tenant_settings.sql`; idempotent `ON CONFLICT DO UPDATE`
- ✅ ~~**M2.3.3** Run ETL on dev DB; verify row counts `[P2]`~~
  > Run 2026-05-08 via FDW. Migration 036 applied. 1 row upserted (workspace_id `000...001`, tenant "MMFFDev New Schema", tz Europe/London, workdays {mon–fri}). `fdw_master_record_tenant` created in vector_artefacts.
  > Last checked: 2026-05-08
  > `[✓] M2.3.2 ETL script written`
  >
- ✅ **M2.3.4** `mmff_vector` pool retained for auth/membership; tenant settings now on `vaPool` `[P2]`
  `[✓] M2.2.3 Service rewritten → [✓] M2.2.4 Queries rewritten`

---

## M3. Defects

Bug/defect work items. Currently a standalone table (`defects`) in the old database. Rather than migrating like-for-like, defects consolidate into the unified `artefacts` table as a typed artefact — then served through `/work-items` filtered by type. The `/defects` endpoint retires. Plan: [PLA-0033](dev/plans/PLA-0033.json)

### M3.1 API — Retire `/defects`, serve via `/work-items`

- **M3.1.1** Verify `GET /work-items?artefact_type=<defect-type-id>` returns defects post-ETL `[P2]`
  `[ ] M3.2.1 Defect type seeded → [ ] M3.3.3 ETL verified → [ ] M3.2.3 /work-items returns defects`
- ✅ **M3.1.2** Remove `GET/POST/PUT/DELETE /defects` from `/samantha/v1` block in `main.go` `[P2]`
  > Done 2026-05-09 — route block removed; `defectsSvc`/`defectsH` constructors removed; `defects` package import removed; `go build` clean.
- ✅ **M3.1.3** Mark `/defects` as `deprecated: true` in `openapi.yaml` `[P2]`
  > Done 2026-05-09 — `deprecated: true` added to POST `/defects`, GET/PATCH/DELETE `/defects/{id}`.
- ✅ **M3.1.4** Update any frontend callers of `api('/defects')` — switch to `apiV2('/work-items')` with type filter `[P2]`
  `[✓] Audit complete — zero frontend callers of api('/defects') found; no switch needed`

### M3.2 New Database — `vector_artefacts`

- ✅ **M3.2.1** Seed `artefact_types` row for `Defect` (name, description, workspace scope) `[P2]`
  `[✓] M3.3.1 Column audit complete` — Defect type (prefix=DE, scope=work, source=system) already seeded by seed_system_artefact_types() (migration 010); migration 027 ensures field bindings
- ✅ **M3.2.2** Seed `artefact_field_library` entries for any defect-specific columns that have no native artefact equivalent `[P2]`
  `[✓] M3.3.1 Column audit complete → [✓] M3.2.1 Defect type seeded` — 17 fields seeded in db/artefacts_schema/027_seed_defect_field_library.sql with artefact_type_fields bindings
- **M3.2.3** Verify `/work-items` handler returns defect artefacts with correct field values `[P2]`
  `[✓] M3.2.1 Type seeded → [✓] M3.2.2 Field library seeded → [✓] M3.3.3 ETL run and verified`

### M3.3 Old Database — `mmff_vector`

- ✅ **M3.3.1** Audit `defects` table columns — map each to `artefacts` native columns or `artefact_field_values` `[P2]`
  > Audit complete — column map documented in db/artefacts_schema/027_seed_defect_field_library.sql and dev/scripts/etl_defects.sql headers
  >
- ✅ **M3.3.2** Write ETL script: insert `defects` rows into `artefacts` (type=Defect) + `artefact_field_values` `[P2]`
  `[✓] M3.3.1 Column audit complete → [✓] M3.2.1 Type seeded → [✓] M3.2.2 Field library seeded` — script at dev/scripts/etl_defects.sql
- ✅ **M3.3.3** Run ETL on dev DB; compare row counts and spot-check field values `[P2]`
  Migration 027 applied (17 defect fields seeded); `timebox_sprint_id` column name fix applied to ETL script; FDW (`fdw_defects`) created in vector_artefacts; ETL ran cleanly — 0 source rows in dev DB (schema validated), 2 pre-existing DE artefacts unchanged.
- ✅ **M3.3.4** Delete `backend/internal/defects/` package once endpoint is removed `[P3]`
  > Done 2026-05-09 — package directory removed; `go build ./...` clean; no remaining package references in backend.

---

## M4. User Stories

User story work items. Same consolidation pattern as defects — `user_stories` table in old DB collapses into `artefacts`, endpoint retires. Plan: [PLA-0033](dev/plans/PLA-0033.json)

### M4.1 API — Retire `/user-stories`, serve via `/work-items`

- ✅ **M4.1.1** Verify `GET /work-items?artefact_type=<user-story-type-id>` returns user stories post-ETL `[P2]`
  Verified 2026-05-08: `GET /samantha/v2/work-items?item_type=story` → total=5705, item_type=story, flow_state attached. Filter param is `item_type` (not `artefact_type`). All correct.
- ✅ **M4.1.2** Remove `/user-stories` from `/samantha/v1` block in `main.go` `[P2]`
  Route block, handler init, and `userstories` import all removed. Build clean.
- ✅ **M4.1.3** Mark `/user-stories` as `deprecated: true` in `openapi.yaml` `[P2]`
  All 4 operations (POST, GET, PATCH, DELETE) marked `deprecated: true` in openapi.yaml.
- ✅ **M4.1.4** Update any frontend callers of `api('/user-stories')` `[P2]`
  > Frontend audit (2026-05-08): no direct `api('/user-stories')` calls found in `app/`. The string `execution_user_stories` appears only as a TypeScript type discriminator in `app/lib/samantha.ts` (not an API call). No frontend changes required.
  >

### M4.2 New Database — `vector_artefacts`

- ✅ **M4.2.1** Seed `artefact_types` row for `User Story` `[P2]`
  `[✓] M4.3.1 Column audit complete` — US type already present as "Story"/prefix=US from seed_system_artefact_types(); mig 034 WHERE NOT EXISTS guard skipped insert correctly.
- ✅ **M4.2.2** Seed `artefact_field_library` entries for user-story-specific columns `[P2]`
  23 `us_*` fields seeded (mig 034 field-library section, run 2026-05-08); options_json set for schedule_state, risk_impact, risk_probability.
- ✅ **M4.2.3** Verify `/work-items` returns user story artefacts with correct field values `[P2]`
  Verified 2026-05-08: 5705 stories returned with correct item_type, flow_state_id/name/code, parent linkage, and owner fields. EAV field values (us_* fields) not yet spot-checked — seeded data has none but schema is correct.

### M4.3 Old Database — `mmff_vector`

- ✅ **M4.3.1** Audit `user_stories` table columns — map each to `artefacts` or `artefact_field_values` `[P2]`
  > Audit complete — 13 native columns, 23 EAV fields. See `db/artefacts_schema/034_seed_user_story_type.sql` column-map comment block.
  >
- ✅ **M4.3.2** Write ETL script: insert `user_stories` rows into `artefacts` (type=User Story) `[P2]`
  `[✓] M4.3.1 Column audit complete → [✓] M4.2.1 Type seeded → [✓] M4.2.2 Field library seeded`
- ✅ **M4.3.3** Run ETL on dev DB; verify row counts and field values `[P2]`
  Run 2026-05-08 via FDW. Mig 026/027/034 applied (034 field-library-only — US type already seeded as "Story"/prefix=US). ETL ran cleanly — 0 source rows in dev (schema validated), 6 pre-existing US artefacts unchanged. Two fixes found and applied: workspace join (`master_record_workspaces` DISTINCT ON, no `is_default`); explicit NULL casts in field_values UNION ALL. `fdw_user_stories` foreign table created in vector_artefacts.
- ✅ **M4.3.4** Delete `backend/internal/userstories/` package once endpoint is removed `[P3]`
  Package retained (code still valid Go) — can be deleted in a separate cleanup pass alongside M3.3.4 (defects package). Endpoint removed; package is now dead code.

---

## M5. Portfolio Items

Portfolio-scoped work items (`obj_portfolio_items`). Same consolidation pattern — collapses into `artefacts`, endpoint retires. Plan: [PLA-0033](dev/plans/PLA-0033.json)

### ✅ ~~M5.1 API — Retire `/portfolio-items`, serve via `/work-items`~~

- ✅ **M5.1.1** Verify `GET /work-items?item_type=portfolio+item` returns portfolio items post-ETL `[P2]`
  `[✓] M5.2.1 Portfolio Item type seeded → [✓] M5.3.3 ETL verified → [✓] M5.2.3 /work-items returns portfolio items`
  Note: PI scope changed to `work` (from `strategy`) so the work-items handler serves it. `portfolio item` added to `validItemTypes` in `workitemsv2/types.go`.
- ✅ **M5.1.2** Remove `/portfolio-items` from `/samantha/v1` block in `main.go` `[P2]`
  `[✓] M5.1.1 /work-items verified as replacement` — import, svc, handler, and route block all removed.
- ✅ **M5.1.3** Mark `/portfolio-items` as `deprecated: true` in `openapi.yaml` `[P2]`
  `[✓] M5.1.1 /work-items verified as replacement` — all 4 operations marked deprecated.
- ✅ **M5.1.4** Update any frontend callers of `api('/portfolio-items')` `[P2]`
  `[✓]` — No-op: `app/(user)/portfolio-items/page.tsx` is a placeholder with no `api()` calls.

### ✅ ~~M5.2 New Database — `vector_artefacts`~~

- ✅ **M5.2.1** Seed `artefact_types` row for `Portfolio Item` `[P2]`
  `[✓] M5.3.1 Column audit complete` — done in `db/artefacts_schema/030_seed_portfolio_item_type.sql`
- ✅ **M5.2.2** Seed `artefact_field_library` entries for portfolio-item-specific columns `[P2]`
  `[✓] M5.3.1 Column audit complete → [✓] M5.2.1 Portfolio Item type seeded` — 22 `pi_*` fields + `artefact_type_fields` bindings in 030 migration
- ✅ **M5.2.3** Verify `/work-items` returns portfolio item artefacts with correct field values `[P2]`
  `[✓] M5.2.1 Type seeded → [✓] M5.2.2 Field library seeded → [✓] M5.3.3 ETL run and verified` — 0 source rows in dev; endpoint responds correctly for `item_type=portfolio+item`.

### ✅ ~~M5.3 Old Database — `mmff_vector`~~

- ✅ **M5.3.1** Audit `obj_portfolio_items` columns — map each to `artefacts` or `artefact_field_values` `[P2]`
  Column map documented in `db/artefacts_schema/030_seed_portfolio_item_type.sql` header. 12 native columns, 22 custom fields, 8 computed rollup columns excluded.
- ✅ **M5.3.2** Write ETL script: insert `obj_portfolio_items` rows into `artefacts` (type=Portfolio Item) `[P2]`
  `[✓] M5.3.1 Column audit complete → [✓] M5.2.1 Type seeded → [✓] M5.2.2 Field library seeded` — `dev/scripts/etl_portfolio_items.sql`
- ✅ **M5.3.3** Run ETL on dev DB; verify row counts and field values `[P2]`
  `[✓] M5.3.2 ETL script written` — FDW-based ETL ran; 0 source rows in dev (expected); schema compatible. `fdw_portfolio_items` foreign table created.
- ✅ **M5.3.4** Delete `backend/internal/portfolioitems/` package once endpoint is removed `[P3]`
  `[✓] M5.1.2 /portfolio-items v1 endpoint removed` — package deleted. `userstories` package also deleted (M4.3.4).

---

## M6. Topology

The org chart canvas — a tree of nodes representing offices, teams, and roles. The most complex migration: the tree is self-referential (each node points to its parent by ID), so copying must preserve the exact structure. Three new tables needed in `vector_artefacts`: `topology_nodes`, `topology_role_grants`, `topology_view_state`. Plan: [PLA-0034](dev/plans/PLA-0034.json)

### ✅ ~~M6.1 API — Register `/topology` on v2~~

- ✅ **M6.1.1** Register full CRUD for `/topology` under `/samantha/v2` in `main.go` `[P2]`
  > Done 2026-05-09 — topology block moved from root `/api` into `/samantha/v2`; `orgDesignH` wired; `go build` clean.
- ✅ **M6.1.2** Remove `/topology` from `/samantha/v1` block `[P2]`
  > Done 2026-05-09 — topology was at root `/api` level (not v1); removed from root as part of M6.1.1 move.
- ✅ **M6.1.3** Update `openapi-v2.yaml` with `/topology` path specs `[P2]`
  > Done 2026-05-09 — topology tag + 14 path entries + 4 schemas added; YAML validates clean.
- ✅ **M6.1.4** Switch `app/lib/topologyApi.ts` calls from `api()` to `apiV2()` `[P2]`
  > Done 2026-05-09 — all calls switched to `apiV2()`; `setViewState` reshaped to viewport coords; `OrgLevel` type and levels methods removed; `level_id` dropped from `OrgNode`; no TS errors.
- ✅ **M6.1.5** Audit topology components (`TopologyTreeFlyout`, `useTopologyData`, `useTopologyHandlers`, etc.) for any remaining `api()` calls `[P2]`
  > Done 2026-05-09 — grep confirms no remaining `api()` / `OrgLevel` / `level_id` references in frontend.

### ✅ ~~M6.2 New Database — `vector_artefacts`~~

- ✅ **M6.2.1** Design `topology_nodes` table — `workspace_id` tenancy, `parent_id` self-FK, spatial fields (`x`, `y`, `width`, `height`) `[P2]`
  > **START HERE →** can design in parallel with M6.3.1 audit
  >
- ✅ **M6.2.2** Design `topology_role_grants` table — links RBAC roles to topology nodes (soft FK to `roles` if not yet in `vector_artefacts`) `[P2]`
  `[✓] M6.2.1 topology_nodes designed (need PK/FK refs)`
- ✅ **M6.2.3** Design `topology_view_state` table — per-user canvas viewport (acceptable to reset on cutover) `[P2]`
  `[✓] M6.2.1 topology_nodes designed (need PK/FK refs)`
- ✅ **M6.2.4** Write migration `031_topology_nodes.sql` `[P2]`
  `[✓] M6.2.1 Table designed`
- ✅ **M6.2.5** Write migration `032_topology_role_grants.sql` `[P2]`
  `[✓] M6.2.2 Table designed → [✓] M6.2.4 Migration applied (FK dependency)`
- ✅ **M6.2.6** Write migration `033_topology_view_state.sql` `[P2]`
  `[✓] M6.2.3 Table designed → [✓] M6.2.4 Migration applied (FK dependency)`
- ✅ **M6.2.7** Rewrite `orgdesign.Service` to query `vectorArtefactsPool` `[P2]`
  > Done 2026-05-09 — dual-pool pattern (`pool` mmff_vector for auth, `vaPool` vector_artefacts for all topology I/O); `levels.go` deleted; column renames applied; `SetViewState` reshaped to viewport coords; `go build` clean; `go test ./internal/orgdesign/...` passed.

### ✅ ~~M6.3 Old Database — `mmff_vector`~~

- ✅ **M6.3.1** Audit `org_nodes` columns — confirm `subscription_id → workspace_id` mapping `[P2]`
  > **START HERE →** unblocked, no prerequisites
  >
- ✅ **M6.3.2** Write ETL script for `org_nodes → topology_nodes` — retain original UUIDs so `parent_id` links survive intact `[P2]`
  `[✓] M6.3.1 Column audit complete → [✓] M6.2.4 Migration applied`
- ✅ **M6.3.3** Write ETL script for `roles_org_nodes → topology_role_grants` — resolve `role_id` cross-DB reference `[P2]`
  `[✓] M6.3.2 topology_nodes ETL written (need FK refs) → [✓] M6.2.5 Migration applied`
- ✅ **M6.3.4** Write ETL script for `org_node_view_state → topology_view_state` — reset decision documented `[P2]`
  `[✓] M6.3.2 topology_nodes ETL written (need FK refs) → [✓] M6.2.6 Migration applied`
- ✅ **M6.3.5** Run all three ETLs on dev DB; walk the tree to verify parent/child integrity `[P2]`
  > Done 2026-05-09 — 58 topology nodes migrated (1 root, max depth 6, 0 orphans); 0 role grants (dev DB has none); `topology_view_state` intentionally empty (viewport reset on cutover).
- ✅ **M6.3.6** Retain `mmff_vector` pool for membership check only `[P2]`
  > Done 2026-05-09 — `pool` used only for subscription/membership queries; all topology I/O via `vaPool`.

---

## B1. Core Work Item Engine

Full lifecycle management for tasks, bugs, epics.

- ✅ ~~**B1.1** Full CRUD on work items (v2 — `vector_artefacts`)~~
- ✅ ~~**B1.2** Bulk operations — atomic update up to N items at once~~

  > `POST /api/v2/work-items/bulk` live — `handler.go:317`, `types.go:290`
  >
- ✅ ~~**B1.3** Parent/child hierarchy — items nested under epics~~

  - ✅ ~~**B1.3.1** `GET /work-items/{id}/children` — full descendant list with depth~~

  > `handler.go:120`, `service.go:279` — `children_count` on all item responses
  >
- **B1.4** State machine enforcement — reject invalid flow-state transitions at the API `[P2]`

  > `flow_state_id` accepted on update but no transition validation against `flow_transitions` table yet — `flow_transitions` table exists but is not queried by the update path
  > Last checked: 2026-05-08
  >
- ✅ ~~**B1.5** Ranking / drag-drop reorder~~
- ✅ ~~**B1.6** Field values on items (`field_values` on item response)~~

  > `GET /api/v2/work-items/{id}/field-values` live — `handler.go:341`
  >
- **B1.7** Work item templates `[P4]`
- **B1.8** Blocked-state — orthogonal stuck flag with provenance `[P2]`
> Commit `0ffe20d` (2026-05-09): chore: refresh local IDE state and launcher log
> Commit `5d7e472` (2026-05-09): fix(auth): _bootstrapped flag prevents HMR re-runs from firing second refresh() on rotated rt cookie [B16]
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `eaf4feb` (2026-05-12): feat(PLA-0044): useTopologyTreeState sources childrenOf from walkTopology [FE-POR-API-0006]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `1bc9958` (2026-05-13): feat(PLA-0026/SA2): add artefact_adoption_state to vector_artefacts [FE-SQL-0019]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `952cc41` (2026-05-13): plan(PLA-0048): codebase recovery — lock conventions, install drift gates, consolidate SQL [RF1]
> Commit `a8c32ec` (2026-05-14): docs(PLA-0048 / RF1.0): lock hierarchical table + column-prefix naming rules
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `817922b` (2026-05-16): docs: file TD-FILTER-MULTI + URL-state purge backlog item
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `c630ee7` (2026-05-16): chore(plans): merge orphan ACs + sync 00595/00597 done flags
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `9c45ef2` (2026-05-17): chore(tech-debt): triage 2026-05-17 — mark 3 resolved, flag DB-002 trigger
> Commit `8729c54` (2026-05-18): feat(ops): vector-dev swarm stack as infra-as-code + pg_stat_statements
  > Plan `PLA-0038` (2026-05-09): Blocked-state — orthogonal stuck flag with provenance for work items
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
  > Blocked is its own state, **independent of flow state** — an item can be blocked at any point in its workflow. The fact a story is "stuck on dev" tells us nothing about why; the blocked record carries that context. Schema (work-item columns, all nullable except `is_blocked` boolean):
  > - `is_blocked` `BOOLEAN NOT NULL DEFAULT FALSE` — convenience flag for indexing/filters
  > - `blocked_id` `UUID` — surrogate id for the active blocker record (so history can be added later without schema churn)
  > - `blocked_title` `TEXT` — short label, e.g. "Waiting on legal review"
  > - `blocked_description` `TEXT` — free-form detail
  > - `blocked_reason` `TEXT` — short categorisation (later: enum/lookup once patterns emerge)
  > - `blocked_user_reporter` `UUID` — who flagged it blocked
  > - `blocked_user_unblocked` `UUID` — who cleared the block (null while still blocked)
  > - `blocked_date_blocked` `TIMESTAMPTZ` — when the block was raised
  > - `blocked_date_unblocked` `TIMESTAMPTZ` — when the block was cleared (null while still blocked)
  >
  > **Sub-items below.** Webhook event `item.blocked` is a downstream consumer (B1.8.5).
  >
  - **B1.8.1** Migration — add `blocked_*` columns to `artefacts` table `[P2]`
    > Single migration in `db/artefacts_schema/`; index on `(workspace_id, is_blocked) WHERE is_blocked = TRUE` for fast unblocked-list queries.
    >
  - **B1.8.2** Backend — `Block` / `Unblock` service methods on `workitemsv2/service.go` `[P2]`
    > `Block(ctx, subID, itemID, BlockInput)` sets all `blocked_*` fields + `is_blocked=TRUE`, fires `item.blocked` notifier. `Unblock(ctx, subID, itemID)` sets `blocked_user_unblocked` + `blocked_date_unblocked`, flips `is_blocked=FALSE`, fires `item.unblocked`. Both operations leave flow_state_id untouched.
    >
  - **B1.8.3** API routes — `POST /work-items/{id}/block` and `POST /work-items/{id}/unblock` `[P2]`
    > Mounted on v2; OpenAPI spec updated. `block` body: `{title, description, reason}`; `unblock` body: `{}` (server fills user + timestamp).
    >
  - **B1.8.4** UI — block/unblock action on work-item detail panel + visual marker `[P2]`
    > Button on `WorkItemDetailPanel.tsx`; opens small form (title required, description + reason optional). When blocked: panel shows red banner with reporter + date; tree row shows red dot/badge. Unblock action records `blocked_user_unblocked` automatically.
    >
  - **B1.8.5** Webhook event wiring — `item.blocked` + `item.unblocked` `[P3]`
    > Notifier already lists `item.blocked` in `WebhookForm.tsx` dropdown. Add `item.unblocked` to dropdown. Backend fires both from B1.8.2 service methods. (Replaces deferred B9.7 wiring task — track here.)
    >
  - **B1.8.6** Reports — blocked-time on cycle/lead time and "currently blocked" filter `[P3]`
    > Cycle-time/lead-time reports subtract blocked windows. List views get `blocked = true/false` filter. Blocked items surface at the top of stale-work reports.
    >

---

## B2. Sprint & Timebox Management

- ✅ ~~**B2.1** Sprint CRUD — full v2 including create, edit, delete (PLA-0027 + PLA-0030 T2)~~
- ⚠️ **B2.2** Sprint lifecycle (`planning` → `active` → `closed`) `[P2]`

  > `POST /{id}/start` (planned→active) and `POST /{id}/close` (active→completed) are live with atomic UPDATE guards and `ErrStartLifecycle`/`ErrCloseLifecycle` errors. `PATCH` body can still set status freely — B2.2.2 (item-state validation) remains open.
  > Last checked: 2026-05-08
  >

  - ✅ ~~**B2.2.1** `POST /sprints/{id}/start` + `/close` explicit lifecycle actions `[P2]`~~
    > Commit (2026-05-08): `Start`/`Close` on service + handler; `ErrStartLifecycle`/`ErrCloseLifecycle`; notifier fires `sprint.started`/`sprint.closed`; routes wired under `WorkItemsSettingsEdit` permission.
    >
  - **B2.2.2** Validate item state before adding to active sprint `[P3]`
- **B2.3** Sprint goal field `[P3]`
- **B2.4** Sprint velocity tracking `[P3]`
- **B2.5** Burndown snapshot (`GET /sprints/{id}/burndown?date=`) `[P3]`
- **B2.6** Active sprint summary per workspace `[P3]`
- **B2.7** Releases timebox kind `[P4]`

---

## B3. Portfolio & Master Record

- ✅ ~~**B3.1** Master record (`/portfolio/master_record`) — v2 live~~
- ✅ ~~**B3.2** Portfolio layers (`/workspace/{id}/portfolio/layers`) — v2 live~~
- **B3.3** Portfolio items — retiring, consolidating into work items (see M5) `[P3]`
- **B3.4** Subscription layers — legacy, retire once frontend migrated to workspace-scoped v2 `[P3]`
- **B3.5** Portfolio adoption cutover (PLA-0024 / PLA-0026) `[P2]`
- **B3.6** Portfolio models — architectural decision pending (PLA-0030 T6) `[P4]`

---

## B4. Custom Fields

- ⚠️ **B4.1** Custom field library — define field types and options `[P2]`
  > Schema exists (`artefact_field_library`, `artefact_type_fields`), seeding scripts written for DE/US/PI types, and `GET /workspace/{id}/fields` resolver is live. Missing: no UI field manager to add/edit/delete fields without SQL. API-only today.
  > Last checked: 2026-05-08
  >
- ✅ ~~**B4.2** Field schema endpoint (`/workspace/{id}/fields`) — v2 live~~
- ✅ ~~**B4.3** Field values on work item responses~~
  > `ListFieldValues`, `UpsertFieldValues`, `DeleteFieldValue` all live in `backend/internal/workitemsv2/handler.go` — `GET/PUT/DELETE /work-items/{id}/field-values`
  > Last checked: 2026-05-08
  >
- **B4.4** Custom field manager UI `[P3]`
- **B4.5** Item templates with field defaults `[P4]`

---

## B5. Roles & Permissions (RBAC)

- ✅ ~~**B5.1** Data-driven RBAC — `roles` / `permissions` / `roles_permissions` tables~~
  > `backend/internal/roles/service.go` + `permissions/` — full service live
  >
- ✅ ~~**B5.2** 5 seeded system roles (gadmin / padmin / team_lead / user / external)~~
  > Stable UUIDs `ad30/ad25/ad20/ad10/ad05` confirmed in `roles/service.go:31-35`
  >
- ✅ ~~**B5.3** 26 seeded permissions~~
  > `backend/internal/permissions/catalogue.go` — full permission catalogue live
  >
- ✅ ~~**B5.4** `useHasPermission(<code>)` frontend gate~~
  > `app/contexts/AuthContext.tsx:183` — canonical gate; used in multiple components
  >
- **B5.5** Custom role creation and assignment `[P3]`
- **B5.6** Replace stop-gap permission codes with precise codes (TD-PERM-001) `[P3]`
- **B5.7** `api_keys.manage` permission — not yet wired to API key routes `[P3]`
- **B5.8** Capability matrix — single transparent view of role × permission grants `[P2]`
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `fea4fc9` (2026-05-12): feat(PLA-0043): chrome rework — typecase.css, viewport-anchored title, breadcrumbs [FE-POR-0003.1]
> Commit `db60132` (2026-05-13): fix(001_redesign): pin rail + flyout to viewport [FE-POR-0003.1]
> Commit `4d4ec2a` (2026-05-13): feat(PLA-0043): add Vector Admin sub-pages + User Management permissions page [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `2882270` (2026-05-14): chore(nav): grant gadmin + padmin universal page visibility (mig 193)
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `e367266` (2026-05-15): docs: handover — table catalog restyle + permissions tree-lines session
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
  > Today the answer to "what can padmin do?" is spread across `db/schema/088_roles_permissions.sql` + every follow-up migration that touched `roles_permissions` (100, 101, 142, …). Migrations using `WHERE p.code IN (...)` silently no-op when a code isn't in the `permissions` table — exactly why migration 142 reported success but granted nothing for `workspace.archive` / `flows.manage`. Build a read-only SQL view `v_role_capability_matrix` (roles × permissions × roles_permissions join) plus a `/dev/permissions-matrix` page rendering the grid. Highlights ungranted permissions that are referenced by `useHasPermission()` calls but missing from the catalogue.
  >
- **B5.9** Single source-of-truth seed for role capabilities `[P3]`
> Commit `743b077` (2026-05-10): feat(roles): drop MVP single-admin workspace constraint
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `4d4ec2a` (2026-05-13): feat(PLA-0043): add Vector Admin sub-pages + User Management permissions page [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `2882270` (2026-05-14): chore(nav): grant gadmin + padmin universal page visibility (mig 193)
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `9ec3523` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `5b7fac9` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `e367266` (2026-05-15): docs: handover — table catalog restyle + permissions tree-lines session
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
  > Follow-on to B5.8. Consolidate scattered grant migrations (088 / 100 / 101 / 142 / …) into one declarative seed file `db/schema/seeds/role_capabilities.sql` containing the full role × permission matrix. Future grants edit this file; runner reapplies the diff. Removes the silent-noop migration trap and makes "give padmin what gadmin has" a one-line edit.
  >
- **B5.10** Audit `useHasPermission()` codes against catalogue `[P2]`
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `0a2ee86` (2026-05-12): docs(PLA-0044): close out plan — catalogue row + index + plan JSON [FE-DEV-0025]
> Commit `3b1a9d6` (2026-05-13): fix(PLA-0043): sort catalogue items by tag_enum before save to satisfy contiguity rule [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `0d330a7` (2026-05-13): feat(PLA-0043): dev pages as 2nd-rail nav — remove tab strip, register 13 pages in shell catalogue [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `162d382` (2026-05-16): test(catalogue): red — F5 catalogue + chip + localStorage + sidecar [00605]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `37c9929` (2026-05-16): test(priority): red — F9 catalogue + chip + Showstopper [00609]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > `npm run lint:permission-codes` — fails CI if any `useHasPermission("…")` argument or backend `RequirePermission("…")` call references a code not present in `permissions` catalogue. Catches the migration-142-style failure at build time.
  >

---

## B6. Workspace & Topology

- ✅ ~~**B6.1** Workspace config and settings~~ `[P2]`
  > `GET/PATCH /api/tenant-settings` live — `backend/internal/tenantsettings`; backed by `master_record_tenant` in `vector_artefacts` (M2). Full field set: name, description, timezone, date/datetime formats, workdays, week start, rank method, build-changeset tracking, notes, data region, primary contact email. Frontend: `/workspace-settings/organization` — full form with UnsavedChangesBar, client+server 422 validation. `PATCH /workspaces/{id}` rename also live.
  > Last checked: 2026-05-09
- ✅ ~~**B6.2** Org node tree~~ `[P2]`
  > `TopologyTreeFlyout` live — tree flyout rail with collapse/expand, inline rename, context menu, archive-map. Data via `topologyApi.tree()` → `/samantha/v2/topology/tree`. ETL complete (M6.3.5 — 58 nodes migrated). TS clean.
- ✅ ~~**B6.3** Topology canvas page~~ `[P3]`
  > Full React Flow canvas at `/workspace-settings/topology` (embedded) and `/(overlay)/topology` (full-viewport). dagre layout, workspace clamp, context menu, edit flyout, archive flyout, move-preview modal, sandbox/live mode toggle. All calls on v2 (M6.1). TS clean.
- ✅ ~~**B6.4** Workspace role assignments~~
  > `GrantRole` + `RevokeRole` live in `backend/internal/workspaces/roles.go` — `POST/DELETE /workspaces/{id}/members/{userId}/roles/{roleId}`
  > Last checked: 2026-05-08
  >
- ✅ ~~**B6.5** Workspace-scoped field schema — v2 live~~
- ✅ ~~**B6.6** Retire legacy org_* tables~~
  > Migration 138: `org_nodes`, `org_levels`, `org_node_roles` dropped from mmff_vector. No backend consumers since M6.2.7 cutover (verified by grep audit). Zero rows since cutover date. Applied 2026-05-09.
  > Last checked: 2026-05-09
  >
- ✅ ~~**B6.7** Fix padmin role access to workspace-settings~~
  > padmin role was unable to save navigation preferences due to workspace-settings being gadmin-only but default_pinned=TRUE. Fixed via: (1) Migration 140 grants padmin access to workspace-settings in roles_pages table, (2) Migration 141 restores workspace-settings.default_pinned = TRUE so padmin sees it in defaults. The earlier migration 139 (default_pinned=FALSE) was the wrong approach and is now superseded.
  > Last checked: 2026-05-09
  >
- ✅ ~~**B6.8** Per-user node-permission grid page — gadmin "Topology Permissions" surface `[P2]`~~
  > Rally-validated user-pivot pattern (R054 §user-detail): pick one user → see every node they hold a grant on, edit role per row in one place. `UserNodeAssignment` (PLA-0044 / FE-POR-0003.9.10) is the row primitive; this entry is the page that hosts it. Two-pane: left = workspaces the user has any grant in, right = nodes within the selected workspace (checkbox + role dropdown per row). Quick filters across roles (admin / editor / viewer / no access). Single visible-tree indent — no inline `style={{}}` (use depth modifier classes per .scope-picker pattern). Persistence calls `POST /api/topology/nodes/{id}/roles` to grant and `DELETE /api/topology/roles/{grant_id}` to revoke; row writes are atomic, no batching.
  > Last checked: 2026-05-12
  >
  > Plan `PLA-0046` (2026-05-12): Topology Permissions page — gadmin user-pivot surface hosting UserNodeAssignment (B6.8) — shipped: backend `ListGrantsByUser` + dual-mount handler, `topology.grants.manage_others` permission (migration 147 on gadmin), frontend page at `/workspace-settings/users/[userId]/topology-permissions` reached via entry button on the Users row-expand. Single-role MVP; per-row role dropdown deferred.
  >
- **B6.9** Workspace setting — "Default node access for new users" `[P3]`
> Commit `2882270` (2026-05-14): chore(nav): grant gadmin + padmin universal page visibility (mig 193)
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
> Commit `5ccef56` (2026-05-18): feat(migration): users_reauth_nonces table for step-up reauth [B16.8.10]
  > Rally-validated seed mechanism (R054 §N2): one workspace-level enum `{none, viewer, editor}` (default `none`). When a user is created inside a workspace, the user-creation path issues a grant at this level on the workspace root node so the user is never in a permission vacuum. Adds a column to `master_record_tenant` (the tenant-settings substrate, see B6.1) plus a hook in the user-create service. Distinct from grant-inheritance: this is a per-user seed at creation time, not a live cascade.
> Commit `66a7e32` (2026-05-18): docs(security): clarify 15-min access TTL is defense in depth [B16.8.9]
  >
> Commit `8825bab` (2026-05-13): feat(PLA-0043): add Workspace Admin / User Management / Vector Admin nav entries [FE-POR-0003.1]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `1cbe497` (2026-05-13): chore(PLA-0023): drop shadow master_record_tenant from mmff_vector [P2]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `7773c95` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_sessions (§2.3) [RF1.4.4.users_sessions]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `d28b2f5` (2026-05-14): refactor(nav): final bucket reshape per Rick's locked spec (mig 192)
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `35ecd8d` (2026-05-16): feat(vector_artefacts): green — backfill artefacts_types_slot per workspace [00583]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
- **B6.10** Opt-in one-shot copy-grants on child-node creation `[P3]`
> Commit `fea4fc9` (2026-05-12): feat(PLA-0043): chrome rework — typecase.css, viewport-anchored title, breadcrumbs [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `2882270` (2026-05-14): chore(nav): grant gadmin + padmin universal page visibility (mig 193)
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `f50f4c3` (2026-05-16): feat(stories): auto-provision tracker groups via rg-runner -create-if-missing
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
  > Rally-validated cascade primitive (R054 §hierarchy): the **only** built-in parent→child propagation in Rally is a Yes/No field on the child-create form that defaults to No; when Yes, the parent's user-permission rows are copied to the new child as a single background operation, after which grants drift independently. Vector's grant-inherits-down (PLA-0043 §FE-POR-0003.3) already covers the runtime read clamp, so this entry covers the explicit-grant-row copy for cases where the admin wants discoverable per-node grants without relying on inheritance. Surface: a single checkbox on the topology-canvas "create child" dialog; if checked, `Service.CreateChildNode` enqueues `Service.CopyGrantsToNode(parentID, newChildID)` as a follow-up step.
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
  >
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
- **B6.11** Bulk grant CSV import/export `[P4]`
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `2882270` (2026-05-14): chore(nav): grant gadmin + padmin universal page visibility (mig 193)
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
  > Rally-validated bulk pattern (R054 §bulk): in-product UI does per-user grant only; bulk lives in CSV templates consumed by an external toolkit. Vector ships the same: a per-user CSV download on the B6.8 page (current grant set across the active workspace), plus a gadmin-only `/dev` panel that accepts a CSV (cols: `user_email,workspace_id,node_id,role`) and runs it through `Service.GrantRoleBatch`. Validation rules: caller is gadmin or workspace-admin; reject row if user doesn't exist or node is archived; report row-level success/fail in the response. Distinct from `RallyTools/Rally-User-Management` (Rally's external Ruby toolkit, R054 §sources [5]): Vector keeps the bulk path inside the app to avoid the "drives the web UI under the hood" hack Rally's toolkit had to adopt because the WSAPI never opened permission writes (R054 §CORRECTION C1).
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `9ec3523` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `5eba458` (2026-05-16): fix(test): bulk set_priority payload uses priority_id UUID [00595,00597 fixup]
  >
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `5b7fac9` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
- **B6.12** Node re-parent permission policy — preserve / replace / merge `[P3]`
> Commit `f515b71` (2026-05-13): fix(001_redesign): rail click + bottom util visibility [FE-POR-0003.1]
> Commit `db60132` (2026-05-13): fix(001_redesign): pin rail + flyout to viewport [FE-POR-0003.1]
> Commit `0bf13ed` (2026-05-13): feat(001_redesign): bounce-in animation for rail active indicator [FE-POR-0003.1]
> Commit `fee4481` (2026-05-13): feat(001_redesign): slide-down bounce for rail active indicator [FE-POR-0003.1]
> Commit `b5c4831` (2026-05-13): feat(001_redesign): travelling rail indicator — stretch then elastic settle [FE-POR-0003.1]
> Commit `05cead9` (2026-05-13): fix(001_redesign): nav-v2 route corrections + travel indicator anchor [FE-POR-0003.1]
> Commit `3790542` (2026-05-13): feat(PLA-0043): persist mixed tag+group bucket order per nav profile [FE-POR-0003.1]
> Commit `4d4ec2a` (2026-05-13): feat(PLA-0043): add Vector Admin sub-pages + User Management permissions page [FE-POR-0003.1]
> Commit `545ebbd` (2026-05-13): feat(PLA-0043): tag bucket icon overrides in nav preferences [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `0d330a7` (2026-05-13): feat(PLA-0043): dev pages as 2nd-rail nav — remove tab strip, register 13 pages in shell catalogue [FE-POR-0003.1]
> Commit `b8d1e66` (2026-05-13): fix(PLA-0043): dev_tools nav — auto-pin pages, Research first, remove hardcoded gear link [FE-POR-0003.1]
> Commit `e8046c4` (2026-05-13): fix(PLA-0043): restore dev gear icon in rail util tray [FE-POR-0003.1]
> Commit `0941095` (2026-05-13): feat(PLA-0043): rail icon click navigates to first page of section [FE-POR-0003.1]
> Commit `5e06f7d` (2026-05-13): style: remove border from .panel — borderless card surface [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `ed446dd` (2026-05-13): fix(001_redesign): hide admin groups from Available when already in Pinned [FE-POR-0003.1]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `4411327` (2026-05-13): feat(PLA-0026/SA1): remove legacy vectorPool saga writes — VA is now sole write path [FE-POR-0003]
> Commit `a998fc5` (2026-05-13): refactor(PLA-0044): remove legacy AppSidebar_2 component — superseded by redesign two-rail nav
> Commit `a8c9c3a` (2026-05-13): refactor(PLA-0044): rename rd-topbar → nav-top-bar — CSS naming convention [FE-UI-0001]
> Commit `376cfef` (2026-05-13): refactor(PLA-0044): nav-primary-rail-1 — fix 6 CSS naming violations [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `2882270` (2026-05-14): chore(nav): grant gadmin + padmin universal page visibility (mig 193)
> Commit `a6db775` (2026-05-14): fix(nav): AccountFlyout only shows avatar_menu tag, not rail-1 admin buckets
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `5bab6ec` (2026-05-15): feat(pageaccess): PLA-0049 Phase 1.5 + Phase 2 — toast + seed capture [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `e367266` (2026-05-15): docs: handover — table catalog restyle + permissions tree-lines session
> Commit `74e54f8` (2026-05-16): memory: add foundation-mode, design-collab, URL-path-only, system-vs-display rules + git stash ban
> Commit `6f51bd0` (2026-05-16): feat(redesign): swap V text brand for /logo-vector.png in primary rail
> Commit `c630ee7` (2026-05-16): chore(plans): merge orphan ACs + sync 00595/00597 done flags
> Commit `72f2430` (2026-05-16): feat(tree): per-row cog menu in dense tree (edit/duplicate/move/split/delete)
> Commit `481407b` (2026-05-16): feat(001_redesign): share travel-indicator across both nav rails [FE-POR-0003.1]
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `ddbca1f` (2026-05-18): feat(login): redesigned login page with quiet sidebar layout
> Commit `1a5abc5` (2026-05-18): feat(login): pixel-perfect redesigned login matching design mockup
> Commit `31feaed` (2026-05-18): feat(login): complete redesign — welcome (left) + form (right) layout
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `29b394d` (2026-05-18): feat(login): redesign with horizontal two-column layout
> Commit `28a4c8e` (2026-05-18): fix(login): remove duplicate logo from beige panel
> Commit `fa5bd5b` (2026-05-18): fix(login): move vertical Vector into left white column, beige sidebar to center
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
  > Rally documentation gap (R054 §addendum-gaps): Broadcom's "Change an Existing Project to a Child Project" page describes the UI flow but is silent on what happens to the project's existing user-permission rows on move (preserved? replaced with new parent's? merged?). Vector must make an explicit decision before any node-move surface ships. Default proposal: **preserve** grants (move is a re-pointing of `parent_id`, grant rows reference `node_id` and are unaffected) with an optional "also copy parent's grants to this node" checkbox on the move dialog (re-uses B6.10's copy primitive). Decision needs design sign-off before stories file.
> Commit `9c29056` (2026-05-13): feat(001_redesign): Layout 04 shell — icon rail + section flyout at /redesign
> Commit `01347cf` (2026-05-13): feat(001_redesign): swap (user) layout to redesign shell — rail + flyout live site-wide
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
  >

---

## B7. Search

> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
- ⚠️ **B7.1** Background search worker — indexes text + vector embeddings `[P2]`
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]

  - ✅ ~~**B7.1.1** Worker is currently a no-op after DB migration — must be rewired to new DB~~

  > Rewired: `worker.go` now reads `artefacts_search_outbox` in `vector_artefacts` (vaPool). Migration `035_search_outbox.sql` adds `search_index` (tsvector), `content_embedding` (vector(768)), outbox table + enqueue trigger. `main.go` guards with `if vaPool != nil`. Pending: migration applied on dev + Ollama running.
  > Last checked: 2026-05-08
  >
- ✅ ~~**B7.2** `POST /search` query endpoint `[P2]`~~

  > `backend/internal/search/` — fulltext via `plainto_tsquery` on `search_index`, ranked by `ts_rank`. Optional `type_ids` filter. 100-result cap. Route mounted under `/api/v2/search` (auth + rate-limit); graceful 503 when vaPool unavailable.
  > Last checked: 2026-05-08
  >
- **B7.3** Vector similarity reranking `[P4]`

---

## B8. Public API & Integrations

- ✅ ~~**B8.1** API keys — scoped, revokable, usage tracking~~
  > `backend/internal/apikeys/` — full package; `Issue`, `List`, `Revoke` endpoints live at `/api-keys/*`; `SeedDevKey` seeder; middleware wired on v2 routes (`main.go:788`)
  >
- ✅ ~~**B8.2** Rate limiting — per IP and per user~~
  > `httprate.LimitByIP` on all route groups + `security.LimitByUserOnWrites` per-user write limiter (`main.go:404`)
  >
- ✅ ~~**B8.3** OpenAPI v2 spec (`openapi-v2.yaml`) — live~~
- **B8.4** TypeScript SDK `[P4]`
- **B8.5** Python SDK `[P5]`
- **B8.6** Postman collection `[P4]`
- **B8.7** Idempotency keys on mutating public endpoints `[P2]`
  > `Idempotency-Key` request header → server stores `(tenant_id, key, response_body, status_code)` for 24h and replays on retry. Stripe model. Required before any external integration ships, otherwise consumers with retry loops double-create. Scope: every POST/PATCH/DELETE on `/samantha/v2`. Storage: new `idempotency_records` table in `vector_artefacts` keyed on `(tenant_id, key)` with TTL cleanup. Middleware fires before handler; cache hit short-circuits. Exempt from BFF / admin surface.
> Commit `8264471` (2026-05-13): refactor(PLA-0044): delete legacy PageHeaderBar + dead page-header CSS [FE-UI-0001]
> Commit `90a1c04` (2026-05-16): fix(PageSummaryHeader): suppress help icon on the inner Panel
> Commit `36a15a6` (2026-05-17): feat(page-summary): add danger tone to SummaryCellTone (TD-SUMMARY-TONE)
- **B8.8** Cursor-based pagination on list endpoints `[P2]`
> Commit `fea4fc9` (2026-05-12): feat(PLA-0043): chrome rework — typecase.css, viewport-anchored title, breadcrumbs [FE-POR-0003.1]
> Commit `9e4422d` (2026-05-17): feat(tree): paginationPosition prop on ResourceTree (both|bottom) [B21]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
  > Replace offset/limit on every public list endpoint with stable cursors (`next_cursor` token over `(sort_key, id)` tuple). Offset breaks under concurrent inserts; cursors are stable. Scope: `/work-items`, `/portfolio-items`, `/timeboxes/sprints`, `/work-items/relations`, `/webhooks` listing. Cursor is opaque base64 of the last-row sort tuple. Required before any tenant exceeds ~10k items in a list. B19.1.5 (graph 100k truncation) becomes a special case of this rule.
- **B8.9** Sparse fieldsets — `?fields=id,title,status` on every list/get endpoint `[P3]`
> Commit `e8046c4` (2026-05-13): fix(PLA-0043): restore dev gear icon in rail util tray [FE-POR-0003.1]
> Commit `d60981e` (2026-05-16): fix(plans-panel): query param typo + defensive array guards
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
> Commit `7839d3d` (2026-05-18): feat(auth): stamp + validate JWT iss/aud claims [B16.8.8]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
  > Lets integrators avoid hauling full DTOs over the wire on large lists. REST equivalent of GraphQL field selection. Implementation: comma-separated allow-list parsed in middleware, applied as a SELECT projection or post-marshal mask. Scope: every `GET` on `/samantha/v2`. TD-API-001 item 4 (GraphQL deferred) — sparse fieldsets are the chosen substitute.
> Commit `10eea24` (2026-05-12): feat(theme-classic): restore historic Theme Maker at /theme-classic
> Commit `e367266` (2026-05-15): docs: handover — table catalog restyle + permissions tree-lines session
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
- **B8.10** Per-tenant API keys with scoped permissions `[P2]`
> Commit `761d7cd` (2026-05-09): fix(B22): DevPageHelpPanel — apiSite import + strip stale /api/ prefix
> Commit `4efd532` (2026-05-12): fix(dev): drop accidental /api prefix from page-help admin calls
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `098ccbb` (2026-05-12): feat(PLA-0044): layoutWithDagre delegates visibility walk to walkTopology [FE-POR-API-0006]
> Commit `eaf4feb` (2026-05-12): feat(PLA-0044): useTopologyTreeState sources childrenOf from walkTopology [FE-POR-API-0006]
> Commit `6857913` (2026-05-12): feat(PLA-0044): TopologyTreeFlyout rows come from walkTopology [FE-POR-API-0006]
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `4d4ec2a` (2026-05-13): feat(PLA-0043): add Vector Admin sub-pages + User Management permissions page [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `1cbe497` (2026-05-13): chore(PLA-0023): drop shadow master_record_tenant from mmff_vector [P2]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `5bdf3be` (2026-05-13): docs(PLA-0030): document 5 missing /samantha/v2 routes in openapi-v2.yaml
> Commit `2e9ff2d` (2026-05-13): chore: memory rule + 4 deferrals filed in tech-debt register [TD-AUTH-001 TD-API-002 TD-API-003 TD-API-004]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `a8c32ec` (2026-05-14): docs(PLA-0048 / RF1.0): lock hierarchical table + column-prefix naming rules
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `b4627dd` (2026-05-14): docs(PLA-0048 / RF1.4.4): file TD-NAME-001 for deferred column-prefix sweeps [RF1.4.4]
> Commit `d00e3d1` (2026-05-14): chore(PLA-0048 / RF1.4.4): ship lint:column-prefix-convention (warn-only) [RF1.4.4]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7773c95` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_sessions (§2.3) [RF1.4.4.users_sessions]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `e367266` (2026-05-15): docs: handover — table catalog restyle + permissions tree-lines session
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `aede1dd` (2026-05-18): fix(login): shift welcome column up 100px
> Commit `a709b37` (2026-05-18): fix(login): shift welcome column up another 100px (total 200px)
> Commit `29b394d` (2026-05-18): feat(login): redesign with horizontal two-column layout
> Commit `4851c50` (2026-05-18): feat(login): add black logo column on left (200px)
> Commit `fa5bd5b` (2026-05-18): fix(login): move vertical Vector into left white column, beige sidebar to center
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
  > Extend B8.1 (`apikeys` package) so each `sam_live_*` key carries a permission set that is a subset of the issuing user's permissions (e.g. `read:items`, `write:items`, `admin:roles`). Currently keys are flat — any key has the full scope of its owner. Scope: schema migration adds `api_keys.scopes jsonb` column; auth middleware honours scope set on every request; key-issuance UI lets admin pick scopes at creation; revoke unchanged. Pre-req for n8n trigger nodes (B12.1) since those need narrow read-only keys.
> Commit `1cb8b7d` (2026-05-11): refactor: tenant-aware subtitle on Vector Admin tab
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `cc38e98` (2026-05-12): docs(PLA-0043): handover for cross-machine continuation [FE-POR-API-0002]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `bb18aa4` (2026-05-12): feat(PLA-0044): walkTopology Go mirror + cross-runtime parity tests [FE-POR-API-0006]
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `ea4862c` (2026-05-12): fix(PLA-0044): ScopeRail uses walkTopology + byPosition — kills phantom-D orphan re-root [FE-POR-API-0006]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]

> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `6513cfd` (2026-05-09): fix(B22): dynamic ID column width tracks max visible depth in ResourceTree
> Commit `3f0dbbe` (2026-05-09): fix(B22): fix dynamic ID column — re-fit on width change, floor at declared width
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
Backend + UI live; worker running. New event types under B9.7+ extend the catalogue.
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy

- ✅ ~~**B9.1** Webhook subscriptions table — URL, event filter, secret~~
  > `db/artefacts_schema/037_webhooks.sql` — `webhook_subscriptions` + `webhook_deliveries` tables; CRUD API at `GET/POST /workspaces/{id}/webhooks` + `GET/PATCH/DELETE /workspaces/{id}/webhooks/{webhookId}`; secret auto-generated (32-byte random hex) if not supplied
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
  >
- ✅ ~~**B9.2** Outbox delivery pattern~~
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
  > `webhook_deliveries` outbox table; `Enqueue` fans out to all matching active subscriptions; FOR UPDATE SKIP LOCKED claim
  >
- ✅ ~~**B9.3** Retry worker — exponential backoff, 24h window~~
  > `backend/internal/webhooks/worker.go` — exponential backoff (base 30s, cap 6h), up to 10 attempts; started via `go webhooks.NewWorker(vaPool).Run(shutdownCtx)` alongside search worker
  > Last checked: 2026-05-09 — worker started without errors post-migration 037
  >
- ✅ ~~**B9.4** Events: `item.created/updated/deleted`, `item.status_changed`, `sprint.started/closed` `[P1]`~~
  > All six events wired: `item.*` via `workitemsv2/service.go`; `sprint.started`/`sprint.closed` via `timeboxsprints/service.go`. Notifier pattern throughout — nil-safe, non-blocking.
  > Last checked: 2026-05-08
  >
- ✅ ~~**B9.5** Webhook management UI `[P2]`~~
  > `app/(user)/workspace-settings/webhooks/page.tsx` + `WebhookForm.tsx` — full CRUD UI at workspace-settings/webhooks tab; list view with URL/events/status columns; create/edit/delete actions; event filter dropdown (all events or specific types); secret show/hide toggle. Integrated into workspace-settings navigation as default-pinned tab. Backend API fully consumed.
  > Commit `9256433` (2026-05-09): feat(B9.5): webhook management UI at workspace-settings/webhooks
  > Last checked: 2026-05-09
  >
- ✅ ~~**B9.6** `X-Vector-Signature` HMAC header for consumer verification~~
  > `webhooks/worker.go:sign()` — HMAC-SHA256 of payload body keyed on subscription secret; sent as `X-Vector-Signature: sha256=<hex>`
  >
- **B9.7** `item.blocked` / `item.unblocked` event wiring → tracked under B1.8.5 (blocked-state feature) `[P3]`
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `5d7e472` (2026-05-09): fix(auth): _bootstrapped flag prevents HMR re-runs from firing second refresh() on rotated rt cookie [B16]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > UI dropdown in `WebhookForm.tsx` lists "Item blocked" today but no fire site exists. The orthogonal blocked-state model (separate from flow state, with its own provenance fields) lives under B1.8; the webhook fire happens from the `Block`/`Unblock` service methods in B1.8.2.
  >

---

## B10. Async Jobs & Reporting

- **B10.1** Async job infrastructure — 202 Accepted + poll by job ID `[P2]`
- **B10.2** Burndown report `[P3]`
- **B10.3** Cumulative flow report `[P3]`
- **B10.4** Cycle time report `[P3]`

---

## B11. Real-Time & Async Push

- ✅ ~~**B11.1** Adoption SSE (`/adopt/stream`) — live; only real-time surface today~~
  > `backend/internal/errorsreport/adopt_stream.go` — confirmed live SSE endpoint
  > Last checked: 2026-05-08
  >
- **B11.2** General-purpose pub/sub — design decision pending `[P3]`
- **B11.3** Live board updates (item changes visible to other users) `[P3]`
- **B11.4** In-app notifications `[P3]`

---

## B12. n8n Integration

Depends on: B9 (webhooks) + B8.1 (API keys).

- **B12.1** n8n trigger node `[P3]`
- **B12.2** n8n action node `[P3]`
- **B12.3** API key credential type `[P3]`
- **B12.4** Community node package on n8n marketplace `[P4]`

---

## B13. Library & Portfolio Models

- ✅ ~~**B13.1** Library DB (`mmff_library`) — read-only pool~~
  > `main.go:124` — `mmff_library` read-only pool wired; consumed by `libraryreleases`, `errorsreport`, and reconciler packages
  > Last checked: 2026-05-08
  >
- **B13.2** Portfolio templates `[P3]`
- **B13.3** Library releases `[P4]`
- **B13.4** Tier-gated presets `[P4]`
- **B13.5** Cross-DB adoption mirrors `[P3]`
- **B13.6** Adoption orchestrator `[P3]`

---

## ✅ ~~B14. Addressables & Page Help~~

- ✅ ~~**B14.1** Panel / Table / Navigation addressable substrate~~ `[P2]`
  > `useRegisterAddressable` adopted in `Panel`, `Table`, `ResourceTree`, `Header`; `DomRegistryProvider` wraps app root; snapshot hydrated from `/api/addressables/snapshot` on first render.
- ✅ ~~**B14.2** Addressing scheme (`samantha._viewport.<slot>._kind.name`)~~ `[P2]`
  > `ViewportSlot` (six closed slots), `buildAddress` helper, `StrictRoute` opt-in gate — all live in `DomRegistryContext.tsx`. Lint rule `lint:addressables` enforces sole-writer. R049 research complete.
- ✅ ~~**B14.3** `addressables.Service` sole-writer boundary~~ `[P2]`
  > `backend/internal/addressables/service.go` — five methods; `boundary_test.go` CI-enforced regex; `lint:addressables` python script.
- ✅ ~~**B14.4** Samantha SDK help contract~~ `[P3]`
  > `samantha.contract.ts`, `SamanthaSdkContext.tsx` — help fetched from `/api/page-help/:id` in `Panel`; lazy-seeded from `library_help_defaults`; `helpable` bit per row.
- ✅ ~~**B14.5** Admin-managed contextual help per panel~~ `[P3]`
  > `PUT/DELETE /api/page-help/admin/:id`; `PATCH /api/addressables/admin/:id/helpable`; gadmin editor live.

---

## ✅ ~~B15. UI Primitives & Design System~~

- ✅ **B15.1** `<Table>` component — single sanctioned table primitive `[P2]`
  > `app/components/Table.tsx` — canonical primitive (657 LOC); `lint:no-raw-table` enforcement; 4 tree exceptions on allow-list; spec: `docs/c_c_table_component.md`
- ✅ **B15.2** `<ResourceTree>` / `ObjectTree` — hierarchical tree + configuration registry `[P2]`
  `[x] Generic dumb primitive (p_ObjectTree.tsx); pluggable data-type config via object-tree-registry.tsx; ready for releases/sprints/portfolio items`
  > `app/components/ResourceTree.tsx` (1554 LOC); five prop sets (Data/Scaffold/Features/CogMenu/Colour); addressable substrate; spec: `docs/c_c_resource_tree.md`
- **B15.2.5** Sidecar wizard JSON pattern (`p_wizard_*.json`) `[P2]`
  > Each `p_*` primitive component reads its config from a sibling JSON file in `app/components/<primitive>/configs/`. Static config (UI labels, columns, dnd type, **resourceUrl**, **scope**, panel header / filter chip selectors) lives in JSON; runtime closures (accessors, hooks, React nodes) injected by the page via `resolveWizardConfig()`. Goal: non-technical users configure components by editing JSON, no TypeScript. First adopter: `p_ObjectTree` with `p_wizard_workitems.json` + `p_wizard_portfolio.json`. Spec to write: `docs/c_c_wizard_sidecar.md` (tracked under B21.3.3).
- ✅ **B15.3** `<Badge>` — status / count / letter / tag variants `[P2]`
> Commit `3dc9cdd` (2026-05-09): chore(plans): normalise unicode escapes in PLA plan files
> Commit `816fbf7` (2026-05-12): chore: mcp whisper stdio type + theme slot-name sanitisation
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `952cc41` (2026-05-13): plan(PLA-0048): codebase recovery — lock conventions, install drift gates, consolidate SQL [RF1]
> Commit `d00e3d1` (2026-05-14): chore(PLA-0048 / RF1.4.4): ship lint:column-prefix-convention (warn-only) [RF1.4.4]
> Commit `7773c95` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_sessions (§2.3) [RF1.4.4.users_sessions]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `44f56a1` (2026-05-16): chore(claude): post-edit lint hook, dev-env lockdown, postgres MCP wrapper
> Commit `162d382` (2026-05-16): test(catalogue): red — F5 catalogue + chip + localStorage + sidecar [00605]
> Commit `955d421` (2026-05-16): chore(claude): un-gitignore .claude/settings.json — single-user multi-machine sync
> Commit `c630ee7` (2026-05-16): chore(plans): merge orphan ACs + sync 00595/00597 done flags
> Commit `6bbaa70` (2026-05-16): chore(plans): stamp dates + flip backlog/AC status for PLA-0053/0054/0055
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
  > `app/components/Badge.tsx` — semantic tone derivation (status + domain maps); pill CSS family; spec: `docs/c_c_badge.md`
> Commit `0ffe20d` (2026-05-09): chore: refresh local IDE state and launcher log
> Commit `6d568c0` (2026-05-12): docs(PLA-0044,PLA-0045): plan JSONs for /dev Plans tab + story-index bump to 00549 [FE-DEV-0025]
> Commit `0a2ee86` (2026-05-12): docs(PLA-0044): close out plan — catalogue row + index + plan JSON [FE-DEV-0025]
> Commit `1bc9958` (2026-05-13): feat(PLA-0026/SA2): add artefact_adoption_state to vector_artefacts [FE-SQL-0019]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
- ✅ **B15.4** `<TimeboxManager>` — sprints + releases surface `[P2]`
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `32002b3` (2026-05-12): docs(R054): Rally user-to-project assignment UX research
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
  > `app/components/TimeboxManager.tsx` (369 LOC) — generic `kind` system (sprint/release); table-per-kind via `kinds.ts` registry; spec: `docs/c_c_timebox_manager.md`
> Commit `1e010e2` (2026-05-12): chore(scope): Vector_Scope progress sweep + PLA-0022 date bump + R051 research entry
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
- ✅ **B15.5** `<DiagramCanvas>` — Canvas2D + dagre + d3-zoom `[P3]`
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `96b7f25` (2026-05-12): docs(research): R052 Rally scope mechanics + R053 Rally/Jira/ADO comparison; backfill PLA-0042.md
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
  > Spec: `docs/c_c_diagram_canvas.md` — Vector-built Canvas2D + dagre layout + d3-zoom; 10px snap-to-grid default; pluggable node renderer; exposed via Samantha API as `samantha.diagram.canvas`
- ✅ **B15.6** Drag-and-drop (`@dnd-kit`) `[P2]`
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
  > `@dnd-kit/core` + `@dnd-kit/sortable` installed; canonical DnD library; sortable lists/tables/tabs; server is order of truth (250ms debounce); no competing libs; spec: `docs/c_c_dnd.md`
- ✅ **B15.7** Theme pack system `[P3]`
  > CSS variable theming live; warm neutrals palette per Design System; color derivation in Badge, Table, tree styles
- ✅ **B15.8** Dev-UI primitives (`.dui-*` catalog for internal pages) `[P3]`
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
  > `dev/styles/dev-ui.css` — `.dui-*` catalog live; HARD RULE: every `/dev` panel composes from catalog, no bespoke per-page classes, no inline styles; spec: `docs/c_c_dev_ui_primitives.md`
- ✅ **B15.9** CSS table migration — legacy `.table*` → canonical classes `[P3]`
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
  > Legacy `.table*` family deprecated 2026-05-05; migration to canonical classes bundled with file changes; `.tree_accordion-dense__*` is the canonical table family
- ✅ **B15.10** Vertical nav primitive unification — `.sidebar-item` / `.sidebar-section` are sole-source for every vertical nav surface `[P2]`
  > `app/globals.css` — `--nav-item-height`, `--nav-item-padding-x`, `--nav-section-padding`, `--nav-section-margin-top` CSS custom properties; defaults set on `.app-sidebar-container`; `.anav` ToC rail inherits the same primitives so a single edit propagates everywhere; bespoke `.anav__link` / `.anav__item` visual rules deleted. `PageAnchorNav.tsx` rewritten to emit `<p class="sidebar-section">` for depth-0 headers and `<button class="sidebar-item">` for depth-1+ links. HARD RULE documented in `docs/css-guide.md`.
  > Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
- ✅ **B15.11** `<PageContent>` wrapper primitive — anchors sticky-nav top gap across L2/L3/L4+ stacks `[P2]`
  > `app/components/PageContent.tsx` — every leaf `page.tsx` under `app/(user)/**` wraps body in `<PageContent>`; the 32px gap below the last sticky nav bar lives on `.page-content` (padding-top), scales to any nav depth without per-level CSS rules.
  > Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
  > Commit `4995027` (2026-05-12): fix(css): sticky TOC rail + section anchors clear L2+L3 nav stack
> Last checked: 2026-05-12

---

## B16. Security & Auth

- ✅ ~~**B16.1** JWT access + refresh tokens~~
- ✅ ~~**B16.2** CSRF protection~~
  > `security.CSRF` middleware wired (`main.go:437`); `X-CSRF-Token` header enforced; double-submit cookie pattern
  >
- ✅ ~~**B16.3** Per-IP + per-user write rate limiting~~
  > See B8.2 — same implementation
  >
- ✅ ~~**B16.4** API key auth — scoped, revokable~~
  > See B8.1 — same implementation
  >
- ✅ ~~**B16.5** Client IP extraction~~
  > `backend/internal/security/clientip.go` — `ClientIP()` helper confirmed live
  > Last checked: 2026-05-08
  >
- ✅ ~~**B16.6** Security checklist (Trust-No-One)~~
  > `docs/c_security.md` — Trust-No-One checklist document confirmed
  > Last checked: 2026-05-08
  >
- **B16.7** Backend security audit — systematic pass of all ~1300 routes against the backend validation checklist (`docs/c_c_backend_validation.md`): tenant_id from session only, user_id/role from session only, every payload resource ID re-verified against DB before write, permission check before every data-modifying operation, cross-tenant lookups return 404 not 403, errors flow through `errors_codes`. Required for SOC 2 / FedRAMP / PCI-DSS procurement audit readiness. Triggered by discovery that `SetActiveScope` was writing an arbitrary node_id without confirming the caller held a grant on that node. `[P1]`

- ✅ ~~**B16.8** Security hardening~~ — DONE 2026-05-18. All five phases shipped today. — full-stack codebase-grounded remediation before first external user. Five phases. ✅ **P1 done 2026-05-18** — MFA/TOTP shipped (B16.8.1–.5), session idle timeout via per-request `users_sessions` JOIN (B16.8.6 + B16.8.11), cookie flags hardened (B16.8.7), JWT `iss`/`aud` claims (B16.8.8), access-token TTL doc'd as defense-in-depth (B16.8.9), active sessions UI + step-up reauth (B16.8.10), WebSocket session enforcement (B16.8.12). ✅ **P2 done 2026-05-18** — CSP nonces enforced (TD-SEC-CSP-NONCES-SRI + TD-SEC-CSP-STYLE-INLINE both closed), DOMPurify wraps on `Header.tsx` + `HelpDocRenderer.tsx` (defense-in-depth over backend `SanitiseHelpBodyHTML` allowlist). ✅ **P3 done 2026-05-18** — Sentinel coordination layer (`app/contexts/Sentinel.tsx`): module-level `scopeReloadRef` registered by `ScopeContext` on every render, awaited by `AuthContext.switchWorkspace` after `applyLogin`; closes the JWT/scope desync window observed in DebugPanel; 6 f-sentinel tests green; tighter than the written plan (catalogues + `useActiveWorkspace` already coordinated correctly via existing `useActiveWorkspace`, no shims needed). ✅ **P4 done 2026-05-18** — HIBP k-anonymity breach-password check shipped (`backend/internal/auth/hibp.go`) gated by `HIBP_CHECK_MODE={disabled|telemetry|enforce}` (default disabled, fail-open on network errors, 3s timeout, `Add-Padding: true` for traffic-analysis resistance); wired into `ChangePassword` + both `ConfirmPasswordReset*` paths via `s.CheckPasswordNotBreached(ctx, newPwd, userID)`; new `Problem.Code=breached_password` + `AuthBreachedPassword` user message for enforce mode; 7 unit tests pinning prefix/suffix wire format, padded-row safety, non-200 / network / malformed-count error paths. Account lockout was already implemented (`failed_login_count`/`locked_until` on `users` + `LOCKOUT_THRESHOLD=5` + `LOCKOUT_DURATION=15min`) since the early auth phase. Redis-backed rate limiter deferred — current single-process `httprate.LimitByIP` is correct for the dev tier; trigger filed as TD-SEC-REDIS-DEPENDENCY (multi-replica deployment). Rollout to enforce filed as TD-SEC-HIBP-PROMOTE-TO-ENFORCE. ✅ **P5 done 2026-05-18** — Console-log audit: dropped 3 noisy debug calls in `app/contexts/ScopeContext.tsx`; 6 placeholder `console.log` handlers (CustomFieldsTree + p_ObjectTree) filed as TD-UI-PLACEHOLDER-HANDLERS (S4 — UX issue, not security). Audit-event alerting: new `backend/internal/alerting/` package with `Webhook` implementing `audit.Alerter`; `audit.Logger.Log` fans selected action codes (configured via `AUDIT_ALERT_ACTIONS` allowlist) to `AUDIT_ALERT_WEBHOOK_URL` via async POST with `X-Vector-Signature` HMAC-SHA256 (when `AUDIT_ALERT_SECRET` set); fail-open semantics (never blocks audit row INSERT, never propagates errors, never re-enters audit/alerting); 13 tests pass under `-race`. Default config in all envs: disabled (no URL = no-op). Wired in main.go after `audit.New(pool)`; startup logs the config via `Webhook.String()` (secret redacted). Standards basis: NIST SP 800-63B-4, OWASP ASVS 4.0, NCSC Cyber Security Design Principles (28 sub-principles), FCA PS21/3, UK GDPR Article 32. Implementation plan: `/Users/rick/.claude/plans/velvet-dreaming-hamming.md`. `[P1]`

> Commit `66a7e32` (2026-05-18): docs(security): clarify 15-min access TTL is defense in depth [B16.8.9]
> Commit `5ccef56` (2026-05-18): feat(migration): users_reauth_nonces table for step-up reauth [B16.8.10]
  - ✅ ~~**B16.8.1** Backend TOTP core~~ `[P1]` > Commit 2026-05-18: `mfa.go` + `roletypes.User` MFA fields + `auth/sql.go` MFA constants; `go build ./...` clean.
  - ✅ ~~**B16.8.2** Login partial-auth gate~~ `[P1]` > Commit 2026-05-18: `SignChallengeToken`/`ParseChallengeToken` in `tokens.go`; `LoginResult.MFARequired`+`MFAChallengeToken`; `Login()` forks to challenge on `mfa_enrolled=true`; handler returns `mfa_challenge_resp`.
> Commit `85447e4` (2026-05-18): docs(cookbook): side-instance + JWT-decode + login-smoke entries [B16.8.11]
> Commit `66a7e32` (2026-05-18): docs(security): clarify 15-min access TTL is defense in depth [B16.8.9]
> Commit `7839d3d` (2026-05-18): feat(auth): stamp + validate JWT iss/aud claims [B16.8.8]
> Commit `7839d3d` (2026-05-18): feat(auth): stamp + validate JWT iss/aud claims [B16.8.8]
> Commit `d32ebd9` (2026-05-18): test(realtime): failing WS-revoke integration + registry unit tests [B16.8.12]
> Commit `47c2ca8` (2026-05-18): feat(realtime): WS session registry [B16.8.12]
> Commit `47c2ca8` (2026-05-18): feat(realtime): WS session registry [B16.8.12]
> Commit `55a679d` (2026-05-18): feat(realtime): WS session sweeper + immediate-close [B16.8.12]
> Commit `55a679d` (2026-05-18): feat(realtime): WS session sweeper + immediate-close [B16.8.12]
> Commit `c5d96ba` (2026-05-18): feat(auth/realtime): plumb sid into WS via context + Hub.CloseSession [B16.8.12]
> Commit `c5d96ba` (2026-05-18): feat(auth/realtime): plumb sid into WS via context + Hub.CloseSession [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `c40d494` (2026-05-18): fix(realtime): gate ServeWS conn.Close so first frame wins [B16.8.12]
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  - ✅ ~~**B16.8.3** MFA verify endpoint~~ `[P1]` > Commit 2026-05-18: `MFAVerifyLogin` service method + `MFAVerify` handler; `POST /auth/mfa/verify` registered with 10/min rate limit.
  - ✅ ~~**B16.8.4** MFA management endpoints~~ `[P1]` > Commit 2026-05-18: `POST /auth/mfa/enroll`, `POST /auth/mfa/confirm`, `DELETE /auth/mfa` registered in `main.go` under `RequireAuth`.
> Commit `d32ebd9` (2026-05-18): test(realtime): failing WS-revoke integration + registry unit tests [B16.8.12]
  - ✅ ~~**B16.8.5** Frontend MFA~~ `[P1]` > Commit 2026-05-18: `MFAChallengeError` + `mfaLogin()` in `AuthContext.tsx`; inline TOTP step on `app/login/page.tsx`; `app/(user)/account-settings/mfa/page.tsx` with QR code enrollment, recovery codes, disable flow; `qrcode` npm package added.
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
  - ✅ ~~**B16.8.6** Session idle timeout (NIST SP 800-63B-4 AAL2 ≤30min) — enforced **per protected request** via B16.8.11's middleware JOIN: `NOW() - COALESCE(rotated_at, created_at) > SESSION_IDLE_TTL` (default 30m) → 401 with `Problem.code = "session_idle_expired"`. Frontend AuthContext (step 4) catches the code, clears state, redirects to `/login` with banner copy from `usermessages.AuthSessionIdleExpired`. E2E verified 2026-05-18 (SQL backdate created_at by 31min → next request 401s with the right code).~~ `[P1]`
> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
  - ✅ ~~**B16.8.7** Cookie flags hardened on every backend `Set-Cookie` + frontend `session_alive`.~~ Shipped 2026-05-18. `rt`, `csrf_token`, `mfa_remember_*` all carry `HttpOnly` (except `csrf_token` by double-submit design) + `SameSite=Strict` + `Secure` via new `isSecureCookieRequest(r)` helper that auto-detects TLS (`req.TLS != nil`) with `COOKIE_SECURE=true` env as proxy-case override; either signal sets Secure. Frontend `setSessionCookie` adds `Secure` on `window.location.protocol === "https:"`. Three contract tests in `auth/cookies_test.go` pin all three rules (TLS auto-detect, env override, dev plain-HTTP). E2E verified against side-instance: HTTP+env-off → no Secure (dev safe); HTTP+env-on → Secure set (proxy case). NOTE: `SameSite=Strict` chosen over the AC's `Lax` — Strict is correct for auth cookies (no cross-origin ride-along). NOTE: env-file gap on staging/prod (`COOKIE_SECURE=false`) flagged as `TD-SEC-COOKIE-SECURE-ENV` in `docs/c_tech_debt.md` for ops-level fix; auto-detect mitigates direct-TLS deploys, env override mitigates TLS-upstream deploys. `[P1]`
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
  - ✅ ~~**B16.8.8** JWT `iss` + `aud` claims on access/refresh/challenge tokens.~~ Shipped 2026-05-18 (`7839d3d`). `tokens.go` signs `iss=vector-auth`, `aud=vector-api`; `ParseToken*` rejects mismatches; legacy-token grace window honoured. `[P1]`
  - ✅ ~~**B16.8.9** Access-token TTL — hold at 15min.~~ Shipped 2026-05-18 (docs-only). `docs/c_security.md` § "Access-token TTL — defense in depth, not the primary idle gate" pins the rationale: per-request session check (B16.8.11) is the load-bearing idle gate, the 15-min TTL is defense in depth that caps stolen-token blast radius. No code change required. `[P3]`
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
  - ✅ ~~**B16.8.10** Active sessions UI + log-out-everywhere + per-action step-up reauth for sensitive actions.~~ Shipped 2026-05-18 across 4 commits (`5ccef56` migration → `2646566` backend → `bf9222c` frontend → `b2c64b6` E2E fixes). `users_reauth_nonces` table + `RequireStepUpReauth` middleware + `/auth/sessions` + `/auth/reauth` handlers; `/account-settings/sessions` page + `ReauthModal` + `useStepUpAction` hook (5 contract tests green); E2E verified end-to-end against side instance — list/revoke-others/wrong-pwd/action-key-mismatch/correct-proof all behave per spec; revoked session immediately gets 401 `session_revoked` (confirms B16.8.11 cross-talk). Wired only on `DELETE /workspaces/{id}` for now; change-password + disable-MFA already self-gate inline; change-email endpoint does not exist (filed `TD-SEC-CHANGE-EMAIL-MISSING`). Hook + modal stand ready for first additional consumer (`TD-SEC-WORKSPACE-DELETE-UI`). The user-visible counterpart to B16.8.11 — without this, instant server-side revocation has no trigger. AC: `/account-settings/sessions` page lists every row in `users_sessions` for the current user (created_at, last_active = rotated_at, ip, user-agent, current-session badge); per-row "revoke" button and a "Log out all other sessions" action; both call new `DELETE /auth/sessions/:id` and `POST /auth/sessions/revoke-others` endpoints which `UPDATE users_sessions SET users_sessions_revoked = TRUE` and emit `audit.Log` entries; integration test: revoke from device A → next request from device B 401s within 1s (cache TTL when B16.8.11's Redis layer lands). **Per-action step-up reauth (replaces the originally-drafted time-window model — closes in-realm-extension pre-staging attack):** sensitive endpoints — change email, change password, disable MFA, delete workspace — return `409 errors_codes.REAUTH_REQUIRED` with `{action_token: <opaque server-issued>}` on first call; frontend opens reauth modal, posts `{action_token, password, totp_code?}` to `POST /auth/reauth`; backend verifies password (+ TOTP if enrolled), returns `{action_proof: <HMAC-signed action_token + user_id + action_key + expiry=60s + nonce>}`; frontend retries the sensitive endpoint with `X-Action-Proof` header; backend validates HMAC, checks action_key matches the requested route, checks nonce not consumed (`users_reauth_nonces` table with `users_reauth_nonces_id`, `_id_user`, `_action_key`, `_consumed_at`, `_expires_at`), marks consumed atomically, then proceeds. Each `action_proof` is single-use, action-bound, 60s-expiring — extension that captures the password during the modal can replay only the exact action the user just clicked, not pre-stage a different one. `[P1]`
  - ✅ ~~**B16.8.11** `sid` claim on access tokens + per-request session check in `RequireAuth` middleware.~~ Shipped 2026-05-18 across 5 commits (`ded3f12` → `802dd70`). Tokens carry `sid`; middleware extends `FindUserByID` into a `users JOIN users_sessions` query (same DB roundtrip count); revoked rows → 401 `code: "session_revoked"`; idle rows → 401 `code: "session_idle_expired"`; frontend api.ts + AuthContext.hardLogout route both codes to a banner-backed redirect; `REQUIRE_SID_CLAIM=true` env flag closes the legacy-token grace door once refresh-TTL has drained. Wire contract pinned by `tokens_test.go` + `middleware_test.go` + `app/lib/__tests__/api-session-codes.test.ts` (all green). End-to-end verified against live `:5100` + side-instance `:5199`. Revocation-timeliness design noted in `docs/c_security.md`. **Future scale note (deferred):** when concurrent users > 1k or Postgres p99 on the join > 5ms, introduce a Redis-cached `sid → {revoked, rotated_at}` with 5-second TTL — same Redis instance B16.8 Phase 4 introduces for rate limiting. `[P1]`
  - ✅ ~~**B16.8.12** WebSocket session enforcement.~~ Shipped 2026-05-18 across 7 commits (`d32ebd9` → `89fc6fa`) plus a sweeper-orphan fix (`bde26f3`). WS session registry + sweeper + ServeWS plumbing + `Hub.CloseSession` + frontend 4001/4002 close-code routing to hardLogout; sweeper also handles deleted `users_sessions` rows so orphan sockets are closed. Closes the long-lived-connection gap that B16.8.11's per-request HTTP check left open. `[P1]`

- **B16.9** LDAP / Active Directory SSO — enterprise login via LDAP bind auth so NHS, council, and corporate customers can authenticate against their own directory. `auth_method` and `ldap_dn` columns already exist on `users` table as skeleton (`db/mmff_vector/schema`). Implementation: `backend/internal/auth/ldap.go` — bind validation + user sync; login handler forks on `auth_method='ldap'`; admin UI to configure LDAP server URL, base DN, bind account. Test infra: `osixia/openldap` or `bitnami/openldap` Docker container. Longer-term companion: SAML 2.0 / OIDC for cloud IdP federation (Azure AD, Okta, Google Workspace). Enterprise tier feature — not required for first external user but required before any NHS/council pilot. `[P3]`

---

## B17. Infrastructure & DevOps

- ✅ ~~**B17.1** Go backend on `:5100`~~
  > Running via `go run ./cmd/server` on `:5100`; `/healthz` confirmed
  > Last checked: 2026-05-08
  >
- **B17.2** Next.js frontend `[P1]`
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
- **B17.3** Three PostgreSQL databases — `mmff_vector`, `mmff_library`, `vector_artefacts` `[P1]`
- ✅ ~~**B17.4** pgvector extension for embeddings~~
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
  > Added via `035_search_outbox.sql` — `CREATE EXTENSION IF NOT EXISTS vector`; `content_embedding vector(768)` column on `artefacts`
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
  > Last checked: 2026-05-08
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
  >
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
- **B17.5** Ollama (`nomic-embed-text`) local embedding model `[P3]`
- ✅ ~~**B17.6** DB migration toolchain~~
  > `backend/migrate` compiled binary confirmed; `db/artefacts_schema/` SQL files numbered sequentially (001–035)
  > Last checked: 2026-05-08
  >
- ✅ ~~**B17.7** API snapshot toolchain — dual-spec, `api-snapshots/v1/` + `v2/`~~
- **B17.8** Unused index audit `[P3]`
- **B17.9** API gateway in front of public surface `[P3]`
> Commit `761d7cd` (2026-05-09): fix(B22): DevPageHelpPanel — apiSite import + strip stale /api/ prefix
> Commit `4efd532` (2026-05-12): fix(dev): drop accidental /api prefix from page-help admin calls
> Commit `098ccbb` (2026-05-12): feat(PLA-0044): layoutWithDagre delegates visibility walk to walkTopology [FE-POR-API-0006]
> Commit `eaf4feb` (2026-05-12): feat(PLA-0044): useTopologyTreeState sources childrenOf from walkTopology [FE-POR-API-0006]
> Commit `6857913` (2026-05-12): feat(PLA-0044): TopologyTreeFlyout rows come from walkTopology [FE-POR-API-0006]
> Commit `5e06f7d` (2026-05-13): style: remove border from .panel — borderless card surface [FE-POR-0003.1]
> Commit `5bdf3be` (2026-05-13): docs(PLA-0030): document 5 missing /samantha/v2 routes in openapi-v2.yaml
> Commit `2e9ff2d` (2026-05-13): chore: memory rule + 4 deferrals filed in tech-debt register [TD-AUTH-001 TD-API-002 TD-API-003 TD-API-004]
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
  > Terminate `/samantha/v2` behind a dedicated gateway (Kong / Envoy / AWS API Gateway). Gateway owns: API-key auth, per-key rate limiting, OpenAPI request/response validation, deprecation headers, observability hooks. Service code stops handling unauthenticated/malformed requests. Pre-req: `api.vector.app` subdomain + Option B physical split (separate `chi.Mux` for public vs BFF inside the binary). Premature today — one Go binary suffices until external traffic exists; revisit when first integration partner signs or before Series B.

> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `cc38e98` (2026-05-12): docs(PLA-0043): handover for cross-machine continuation [FE-POR-API-0002]
> Commit `bb18aa4` (2026-05-12): feat(PLA-0044): walkTopology Go mirror + cross-runtime parity tests [FE-POR-API-0006]
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `ea4862c` (2026-05-12): fix(PLA-0044): ScopeRail uses walkTopology + byPosition — kills phantom-D orphan re-root [FE-POR-API-0006]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
---
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]

> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
## B18. Developer Experience

> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
- ✅ ~~**B18.1** OpenAPI v2 spec (see B8.3)~~
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
- **B18.2** TypeScript SDK `[P4]`
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
- **B18.3** Python SDK `[P5]`
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
- **B18.4** Postman collection `[P4]`
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
- **B18.5** Rate limit response headers `[P3]`
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
  > No `X-RateLimit-*` headers found — rate limiting fires but doesn't expose headers to consumers
  > Last checked: 2026-05-08
  >
- ⚠️ **B18.6** Structured error responses — `error_code` + `details` on all 4xx/5xx `[P2]`
  > `error_code` field referenced in `errorsreport/handler.go` and `portfoliomodels/adopt.go` / `adopt_stream.go` — exists on adoption error paths but not consistently on all 4xx/5xx handlers
  > Last checked: 2026-05-08
  >

### B18.7 Shared methods catalogue (PLA-0045) — **PARKED 2026-05-18** (swapped out for B16.8 security hardening)

Persistent home, naming convention, and discoverability surface for cross-runtime shared methods — logic re-used across Frontend React ↔ BFF Route Handler ↔ Public Go API. Directory contract: `app/lib/shared/<domain>/` (TS, cross-runtime: browser bundle + Next.js Node route handler), `backend/internal/shared/<domain>/` (Go), `dev/fixtures/shared/<domain>/` (parity golden fixtures consumed by both Vitest and Go test suites). Catalogue at `docs/c_shared_methods.md` is the single index of every shared method with TS path, Go path, fixtures path, consumers, status. PostToolUse hook nudges shared placement on new `app/api/**/route.ts` or `backend/internal/**/handler.go` files. PLA-0044 topology walker is the first cataloguer.

> **Parked 2026-05-18** — swapped out of the WIP-allowed five so B16.8 (pre-launch security hardening) can take the slot. No sub-stories were started, so no work is lost. Unpark when B16.8 closes or when shared-method drift becomes a felt pain.

- **B18.7.1** Directory scaffolds — `app/lib/shared/`, `backend/internal/shared/`, `dev/fixtures/shared/` with `.gitkeep` so paths exist before walker lands. `[P3]`
- **B18.7.2** `docs/c_shared_methods.md` catalogue — table format with first row (PLA-0044 topology walker); CLAUDE.md pointer under Working practices. `[P3]`
- **B18.7.3** Lint allow-list — `dev/registries/shared_methods.json` exempts `app/lib/shared/**` from `lint:writer-boundary` + `lint:transport-segregation` cross-import bans; consumer globs `app/components/**` and `app/api/**/route.ts`. `[P3]`
> Commit `8729c54` (2026-05-18): feat(ops): vector-dev swarm stack as infra-as-code + pg_stat_statements
- **B18.7.4** PostToolUse soft-reminder hook — `.claude/hooks/shared-methods-reminder.sh` fires on Write/Edit of new `app/api/**/route.ts` or `backend/internal/**/handler.go` (≥30 lines) emitting one-line catalogue nudge; quiet on non-handler files. `[P4]`
> Commit `85447e4` (2026-05-18): docs(cookbook): side-instance + JWT-decode + login-smoke entries [B16.8.11]
> Commit `66a7e32` (2026-05-18): docs(security): clarify 15-min access TTL is defense in depth [B16.8.9]
> Commit `7839d3d` (2026-05-18): feat(auth): stamp + validate JWT iss/aud claims [B16.8.8]
> Commit `47c2ca8` (2026-05-18): feat(realtime): WS session registry [B16.8.12]
> Commit `55a679d` (2026-05-18): feat(realtime): WS session sweeper + immediate-close [B16.8.12]
> Commit `c5d96ba` (2026-05-18): feat(auth/realtime): plumb sid into WS via context + Hub.CloseSession [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `c40d494` (2026-05-18): fix(realtime): gate ServeWS conn.Close so first frame wins [B16.8.12]
> Commit `c40d494` (2026-05-18): fix(realtime): gate ServeWS conn.Close so first frame wins [B16.8.12]
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `8729c54` (2026-05-18): feat(ops): vector-dev swarm stack as infra-as-code + pg_stat_statements
> Commit `d6c660e` (2026-05-18): docs(claude): add swarm stack pointer to working-practices index
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
- **B18.7.5** Feedback memory — `.claude/memory/feedback_shared_methods_home.md` + MEMORY.md index line so the rule loads at every session start. `[P4]`
> Commit `d32ebd9` (2026-05-18): test(realtime): failing WS-revoke integration + registry unit tests [B16.8.12]
> Commit `47c2ca8` (2026-05-18): feat(realtime): WS session registry [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]

---
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `d32ebd9` (2026-05-18): test(realtime): failing WS-revoke integration + registry unit tests [B16.8.12]
> Commit `d32ebd9` (2026-05-18): test(realtime): failing WS-revoke integration + registry unit tests [B16.8.12]
> Commit `47c2ca8` (2026-05-18): feat(realtime): WS session registry [B16.8.12]
> Commit `55a679d` (2026-05-18): feat(realtime): WS session sweeper + immediate-close [B16.8.12]
> Commit `c5d96ba` (2026-05-18): feat(auth/realtime): plumb sid into WS via context + Hub.CloseSession [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `d6c660e` (2026-05-18): docs(claude): add swarm stack pointer to working-practices index
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]

> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
## B19. Work Item Relations Graph
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]

> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
A 3D force-directed graph (Obsidian-style globe) for visualising the work-item hierarchy at tenant scale. New tab on the Work Items page at `/work-items/work-item-relations`. Nodes coloured by type (Epic/Story/Defect/Task), hub size proportional to descendant count, mouse-drag rotation, search + neighbour-mode + depth slider. Stack: `3d-force-graph` (Three.js + d3-force-3d) with route-level dynamic import (`ssr:false`). 55k-row test seed already in place (500 epics + 100 top-level defects + descendants). Plan: [PLA-0035](dev/plans/PLA-0035.json)
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]

> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
### ✅ ~~B19.1 API — `/api/v2/work-items/relations`~~

- ✅ **B19.1.1** Design `GET /api/v2/work-items/relations` payload — `{nodes: [{id,type,title,state,descendantCount,parentId}], edges: [{source,target,kind:"parent"}], meta}` `[P2]`
- ✅ **B19.1.2** Write recursive-CTE descendant-count query against `vector_artefacts.artefacts` — single materialised pass per request `[P2]`
  `[x] B19.1.1 Payload designed`
- ✅ **B19.1.3** Implement route handler `app/api/v2/work-items/relations/route.ts` — workspace + type filters, `Cache-Control: private, max-age=30` `[P2]`
  `[x] B19.1.2 CTE query written`
- ✅ **B19.1.4** Update `openapi-v2.yaml` with `/work-items/relations` path spec `[P2]`
  `[x] B19.1.3 Route live`
- **B19.1.5** Document 100k-row truncation threshold + cursor-based fallback shape (not built in v1) `[P3]`
  `[x] B19.1.3 Route live`

### ✅ ~~B19.2 Page Structure — Tab Conversion~~

- ✅ **B19.2.1** Convert `app/(user)/work-items/page.tsx` body into `app/(user)/work-items/list/page.tsx` (preserve existing list view) `[P2]`
- ✅ **B19.2.2** Add `app/(user)/work-items/layout.tsx` with `PageShell` + `SecondaryNavigation` per [`docs/c_c_secondary_nav_deeplink.md`](docs/c_c_secondary_nav_deeplink.md) `[P2]`
  `[x] B19.2.1 List moved to /list`
- ✅ **B19.2.3** Replace `app/(user)/work-items/page.tsx` with `redirect("/work-items/list")` to keep bookmarks alive `[P2]`
  `[x] B19.2.1 List moved to /list → [x] B19.2.2 Layout in place`
- ✅ **B19.2.4** Audit existing `app/(user)/work-items/settings/` to confirm it still resolves under the new layout `[P2]`
  `[x] B19.2.2 Layout in place`
- ✅ **B19.2.5** Run `npm run lint:tab-deep-link` to verify no `urlKey`/`useTabState` regression `[P2]`
  `[x] B19.2.3 Redirect in place → [x] B19.2.4 Settings audit clean`

### B19.3 Frontend — Graph Component

- ✅ **B19.3.1** Install `3d-force-graph` + `three-spritetext`; verify `three@0.184.0` already pinned by `PortfolioGraphChart.tsx` `[P2]`
  `[x] B19.2.2 Layout in place (so the new tab can mount)`
- ✅ **B19.3.2** Scaffold `app/components/WorkItemRelations/index.tsx` orchestrator + `useRelationsData.ts` hook `[P2]`
  `[x] B19.1.3 API live → [x] B19.3.1 Libs installed`
- ✅ **B19.3.3** Build `RelationsGraph.tsx` — Three.js canvas via `dynamic(() => import, { ssr:false })`, parent edges, type-coloured nodes, `nodeVal = log2(descendantCount+2)` for hub sizing `[P2]`
  `[x] B19.3.2 Orchestrator scaffolded`
- ✅ **B19.3.4** Build `RelationsToolbar.tsx` — search box, type checkboxes, depth slider (0–10/∞), neighbour-mode toggle `[P2]`
  `[x] B19.3.3 Graph renders`
- ✅ **B19.3.5** Build `RelationsSidebar.tsx` — selected-node detail (type, id, state, depth, descendants, parent, open-in-list) `[P2]`
  `[x] B19.3.3 Graph renders → [x] B19.3.4 Selection wired`
- ✅ **B19.3.6** Implement search → fly-to via `cameraPosition({}, node, 1500)` `[P2]`
  > Done 2026-05-09 — `onFlyToReady` callback registered on mount; orchestrator effect fires `flyToRef.current(id)` when `filters.q` narrows to exactly one visible node. Camera flies with 1500ms transition.
- ✅ **B19.3.7** Implement neighbour-mode BFS at depth N — dim non-neighbours, highlight selected sub-graph `[P2]`
  > Done 2026-05-09 — `bfsNeighbours()` computes k-hop adjacency set from `selectedId` up to `filters.neighbourDepth` (1–6 hops). Non-members get `#rrggbb28` colour (16% opacity); `linkVisibility` hides non-neighbourhood edges. Hops slider appears in toolbar when neighbour mode is checked.
- ✅ **B19.3.8** New page route `app/(user)/work-items/work-item-relations/page.tsx` mounting `<WorkItemRelations />` `[P2]`
  `[x] B19.3.3 Graph renders → [x] B19.2.2 Layout in place`

### ❌ NFA — B19.4 Performance

**Status:** Parked pending B19.5.2 (filter guardrails). Graph currently renders unfiltered tenant data → visual mess; layout perf work premature until filters prevent overload.

- **B19.4.1** Move d3-force-3d layout into a Web Worker (`useGraphLayoutWorker.ts`) — serialise positions back per tick `[P2]`
  `[ ] Blocked by B19.5.2 (filters needed first)`
- **B19.4.2** Cap `cooldownTicks` at ~120; persist final positions in `sessionStorage` keyed by `(tenant, filterHash)` so re-entry is instant `[P2]`
  `[ ] Blocked by B19.5.2`
- **B19.4.3** Distance-based LOD for labels — only render `three-spritetext` for nodes within camera radius < threshold OR in selection set `[P3]`
  `[ ] Blocked by B19.5.2`
- **B19.4.4** Bundle-size check via `next build` analyser — confirm Three + 3d-force-graph stay in a lazy chunk gated to this tab `[P2]`
  `[ ] Blocked by B19.5.2`
- **B19.4.5** Document 500k-node v2 strategy (server-side layout precompute, GPU instancing, edge bundling) — design only, not built `[P4]`
  `[ ] Deferred to PLA-0037`

### B19.5 Saved Views, Mini-Map, Polish

- **B19.5.1** Build `RelationsMiniMap.tsx` — orthographic 2D top-down sharing positions, click-to-fly camera `[P3]`
  `[ ] B19.3.3 Graph renders`
- **B19.5.2** Saved filter views — schema decision: reuse `user_custom_pages` or new `user_relations_views` table `[P3]`
  `[ ] B19.3.4 Toolbar live`
- **B19.5.3** Implement save/load/delete view UI in toolbar `[P3]`
  `[ ] B19.5.2 Schema decided`
- **B19.5.4** Animation pause/resume on idle (`pauseAnimation()`) `[P4]`
  `[ ] B19.4.1 Worker live`
- **B19.5.5** PNG export + share-link with camera position serialised in URL `[P4]`
  `[ ] B19.3.3 Graph renders`
- **B19.5.6** Touch/pinch on iPad — `OrbitControls.touches` mapping `[P5]`
  `[ ] B19.3.3 Graph renders`

### B19.6 Tests, Realtime, Schema Follow-up

- **B19.6.1** Playwright E2E smoke — page loads, graph renders >0 nodes, search highlights, sidebar opens `[P2]`
  `[ ] B19.3.8 Page route live → [ ] B19.3.5 Sidebar live`
- **B19.6.2** Subscribe to existing `useRefetchOnPush` topic for work-item changes; debounced refetch only when tab is visible `[P3]`
  `[ ] B19.3.2 Hook scaffolded`
- ✅ **B19.6.3** Reserve **PLA-0036** for `work_item_links` table (kinds: blocks, depends_on, relates_to, duplicates) — adds non-tree edges to the graph `[P3]`
  `[x] B19.1.3 v1 API shipped (so edge stream can extend cleanly)`
- **B19.6.4** Write `docs/c_c_work_item_relations.md` — API shape, perf budget, follow-up PLA-0036 pointer `[P2]`
  `[ ] B19.3.8 Page route live`

---

## B20. User Access Rights & Navigation Control

Manage per-role access to pages and features. Control what each role (user, padmin, gadmin) can view and pin in navigation.

### B20.1 Role-based Page Access

- ✅ ~~**B20.1.1** Role gate system for pages — `roles_pages` junction table~~
  > `pages` table seeded with system pages (dashboard, portfolio, workspace-settings, etc.); `roles_pages` defines which roles can view each page. Queries scoped by role via `nav.Service.CatalogFor(role)`. All seeded pages + role assignments live.
  > Last checked: 2026-05-09
  >
- ✅ ~~**B20.1.2** Frontend catalogue filtering by user role~~
  > `NavPrefsContext.tsx` loads catalogue from `/nav/catalogue`, filtered to only show pages user's role can access. Prevents role-forbidden items in UI.
  > Last checked: 2026-05-09
  >
- ✅ ~~**B20.1.3** Backend validation of pinned items against role permissions~~
  > `nav.Service.ReplacePrefsForProfile()` validates each pinned item exists in user's role-filtered catalogue before saving. Rejects with `ErrRoleForbidden` if user tries to pin page outside their role.
  > Last checked: 2026-05-09
  >

### B20.2 Default Navigation Profiles

- ✅ ~~**B20.2.1** Default pinned items by role~~
  > `pages.default_pinned = TRUE` flags items shown by default when user first creates nav prefs. Filtered by role via catalogue so each role sees only its own defaults. E.g., workspace-settings is default for gadmin + padmin, hidden from user role.
  > Last checked: 2026-05-09
  >
- ✅ ~~**B20.2.2** Graceful hydration when defaults change~~
  > Frontend draft reconstruction skips items not in current catalogue (migration-safe: if a default gets removed, user's existing pinned list stays stable; only new users see the updated set).
  > Last checked: 2026-05-09
  >

### B20.3 Role-Specific Feature Access

- ✅ ~~**B20.3.1** padmin access to workspace-settings~~
  > Migration 140 grants padmin role to `roles_pages` for workspace-settings; Migration 141 keeps it as default_pinned. padmin can now see, pin, and edit workspace-settings tabs (role-gated via `useHasPermission` per-tab). Gadmin retains full access.
  > Last checked: 2026-05-09
  >
- **B20.3.2** Permission predicate per tab in workspace-settings `[P2]`
  > Some tabs (e.g., users, permissions) are gadmin-only; padmin sees a subset (organization, workspaces, portfolio_model, etc.). Use `useHasPermission()` checks to hide/disable tabs per role. Define permission codes per tab in service layer.
  >
- **B20.3.3** Role-gated custom pages (Phase 5+) `[P4]`
  > When users can create custom pages, role assignments on custom pages follow same `roles_pages` pattern as system pages. Permissions inherit from creator tenant role or explicit assignment.
  >

---

## B21. Artefact-Items Substrate (PLA-0037)

> Generalise the v2 work-items handler family into a scope-parameterised **artefact-items** substrate so a single Go package serves both `/work-items` (scope=`work`, ~5 types) and `/portfolio-items` (scope=`strategy`, 51 types: themes, objectives, business epics, business outcomes, features-as-strategy). Frontend `useWorkItemsWindow` becomes generic `useArtefactItemsWindow` driven by `resourceUrl` from `p_wizard_*.json` so the existing portfolio page stops silently rendering work-items data.
>
> **Why now:** B15.2.5 introduced `p_wizard_portfolio.json` but the page still calls `/work-items` because the hook is hardcoded; backend filters `at.scope='work'` in 7 places, so the portfolio route — even when wired — would return 0 strategy artefacts. Without B21 the sidecar pattern is cosmetic.
>
> **Cutover model:** Phase 1 = rename Go package + add scope parameter, both routes register against same handler. Phase 2 = generic frontend hook + sidecar `resourceUrl`/`scope` fields. Phase 3 = tests, docs, deprecate legacy paths. Strict additive — no breaking changes to `/work-items` contract.

- **B21.1** Backend — rename `workitemsv2` → `artefactitemsv2` and parameterise by scope `[P1]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `1e010e2` (2026-05-12): chore(scope): Vector_Scope progress sweep + PLA-0022 date bump + R051 research entry
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `96b7f25` (2026-05-12): docs(research): R052 Rally scope mechanics + R053 Rally/Jira/ADO comparison; backfill PLA-0042.md
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `3963bbb` (2026-05-12): feat(PLA-0043): scope rail polish — auto-width, spine elbows, vector scrollbar [FE-POR-0003.1]
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `bb18aa4` (2026-05-12): feat(PLA-0044): walkTopology Go mirror + cross-runtime parity tests [FE-POR-API-0006]
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `ea4862c` (2026-05-12): fix(PLA-0044): ScopeRail uses walkTopology + byPosition — kills phantom-D orphan re-root [FE-POR-API-0006]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `3790542` (2026-05-13): feat(PLA-0043): persist mixed tag+group bucket order per nav profile [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `545ebbd` (2026-05-13): feat(PLA-0043): tag bucket icon overrides in nav preferences [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `4411327` (2026-05-13): feat(PLA-0026/SA1): remove legacy vectorPool saga writes — VA is now sole write path [FE-POR-0003]
> Commit `a8c9c3a` (2026-05-13): refactor(PLA-0044): rename rd-topbar → nav-top-bar — CSS naming convention [FE-UI-0001]
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `4ab58a3` (2026-05-13): chore(PLA-0039): delete empty /samantha/v1 chi block from router [FE-POR-0003]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `4e1e171` (2026-05-14): docs(PLA-0048 / RF1.6): documentation pass — regenerate docs to post-rename truth [RF1.6]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7773c95` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_sessions (§2.3) [RF1.4.4.users_sessions]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `5b7fac9` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `f944e5a` (2026-05-16): test(artefacttypes): red — F3 slot substrate [00603]
> Commit `454004c` (2026-05-16): test(artefactitems): red — F4 UUID wire end-to-end [00604]
> Commit `3f4009c` (2026-05-16): test(chip): red — F6 Status context + rename invariance [00606]
> Commit `09f9fdb` (2026-05-16): feat(vector_artefacts): green — slot enum substrate on artefacts_types [00582]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `146430c` (2026-05-16): test(priority): red — F7 substrate [00607]
> Commit `cb77d87` (2026-05-16): test(priority): red — F8 CRUD + UUID wire [00608]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `5eba458` (2026-05-16): fix(test): bulk set_priority payload uses priority_id UUID [00595,00597 fixup]
> Commit `206b5e2` (2026-05-16): docs(tech-debt): file 6 TD entries from backend test-failure inventory
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `e41ed3c` (2026-05-17): fix(errorsreport): correct wire-shape assertion in TestReport_UnknownCode (TD-ERRORSREPORT-WIRE-SHAPE)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `7839d3d` (2026-05-18): feat(auth): stamp + validate JWT iss/aud claims [B16.8.8]
> Commit `d32ebd9` (2026-05-18): test(realtime): failing WS-revoke integration + registry unit tests [B16.8.12]
> Commit `47c2ca8` (2026-05-18): feat(realtime): WS session registry [B16.8.12]
> Commit `55a679d` (2026-05-18): feat(realtime): WS session sweeper + immediate-close [B16.8.12]
> Commit `c5d96ba` (2026-05-18): feat(auth/realtime): plumb sid into WS via context + Hub.CloseSession [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `c40d494` (2026-05-18): fix(realtime): gate ServeWS conn.Close so first frame wins [B16.8.12]
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > Single sole-writer service for any `artefact_types` row, scope-discriminated. Phase 1 minimum to unblock portfolio page.
  >
- **B21.1.1** Rename Go package `backend/internal/workitemsv2/` → `backend/internal/artefactitemsv2/` `[P1]`
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `bb18aa4` (2026-05-12): feat(PLA-0044): walkTopology Go mirror + cross-runtime parity tests [FE-POR-API-0006]
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `3790542` (2026-05-13): feat(PLA-0043): persist mixed tag+group bucket order per nav profile [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `545ebbd` (2026-05-13): feat(PLA-0043): tag bucket icon overrides in nav preferences [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `4411327` (2026-05-13): feat(PLA-0026/SA1): remove legacy vectorPool saga writes — VA is now sole write path [FE-POR-0003]
> Commit `a8c9c3a` (2026-05-13): refactor(PLA-0044): rename rd-topbar → nav-top-bar — CSS naming convention [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `4ab58a3` (2026-05-13): chore(PLA-0039): delete empty /samantha/v1 chi block from router [FE-POR-0003]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `4e1e171` (2026-05-14): docs(PLA-0048 / RF1.6): documentation pass — regenerate docs to post-rename truth [RF1.6]
> Commit `d00e3d1` (2026-05-14): chore(PLA-0048 / RF1.4.4): ship lint:column-prefix-convention (warn-only) [RF1.4.4]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7773c95` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_sessions (§2.3) [RF1.4.4.users_sessions]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `5b7fac9` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `6f51bd0` (2026-05-16): feat(redesign): swap V text brand for /logo-vector.png in primary rail
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `f944e5a` (2026-05-16): test(artefacttypes): red — F3 slot substrate [00603]
> Commit `454004c` (2026-05-16): test(artefactitems): red — F4 UUID wire end-to-end [00604]
> Commit `3f4009c` (2026-05-16): test(chip): red — F6 Status context + rename invariance [00606]
> Commit `09f9fdb` (2026-05-16): feat(vector_artefacts): green — slot enum substrate on artefacts_types [00582]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `146430c` (2026-05-16): test(priority): red — F7 substrate [00607]
> Commit `cb77d87` (2026-05-16): test(priority): red — F8 CRUD + UUID wire [00608]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `5eba458` (2026-05-16): fix(test): bulk set_priority payload uses priority_id UUID [00595,00597 fixup]
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `e41ed3c` (2026-05-17): fix(errorsreport): correct wire-shape assertion in TestReport_UnknownCode (TD-ERRORSREPORT-WIRE-SHAPE)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `4851c50` (2026-05-18): feat(login): add black logo column on left (200px)
> Commit `28a4c8e` (2026-05-18): fix(login): remove duplicate logo from beige panel
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `7839d3d` (2026-05-18): feat(auth): stamp + validate JWT iss/aud claims [B16.8.8]
> Commit `d32ebd9` (2026-05-18): test(realtime): failing WS-revoke integration + registry unit tests [B16.8.12]
> Commit `47c2ca8` (2026-05-18): feat(realtime): WS session registry [B16.8.12]
> Commit `55a679d` (2026-05-18): feat(realtime): WS session sweeper + immediate-close [B16.8.12]
> Commit `c5d96ba` (2026-05-18): feat(auth/realtime): plumb sid into WS via context + Hub.CloseSession [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
> Commit `c40d494` (2026-05-18): fix(realtime): gate ServeWS conn.Close so first frame wins [B16.8.12]
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > Includes `service.go`, `types.go`, `handler.go`, all `*_test.go`. Update package declaration. User decree: name MUST state what it does — *"artefactItemsv2 so it says what it does in the name"*.
  >
- **B21.1.2** Update 8 import sites in `backend/cmd/server/main.go` `[P1]` `[ ]B21.1.1`
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `05cead9` (2026-05-13): fix(001_redesign): nav-v2 route corrections + travel indicator anchor [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `4ab58a3` (2026-05-13): chore(PLA-0039): delete empty /samantha/v1 chi block from router [FE-POR-0003]
> Commit `5bdf3be` (2026-05-13): docs(PLA-0030): document 5 missing /samantha/v2 routes in openapi-v2.yaml
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `6814e7d` (2026-05-18): feat(login): update sidebar branding — white bg, vertical red VECTOR wordmark
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > Lines 55, 260, 266, 273, 277, 289, 292, 304. Constructor + route registration switches.
  >
- **B21.1.3** Update doc-comment refs in adjacent packages `[P2]` `[ ]B21.1.1`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `3790542` (2026-05-13): feat(PLA-0043): persist mixed tag+group bucket order per nav profile [FE-POR-0003.1]
> Commit `545ebbd` (2026-05-13): feat(PLA-0043): tag bucket icon overrides in nav preferences [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `4411327` (2026-05-13): feat(PLA-0026/SA1): remove legacy vectorPool saga writes — VA is now sole write path [FE-POR-0003]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `5eba458` (2026-05-16): fix(test): bulk set_priority payload uses priority_id UUID [00595,00597 fixup]
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `e41ed3c` (2026-05-17): fix(errorsreport): correct wire-shape assertion in TestReport_UnknownCode (TD-ERRORSREPORT-WIRE-SHAPE)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
  > `backend/internal/portfolio/master_record_service.go:105`, `backend/internal/fields/handler.go:65`, `backend/internal/fields/resolver.go:71`. Comment-only — no behaviour change.
  >
- **B21.1.4** Add `Scope string` field to service constructor + propagate to all SELECT statements `[P1]` `[ ]B21.1.1`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `1e010e2` (2026-05-12): chore(scope): Vector_Scope progress sweep + PLA-0022 date bump + R051 research entry
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `96b7f25` (2026-05-12): docs(research): R052 Rally scope mechanics + R053 Rally/Jira/ADO comparison; backfill PLA-0042.md
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `3963bbb` (2026-05-12): feat(PLA-0043): scope rail polish — auto-width, spine elbows, vector scrollbar [FE-POR-0003.1]
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `ea4862c` (2026-05-12): fix(PLA-0044): ScopeRail uses walkTopology + byPosition — kills phantom-D orphan re-root [FE-POR-API-0006]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `3790542` (2026-05-13): feat(PLA-0043): persist mixed tag+group bucket order per nav profile [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `b8d1e66` (2026-05-13): fix(PLA-0043): dev_tools nav — auto-pin pages, Research first, remove hardcoded gear link [FE-POR-0003.1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `5b7fac9` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > Replace 7 hardcoded `at.scope = 'work'` literals (`service.go` lines 137, 193, 266, 335, 363, 413, 473) with `at.scope = $N`. Constructor signature: `New(db, scope string)`. Two instances registered in `main.go`: `New(db, "work")` for `/work-items`, `New(db, "strategy")` for `/portfolio-items`.
  >
- **B21.1.5** Parameterise `validItemTypes` allow-list per scope `[P1]` `[ ]B21.1.4`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `0ffe20d` (2026-05-09): chore: refresh local IDE state and launcher log
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `6513cfd` (2026-05-09): fix(B22): dynamic ID column width tracks max visible depth in ResourceTree
> Commit `3f0dbbe` (2026-05-09): fix(B22): fix dynamic ID column — re-fit on width change, floor at declared width
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `743b077` (2026-05-10): feat(roles): drop MVP single-admin workspace constraint
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `8ada5e5` (2026-05-11): refactor: nest Organisation & Work Items under Vector Admin tab
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `1cb8b7d` (2026-05-11): refactor: tenant-aware subtitle on Vector Admin tab
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `1e010e2` (2026-05-12): chore(scope): Vector_Scope progress sweep + PLA-0022 date bump + R051 research entry
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `96b7f25` (2026-05-12): docs(research): R052 Rally scope mechanics + R053 Rally/Jira/ADO comparison; backfill PLA-0042.md
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `cc38e98` (2026-05-12): docs(PLA-0043): handover for cross-machine continuation [FE-POR-API-0002]
> Commit `3963bbb` (2026-05-12): feat(PLA-0043): scope rail polish — auto-width, spine elbows, vector scrollbar [FE-POR-0003.1]
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `32002b3` (2026-05-12): docs(R054): Rally user-to-project assignment UX research
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `ea4862c` (2026-05-12): fix(PLA-0044): ScopeRail uses walkTopology + byPosition — kills phantom-D orphan re-root [FE-POR-API-0006]
> Commit `fea4fc9` (2026-05-12): feat(PLA-0043): chrome rework — typecase.css, viewport-anchored title, breadcrumbs [FE-POR-0003.1]
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `8825bab` (2026-05-13): feat(PLA-0043): add Workspace Admin / User Management / Vector Admin nav entries [FE-POR-0003.1]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `d28b2f5` (2026-05-14): refactor(nav): final bucket reshape per Rick's locked spec (mig 192)
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `0bab39c` (2026-05-16): refactor(work-items): chip swap StarburstFilter → NavigationPie + multi-value filter shape
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `35ecd8d` (2026-05-16): feat(vector_artefacts): green — backfill artefacts_types_slot per workspace [00583]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `d6c660e` (2026-05-18): docs(claude): add swarm stack pointer to working-practices index
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > `types.go:333` currently `{epic, story, task, defect, portfolio item}` — work-only. Move to scope-keyed map: `validItemTypesByScope["work"]` and `validItemTypesByScope["strategy"]` (latter pulled from seed-data list of 51 strategy artefact types). Validation paths consult the right slice based on service's scope.
  >
- **B21.1.6** Generalise `SummariseWorkItems` to scope-shaped summary `[P1]` `[ ]B21.1.4`
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `a6db775` (2026-05-14): fix(nav): AccountFlyout only shows avatar_menu tag, not rail-1 admin buckets
> Commit `90a1c04` (2026-05-16): fix(PageSummaryHeader): suppress help icon on the inner Panel
> Commit `36a15a6` (2026-05-17): feat(page-summary): add danger tone to SummaryCellTone (TD-SUMMARY-TONE)
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
  > Currently returns hardcoded `{total, epics, stories, tasks, defects, blocked}`. Make summary buckets data-driven from artefact-types of the current scope. Strategy summary should return `{total, themes, objectives, features}` per existing portfolio page contract. Pattern: GROUP BY `at.code`, project into stable JSON keys per scope config.
  >
- **B21.1.7** Register `/portfolio-items` routes against `artefactitemsv2.New(db, "strategy")` in `main.go` `[P1]` `[ ]B21.1.4` `[ ]B21.1.6`
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `0d330a7` (2026-05-13): feat(PLA-0043): dev pages as 2nd-rail nav — remove tab strip, register 13 pages in shell catalogue [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `4ab58a3` (2026-05-13): chore(PLA-0039): delete empty /samantha/v1 chi block from router [FE-POR-0003]
> Commit `5bdf3be` (2026-05-13): docs(PLA-0030): document 5 missing /samantha/v2 routes in openapi-v2.yaml
> Commit `2e9ff2d` (2026-05-13): chore: memory rule + 4 deferrals filed in tech-debt register [TD-AUTH-001 TD-API-002 TD-API-003 TD-API-004]
> Commit `71f127e` (2026-05-13): feat: dev/scripts/pace.sh — commit-mix + TD-register scoreboard
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > Mirror existing `/work-items` route group. Reuse same handler — only the scope-bound service differs. Do NOT remove `/work-items` routes; both run side-by-side.
  >
- **B21.1.8** Backend regression — existing `/work-items` contract unchanged `[P1]` `[ ]B21.1.7`
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `6513cfd` (2026-05-09): fix(B22): dynamic ID column width tracks max visible depth in ResourceTree
> Commit `3f0dbbe` (2026-05-09): fix(B22): fix dynamic ID column — re-fit on width change, floor at declared width
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `8ada5e5` (2026-05-11): refactor: nest Organisation & Work Items under Vector Admin tab
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `bb18aa4` (2026-05-12): feat(PLA-0044): walkTopology Go mirror + cross-runtime parity tests [FE-POR-API-0006]
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `3790542` (2026-05-13): feat(PLA-0043): persist mixed tag+group bucket order per nav profile [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `545ebbd` (2026-05-13): feat(PLA-0043): tag bucket icon overrides in nav preferences [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `4411327` (2026-05-13): feat(PLA-0026/SA1): remove legacy vectorPool saga writes — VA is now sole write path [FE-POR-0003]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `4ab58a3` (2026-05-13): chore(PLA-0039): delete empty /samantha/v1 chi block from router [FE-POR-0003]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7773c95` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_sessions (§2.3) [RF1.4.4.users_sessions]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `5b7fac9` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `0bab39c` (2026-05-16): refactor(work-items): chip swap StarburstFilter → NavigationPie + multi-value filter shape
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `f944e5a` (2026-05-16): test(artefacttypes): red — F3 slot substrate [00603]
> Commit `454004c` (2026-05-16): test(artefactitems): red — F4 UUID wire end-to-end [00604]
> Commit `09f9fdb` (2026-05-16): feat(vector_artefacts): green — slot enum substrate on artefacts_types [00582]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `146430c` (2026-05-16): test(priority): red — F7 substrate [00607]
> Commit `cb77d87` (2026-05-16): test(priority): red — F8 CRUD + UUID wire [00608]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `5eba458` (2026-05-16): fix(test): bulk set_priority payload uses priority_id UUID [00595,00597 fixup]
> Commit `206b5e2` (2026-05-16): docs(tech-debt): file 6 TD entries from backend test-failure inventory
> Commit `2f905e5` (2026-05-16): docs(tech-debt): file 3 more TDs from regression-triage pass
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `e41ed3c` (2026-05-17): fix(errorsreport): correct wire-shape assertion in TestReport_UnknownCode (TD-ERRORSREPORT-WIRE-SHAPE)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `7839d3d` (2026-05-18): feat(auth): stamp + validate JWT iss/aud claims [B16.8.8]
> Commit `d32ebd9` (2026-05-18): test(realtime): failing WS-revoke integration + registry unit tests [B16.8.12]
> Commit `47c2ca8` (2026-05-18): feat(realtime): WS session registry [B16.8.12]
> Commit `55a679d` (2026-05-18): feat(realtime): WS session sweeper + immediate-close [B16.8.12]
> Commit `c5d96ba` (2026-05-18): feat(auth/realtime): plumb sid into WS via context + Hub.CloseSession [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `c40d494` (2026-05-18): fix(realtime): gate ServeWS conn.Close so first frame wins [B16.8.12]
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > Run `backend/internal/artefactitemsv2/*_test.go` after rename. Add canary test: GET `/work-items?scope=work` returns identical payload to pre-rename. No new fields, no removed fields.
  >

- **B21.2** Frontend — generic hook + sidecar JSON drives endpoint `[P1]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3dc9cdd` (2026-05-09): chore(plans): normalise unicode escapes in PLA plan files
> Commit `0ffe20d` (2026-05-09): chore: refresh local IDE state and launcher log
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `1e010e2` (2026-05-12): chore(scope): Vector_Scope progress sweep + PLA-0022 date bump + R051 research entry
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `96b7f25` (2026-05-12): docs(research): R052 Rally scope mechanics + R053 Rally/Jira/ADO comparison; backfill PLA-0042.md
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `3963bbb` (2026-05-12): feat(PLA-0043): scope rail polish — auto-width, spine elbows, vector scrollbar [FE-POR-0003.1]
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `32002b3` (2026-05-12): docs(R054): Rally user-to-project assignment UX research
> Commit `6d568c0` (2026-05-12): docs(PLA-0044,PLA-0045): plan JSONs for /dev Plans tab + story-index bump to 00549 [FE-DEV-0025]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `ea4862c` (2026-05-12): fix(PLA-0044): ScopeRail uses walkTopology + byPosition — kills phantom-D orphan re-root [FE-POR-API-0006]
> Commit `0a2ee86` (2026-05-12): docs(PLA-0044): close out plan — catalogue row + index + plan JSON [FE-DEV-0025]
> Commit `816fbf7` (2026-05-12): chore: mcp whisper stdio type + theme slot-name sanitisation
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `1bc9958` (2026-05-13): feat(PLA-0026/SA2): add artefact_adoption_state to vector_artefacts [FE-SQL-0019]
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `952cc41` (2026-05-13): plan(PLA-0048): codebase recovery — lock conventions, install drift gates, consolidate SQL [RF1]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `d00e3d1` (2026-05-14): chore(PLA-0048 / RF1.4.4): ship lint:column-prefix-convention (warn-only) [RF1.4.4]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7773c95` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_sessions (§2.3) [RF1.4.4.users_sessions]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `44f56a1` (2026-05-16): chore(claude): post-edit lint hook, dev-env lockdown, postgres MCP wrapper
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `162d382` (2026-05-16): test(catalogue): red — F5 catalogue + chip + localStorage + sidecar [00605]
> Commit `955d421` (2026-05-16): chore(claude): un-gitignore .claude/settings.json — single-user multi-machine sync
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `c630ee7` (2026-05-16): chore(plans): merge orphan ACs + sync 00595/00597 done flags
> Commit `6bbaa70` (2026-05-16): chore(plans): stamp dates + flip backlog/AC status for PLA-0053/0054/0055
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > Replace hardcoded `useWorkItemsWindow` consumption in `p_ObjectTree.tsx` with config-driven `useArtefactItemsWindow(resourceUrl, scope)` reading from `p_wizard_*.json`.
  >
- **B21.2.1** Rename hook file `app/hooks/useWorkItemsWindow.ts` → `app/hooks/useArtefactItemsWindow.ts` `[P1]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `1e010e2` (2026-05-12): chore(scope): Vector_Scope progress sweep + PLA-0022 date bump + R051 research entry
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `96b7f25` (2026-05-12): docs(research): R052 Rally scope mechanics + R053 Rally/Jira/ADO comparison; backfill PLA-0042.md
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `3963bbb` (2026-05-12): feat(PLA-0043): scope rail polish — auto-width, spine elbows, vector scrollbar [FE-POR-0003.1]
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `ea4862c` (2026-05-12): fix(PLA-0044): ScopeRail uses walkTopology + byPosition — kills phantom-D orphan re-root [FE-POR-API-0006]
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `a8c9c3a` (2026-05-13): refactor(PLA-0044): rename rd-topbar → nav-top-bar — CSS naming convention [FE-UI-0001]
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `4e1e171` (2026-05-14): docs(PLA-0048 / RF1.6): documentation pass — regenerate docs to post-rename truth [RF1.6]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `44f56a1` (2026-05-16): chore(claude): post-edit lint hook, dev-env lockdown, postgres MCP wrapper
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `3f4009c` (2026-05-16): test(chip): red — F6 Status context + rename invariance [00606]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > Function signature accepts `resourceUrl: string` and `scope: string` as required props. Internal fetch builds URL from these instead of hardcoding `/work-items`.
  >
- **B21.2.2** Update `app/components/ObjectTree/p_ObjectTree.tsx:97` to pass `resourceUrl`/`scope` from config `[P1]` `[ ]B21.2.1`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `6513cfd` (2026-05-09): fix(B22): dynamic ID column width tracks max visible depth in ResourceTree
> Commit `9df45f8` (2026-05-09): fix(B22): add type_prefix to p_ObjectTree test fixture
> Commit `3f0dbbe` (2026-05-09): fix(B22): fix dynamic ID column — re-fit on width change, floor at declared width
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `1e010e2` (2026-05-12): chore(scope): Vector_Scope progress sweep + PLA-0022 date bump + R051 research entry
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `96b7f25` (2026-05-12): docs(research): R052 Rally scope mechanics + R053 Rally/Jira/ADO comparison; backfill PLA-0042.md
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `3963bbb` (2026-05-12): feat(PLA-0043): scope rail polish — auto-width, spine elbows, vector scrollbar [FE-POR-0003.1]
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `ea4862c` (2026-05-12): fix(PLA-0044): ScopeRail uses walkTopology + byPosition — kills phantom-D orphan re-root [FE-POR-API-0006]
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `0bab39c` (2026-05-16): refactor(work-items): chip swap StarburstFilter → NavigationPie + multi-value filter shape
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `72f2430` (2026-05-16): feat(tree): per-row cog menu in dense tree (edit/duplicate/move/split/delete)
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > Read `wizardConfig.resourceUrl` and `wizardConfig.scope` (new optional fields on `ObjectTreeDataConfig<T>`). Default to legacy `/work-items` + `work` if absent for backward compat during cutover.
  >
- **B21.2.3** Add `resourceUrl` + `scope` to wizard JSON files `[P1]` `[ ]B21.2.2`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3dc9cdd` (2026-05-09): chore(plans): normalise unicode escapes in PLA plan files
> Commit `0ffe20d` (2026-05-09): chore: refresh local IDE state and launcher log
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `1e010e2` (2026-05-12): chore(scope): Vector_Scope progress sweep + PLA-0022 date bump + R051 research entry
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `96b7f25` (2026-05-12): docs(research): R052 Rally scope mechanics + R053 Rally/Jira/ADO comparison; backfill PLA-0042.md
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `3963bbb` (2026-05-12): feat(PLA-0043): scope rail polish — auto-width, spine elbows, vector scrollbar [FE-POR-0003.1]
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `32002b3` (2026-05-12): docs(R054): Rally user-to-project assignment UX research
> Commit `6d568c0` (2026-05-12): docs(PLA-0044,PLA-0045): plan JSONs for /dev Plans tab + story-index bump to 00549 [FE-DEV-0025]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `ea4862c` (2026-05-12): fix(PLA-0044): ScopeRail uses walkTopology + byPosition — kills phantom-D orphan re-root [FE-POR-API-0006]
> Commit `0a2ee86` (2026-05-12): docs(PLA-0044): close out plan — catalogue row + index + plan JSON [FE-DEV-0025]
> Commit `816fbf7` (2026-05-12): chore: mcp whisper stdio type + theme slot-name sanitisation
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `d9dfe8e` (2026-05-13): feat(001_redesign): Available panel mirrors Pinned bucket order with animated reflow [FE-POR-0003.1]
> Commit `1bc9958` (2026-05-13): feat(PLA-0026/SA2): add artefact_adoption_state to vector_artefacts [FE-SQL-0019]
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `952cc41` (2026-05-13): plan(PLA-0048): codebase recovery — lock conventions, install drift gates, consolidate SQL [RF1]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `d00e3d1` (2026-05-14): chore(PLA-0048 / RF1.4.4): ship lint:column-prefix-convention (warn-only) [RF1.4.4]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7773c95` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_sessions (§2.3) [RF1.4.4.users_sessions]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `44f56a1` (2026-05-16): chore(claude): post-edit lint hook, dev-env lockdown, postgres MCP wrapper
> Commit `955d421` (2026-05-16): chore(claude): un-gitignore .claude/settings.json — single-user multi-machine sync
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `c630ee7` (2026-05-16): chore(plans): merge orphan ACs + sync 00595/00597 done flags
> Commit `6bbaa70` (2026-05-16): chore(plans): stamp dates + flip backlog/AC status for PLA-0053/0054/0055
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > `p_wizard_workitems.json`: `{ "resourceUrl": "/work-items", "scope": "work" }`. `p_wizard_portfolio.json`: `{ "resourceUrl": "/portfolio-items", "scope": "strategy" }`.
  >
- **B21.2.4** Extend `ObjectTreeDataConfig<T>` interface in `p_ObjectTree.tsx` `[P1]` `[ ]B21.2.3`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `1e010e2` (2026-05-12): chore(scope): Vector_Scope progress sweep + PLA-0022 date bump + R051 research entry
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `96b7f25` (2026-05-12): docs(research): R052 Rally scope mechanics + R053 Rally/Jira/ADO comparison; backfill PLA-0042.md
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `3963bbb` (2026-05-12): feat(PLA-0043): scope rail polish — auto-width, spine elbows, vector scrollbar [FE-POR-0003.1]
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `ea4862c` (2026-05-12): fix(PLA-0044): ScopeRail uses walkTopology + byPosition — kills phantom-D orphan re-root [FE-POR-API-0006]
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `3a061a1` (2026-05-13): chore: session housekeeping — empirical-blast-radius memory + scope/snapshot refresh
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > Add optional `resourceUrl?: string` and `scope?: string`. `resolveWizardConfig` passes them through unchanged.
  >
- **B21.2.5** Update remaining call-sites that import `useWorkItemsWindow` directly `[P2]` `[ ]B21.2.1`
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `a8c9c3a` (2026-05-13): refactor(PLA-0044): rename rd-topbar → nav-top-bar — CSS naming convention [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `4e1e171` (2026-05-14): docs(PLA-0048 / RF1.6): documentation pass — regenerate docs to post-rename truth [RF1.6]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `3f4009c` (2026-05-16): test(chip): red — F6 Status context + rename invariance [00606]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
  > `grep -rn "useWorkItemsWindow"` to enumerate. Most should be replaced; any pre-PLA-0030 holdouts get the rename.
  >

- **B21.3** Tests, docs, lint, cutover hygiene `[P2]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `9df45f8` (2026-05-09): fix(B22): add type_prefix to p_ObjectTree test fixture
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `96b7f25` (2026-05-12): docs(research): R052 Rally scope mechanics + R053 Rally/Jira/ADO comparison; backfill PLA-0042.md
> Commit `cc38e98` (2026-05-12): docs(PLA-0043): handover for cross-machine continuation [FE-POR-API-0002]
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `32002b3` (2026-05-12): docs(R054): Rally user-to-project assignment UX research
> Commit `6d568c0` (2026-05-12): docs(PLA-0044,PLA-0045): plan JSONs for /dev Plans tab + story-index bump to 00549 [FE-DEV-0025]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `bb18aa4` (2026-05-12): feat(PLA-0044): walkTopology Go mirror + cross-runtime parity tests [FE-POR-API-0006]
> Commit `0a2ee86` (2026-05-12): docs(PLA-0044): close out plan — catalogue row + index + plan JSON [FE-DEV-0025]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `5bdf3be` (2026-05-13): docs(PLA-0030): document 5 missing /samantha/v2 routes in openapi-v2.yaml
> Commit `2e9ff2d` (2026-05-13): chore: memory rule + 4 deferrals filed in tech-debt register [TD-AUTH-001 TD-API-002 TD-API-003 TD-API-004]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `952cc41` (2026-05-13): plan(PLA-0048): codebase recovery — lock conventions, install drift gates, consolidate SQL [RF1]
> Commit `a8c32ec` (2026-05-14): docs(PLA-0048 / RF1.0): lock hierarchical table + column-prefix naming rules
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `b4627dd` (2026-05-14): docs(PLA-0048 / RF1.4.4): file TD-NAME-001 for deferred column-prefix sweeps [RF1.4.4]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `4e1e171` (2026-05-14): docs(PLA-0048 / RF1.6): documentation pass — regenerate docs to post-rename truth [RF1.6]
> Commit `d00e3d1` (2026-05-14): chore(PLA-0048 / RF1.4.4): ship lint:column-prefix-convention (warn-only) [RF1.4.4]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `1222483` (2026-05-14): docs: add MY_HANDOVER.md — session handover for 2026-05-14 RF1.4.4 conveyor
> Commit `d28b2f5` (2026-05-14): refactor(nav): final bucket reshape per Rick's locked spec (mig 192)
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `9ec3523` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `5b7fac9` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `e367266` (2026-05-15): docs: handover — table catalog restyle + permissions tree-lines session
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `b343d51` (2026-05-16): feat(NavigationPie): full-circle pie filter primitive + dev showcase
> Commit `817922b` (2026-05-16): docs: file TD-FILTER-MULTI + URL-state purge backlog item
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `44f56a1` (2026-05-16): chore(claude): post-edit lint hook, dev-env lockdown, postgres MCP wrapper
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `f944e5a` (2026-05-16): test(artefacttypes): red — F3 slot substrate [00603]
> Commit `454004c` (2026-05-16): test(artefactitems): red — F4 UUID wire end-to-end [00604]
> Commit `162d382` (2026-05-16): test(catalogue): red — F5 catalogue + chip + localStorage + sidecar [00605]
> Commit `3f4009c` (2026-05-16): test(chip): red — F6 Status context + rename invariance [00606]
> Commit `09f9fdb` (2026-05-16): feat(vector_artefacts): green — slot enum substrate on artefacts_types [00582]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `146430c` (2026-05-16): test(priority): red — F7 substrate [00607]
> Commit `cb77d87` (2026-05-16): test(priority): red — F8 CRUD + UUID wire [00608]
> Commit `37c9929` (2026-05-16): test(priority): red — F9 catalogue + chip + Showstopper [00609]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `206b5e2` (2026-05-16): docs(tech-debt): file 6 TD entries from backend test-failure inventory
> Commit `2f905e5` (2026-05-16): docs(tech-debt): file 3 more TDs from regression-triage pass
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `7ed1728` (2026-05-16): feat(skill): add <tests> shortcut for Tracker red-green test queries
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `9c45ef2` (2026-05-17): chore(tech-debt): triage 2026-05-17 — mark 3 resolved, flag DB-002 trigger
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `e41ed3c` (2026-05-17): fix(errorsreport): correct wire-shape assertion in TestReport_UnknownCode (TD-ERRORSREPORT-WIRE-SHAPE)
> Commit `36a15a6` (2026-05-17): feat(page-summary): add danger tone to SummaryCellTone (TD-SUMMARY-TONE)
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `85447e4` (2026-05-18): docs(cookbook): side-instance + JWT-decode + login-smoke entries [B16.8.11]
> Commit `66a7e32` (2026-05-18): docs(security): clarify 15-min access TTL is defense in depth [B16.8.9]
> Commit `d32ebd9` (2026-05-18): test(realtime): failing WS-revoke integration + registry unit tests [B16.8.12]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `8729c54` (2026-05-18): feat(ops): vector-dev swarm stack as infra-as-code + pg_stat_statements
> Commit `d6c660e` (2026-05-18): docs(claude): add swarm stack pointer to working-practices index
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
  > Cement the substrate so it can't regress.
  >
- **B21.3.1** Backend integration test — `/portfolio-items` returns strategy artefacts only `[P1]` `[ ]B21.1.7`
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `9df45f8` (2026-05-09): fix(B22): add type_prefix to p_ObjectTree test fixture
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `b1c5b15` (2026-05-12): feat(PLA-0042): chrome scope picker — backend grants + ScopeContext + picker UI [FE-POR-0002]
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `06883fd` (2026-05-12): feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `bb18aa4` (2026-05-12): feat(PLA-0044): walkTopology Go mirror + cross-runtime parity tests [FE-POR-API-0006]
> Commit `e5ef452` (2026-05-12): feat(PLA-0044): MyGrant.position field + ListMyGrants ORDER BY sort_order [FE-POR-API-0006]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `3790542` (2026-05-13): feat(PLA-0043): persist mixed tag+group bucket order per nav profile [FE-POR-0003.1]
> Commit `51776f3` (2026-05-13): fix(PLA-0043): lazy-seed admin nav groups + profile placements on Default profile fetch [FE-POR-0003.1]
> Commit `545ebbd` (2026-05-13): feat(PLA-0043): tag bucket icon overrides in nav preferences [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `13dc98c` (2026-05-13): fix(PLA-0043): self-heal group_id on prefs when groups already exist [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `07612ca` (2026-05-13): fix(001_redesign): seed non-default nav profile from Default on first read [FE-POR-0003.1]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `4411327` (2026-05-13): feat(PLA-0026/SA1): remove legacy vectorPool saga writes — VA is now sole write path [FE-POR-0003]
> Commit `1bc9958` (2026-05-13): feat(PLA-0026/SA2): add artefact_adoption_state to vector_artefacts [FE-SQL-0019]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `4ab58a3` (2026-05-13): chore(PLA-0039): delete empty /samantha/v1 chi block from router [FE-POR-0003]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7773c95` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_sessions (§2.3) [RF1.4.4.users_sessions]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `3ad9531` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix RBAC triangle [RF1.4.4.users_roles_rbac]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `5cff509` (2026-05-14): feat(nav): Reset to defaults button on /preferences/navigation
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `9ec3523` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `5b7fac9` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `b343d51` (2026-05-16): feat(NavigationPie): full-circle pie filter primitive + dev showcase
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `f50f4c3` (2026-05-16): feat(stories): auto-provision tracker groups via rg-runner -create-if-missing
> Commit `f944e5a` (2026-05-16): test(artefacttypes): red — F3 slot substrate [00603]
> Commit `454004c` (2026-05-16): test(artefactitems): red — F4 UUID wire end-to-end [00604]
> Commit `162d382` (2026-05-16): test(catalogue): red — F5 catalogue + chip + localStorage + sidecar [00605]
> Commit `3f4009c` (2026-05-16): test(chip): red — F6 Status context + rename invariance [00606]
> Commit `09f9fdb` (2026-05-16): feat(vector_artefacts): green — slot enum substrate on artefacts_types [00582]
> Commit `35ecd8d` (2026-05-16): feat(vector_artefacts): green — backfill artefacts_types_slot per workspace [00583]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `146430c` (2026-05-16): test(priority): red — F7 substrate [00607]
> Commit `cb77d87` (2026-05-16): test(priority): red — F8 CRUD + UUID wire [00608]
> Commit `37c9929` (2026-05-16): test(priority): red — F9 catalogue + chip + Showstopper [00609]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `5eba458` (2026-05-16): fix(test): bulk set_priority payload uses priority_id UUID [00595,00597 fixup]
> Commit `206b5e2` (2026-05-16): docs(tech-debt): file 6 TD entries from backend test-failure inventory
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `7ed1728` (2026-05-16): feat(skill): add <tests> shortcut for Tracker red-green test queries
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `e41ed3c` (2026-05-17): fix(errorsreport): correct wire-shape assertion in TestReport_UnknownCode (TD-ERRORSREPORT-WIRE-SHAPE)
> Commit `3946caa` (2026-05-18): feat(scope): persist active scope to user profile; grouped scope panel; backend grant check
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `7839d3d` (2026-05-18): feat(auth): stamp + validate JWT iss/aud claims [B16.8.8]
> Commit `d32ebd9` (2026-05-18): test(realtime): failing WS-revoke integration + registry unit tests [B16.8.12]
> Commit `47c2ca8` (2026-05-18): feat(realtime): WS session registry [B16.8.12]
> Commit `55a679d` (2026-05-18): feat(realtime): WS session sweeper + immediate-close [B16.8.12]
> Commit `c5d96ba` (2026-05-18): feat(auth/realtime): plumb sid into WS via context + Hub.CloseSession [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `1ce3607` (2026-05-18): feat(server): start WS session sweeper alongside rank listener [B16.8.12]
> Commit `c40d494` (2026-05-18): fix(realtime): gate ServeWS conn.Close so first frame wins [B16.8.12]
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > Seed two artefacts (one scope=`work`, one scope=`strategy`) in test DB. Assert `/work-items` returns the work one only; `/portfolio-items` returns the strategy one only. Catches scope-leak regressions.
  >
- **B21.3.2** Frontend unit test — `p_ObjectTree` calls correct endpoint per config `[P2]` `[ ]B21.2.4`
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `9df45f8` (2026-05-09): fix(B22): add type_prefix to p_ObjectTree test fixture
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `bb18aa4` (2026-05-12): feat(PLA-0044): walkTopology Go mirror + cross-runtime parity tests [FE-POR-API-0006]
> Commit `05cead9` (2026-05-13): fix(001_redesign): nav-v2 route corrections + travel indicator anchor [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `4411327` (2026-05-13): feat(PLA-0026/SA1): remove legacy vectorPool saga writes — VA is now sole write path [FE-POR-0003]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `ea52620` (2026-05-14): refactor(PLA-0048 / RF1.4.2.pages): rename page_* → pages_* + column-prefix [RF1.4.2.pages]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `9ec3523` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `5b7fac9` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `b343d51` (2026-05-16): feat(NavigationPie): full-circle pie filter primitive + dev showcase
> Commit `0bab39c` (2026-05-16): refactor(work-items): chip swap StarburstFilter → NavigationPie + multi-value filter shape
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `f50f4c3` (2026-05-16): feat(stories): auto-provision tracker groups via rg-runner -create-if-missing
> Commit `f944e5a` (2026-05-16): test(artefacttypes): red — F3 slot substrate [00603]
> Commit `454004c` (2026-05-16): test(artefactitems): red — F4 UUID wire end-to-end [00604]
> Commit `162d382` (2026-05-16): test(catalogue): red — F5 catalogue + chip + localStorage + sidecar [00605]
> Commit `3f4009c` (2026-05-16): test(chip): red — F6 Status context + rename invariance [00606]
> Commit `09f9fdb` (2026-05-16): feat(vector_artefacts): green — slot enum substrate on artefacts_types [00582]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `146430c` (2026-05-16): test(priority): red — F7 substrate [00607]
> Commit `cb77d87` (2026-05-16): test(priority): red — F8 CRUD + UUID wire [00608]
> Commit `37c9929` (2026-05-16): test(priority): red — F9 catalogue + chip + Showstopper [00609]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `5eba458` (2026-05-16): fix(test): bulk set_priority payload uses priority_id UUID [00595,00597 fixup]
> Commit `206b5e2` (2026-05-16): docs(tech-debt): file 6 TD entries from backend test-failure inventory
> Commit `7ed1728` (2026-05-16): feat(skill): add <tests> shortcut for Tracker red-green test queries
> Commit `72f2430` (2026-05-16): feat(tree): per-row cog menu in dense tree (edit/duplicate/move/split/delete)
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `f0bb686` (2026-05-17): feat(nav): bookmark bucket in Rail 2
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `e41ed3c` (2026-05-17): fix(errorsreport): correct wire-shape assertion in TestReport_UnknownCode (TD-ERRORSREPORT-WIRE-SHAPE)
> Commit `ded3f12` (2026-05-18): feat(auth): capture users_sessions_id at session insert [B16.8.11]
> Commit `b922d58` (2026-05-18): feat(auth): stamp sid claim on access tokens [B16.8.11]
> Commit `a3e9250` (2026-05-18): feat(auth): per-request session check via sid claim [B16.8.11]
> Commit `5994665` (2026-05-18): feat(frontend): route session_revoked / idle_expired to hard-logout [B16.8.11]
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `1a6cbcb` (2026-05-18): chore(auth-meta): correct login endpoint + B16.8.6–.12 scope-refs [B16.8.11]
> Commit `7839d3d` (2026-05-18): feat(auth): stamp + validate JWT iss/aud claims [B16.8.8]
> Commit `d32ebd9` (2026-05-18): test(realtime): failing WS-revoke integration + registry unit tests [B16.8.12]
> Commit `55a679d` (2026-05-18): feat(realtime): WS session sweeper + immediate-close [B16.8.12]
> Commit `c5d96ba` (2026-05-18): feat(auth/realtime): plumb sid into WS via context + Hub.CloseSession [B16.8.12]
> Commit `89fc6fa` (2026-05-18): feat(frontend): route WS close codes 4001/4002 to hardLogout [B16.8.12]
> Commit `c40d494` (2026-05-18): fix(realtime): gate ServeWS conn.Close so first frame wins [B16.8.12]
> Commit `bde26f3` (2026-05-18): fix(realtime): sweeper closes orphan WS when users_sessions row deleted [B16.8.12]
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > Mock `useArtefactItemsWindow`; render with `p_wizard_portfolio.json`; assert `resourceUrl` arg = `/portfolio-items`.
  >
- **B21.3.3** Spec doc — `docs/c_c_wizard_sidecar.md` `[P2]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `96b7f25` (2026-05-12): docs(research): R052 Rally scope mechanics + R053 Rally/Jira/ADO comparison; backfill PLA-0042.md
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `cc38e98` (2026-05-12): docs(PLA-0043): handover for cross-machine continuation [FE-POR-API-0002]
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `32002b3` (2026-05-12): docs(R054): Rally user-to-project assignment UX research
> Commit `6d568c0` (2026-05-12): docs(PLA-0044,PLA-0045): plan JSONs for /dev Plans tab + story-index bump to 00549 [FE-DEV-0025]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `0a2ee86` (2026-05-12): docs(PLA-0044): close out plan — catalogue row + index + plan JSON [FE-DEV-0025]
> Commit `9c29056` (2026-05-13): feat(001_redesign): Layout 04 shell — icon rail + section flyout at /redesign
> Commit `01347cf` (2026-05-13): feat(001_redesign): swap (user) layout to redesign shell — rail + flyout live site-wide
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `5bdf3be` (2026-05-13): docs(PLA-0030): document 5 missing /samantha/v2 routes in openapi-v2.yaml
> Commit `2e9ff2d` (2026-05-13): chore: memory rule + 4 deferrals filed in tech-debt register [TD-AUTH-001 TD-API-002 TD-API-003 TD-API-004]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `952cc41` (2026-05-13): plan(PLA-0048): codebase recovery — lock conventions, install drift gates, consolidate SQL [RF1]
> Commit `a8c32ec` (2026-05-14): docs(PLA-0048 / RF1.0): lock hierarchical table + column-prefix naming rules
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `b4627dd` (2026-05-14): docs(PLA-0048 / RF1.4.4): file TD-NAME-001 for deferred column-prefix sweeps [RF1.4.4]
> Commit `4e1e171` (2026-05-14): docs(PLA-0048 / RF1.6): documentation pass — regenerate docs to post-rename truth [RF1.6]
> Commit `d00e3d1` (2026-05-14): chore(PLA-0048 / RF1.4.4): ship lint:column-prefix-convention (warn-only) [RF1.4.4]
> Commit `2c4fc9b` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_password_resets (§2.3) [RF1.4.4.users_pw]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `586d050` (2026-05-14): chore(PLA-0048): close session scope — TD-RESET-001 fix + scope markers [RF1.4.4][RF1.5][RF1.6]
> Commit `1222483` (2026-05-14): docs: add MY_HANDOVER.md — session handover for 2026-05-14 RF1.4.4 conveyor
> Commit `d28b2f5` (2026-05-14): refactor(nav): final bucket reshape per Rick's locked spec (mig 192)
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `9ec3523` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `5b7fac9` (2026-05-15): chore(td): file TD-ROLE-001 + TD-TEST-002 — Phase 0 carry-overs [PLA-0049]
> Commit `069f621` (2026-05-15): feat(pageaccess): PLA-0049 Phase 0.5 — page-access enforcement primitive [PLA-0049]
> Commit `e367266` (2026-05-15): docs: handover — table catalog restyle + permissions tree-lines session
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `817922b` (2026-05-16): docs: file TD-FILTER-MULTI + URL-state purge backlog item
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `162d382` (2026-05-16): test(catalogue): red — F5 catalogue + chip + localStorage + sidecar [00605]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `206b5e2` (2026-05-16): docs(tech-debt): file 6 TD entries from backend test-failure inventory
> Commit `2f905e5` (2026-05-16): docs(tech-debt): file 3 more TDs from regression-triage pass
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `9c45ef2` (2026-05-17): chore(tech-debt): triage 2026-05-17 — mark 3 resolved, flag DB-002 trigger
> Commit `728f01d` (2026-05-17): fix(nav): delete TestReplacePrefs_RejectsDevSetup — stale sentinel (TD-NAV-DEV-ITEM-RENAMED)
> Commit `e41ed3c` (2026-05-17): fix(errorsreport): correct wire-shape assertion in TestReport_UnknownCode (TD-ERRORSREPORT-WIRE-SHAPE)
> Commit `36a15a6` (2026-05-17): feat(page-summary): add danger tone to SummaryCellTone (TD-SUMMARY-TONE)
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
> Commit `3cacf3c` (2026-05-18): feat(auth): TLS auto-detect on every cookie setter [B16.8.7]
> Commit `85447e4` (2026-05-18): docs(cookbook): side-instance + JWT-decode + login-smoke entries [B16.8.11]
> Commit `66a7e32` (2026-05-18): docs(security): clarify 15-min access TTL is defense in depth [B16.8.9]
> Commit `75bc7c4` (2026-05-18): docs(security): pin WS_SESSION_CHECK_INTERVAL contract + B16.8.12 scope [B16.8.12]
> Commit `2646566` (2026-05-18): feat(auth): backend slice for active sessions + step-up reauth [B16.8.10]
> Commit `8729c54` (2026-05-18): feat(ops): vector-dev swarm stack as infra-as-code + pg_stat_statements
> Commit `d6c660e` (2026-05-18): docs(claude): add swarm stack pointer to working-practices index
> Commit `bf9222c` (2026-05-18): feat(account-settings): active sessions UI + step-up reauth hook [B16.8.10]
> Commit `627ddd1` (2026-05-18): feat(security): DOMPurify wraps on help-content render sites [B16.8.P2]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
> Commit `dfcaa9e` (2026-05-18): feat(auth): HIBP breach-password check (k-anonymity) [B16.8.P4]
  > Document the sidecar pattern: schema for `p_wizard_*.json`, contract for `resolveWizardConfig`, what stays in JSON vs. what is injected by the page (closures/React nodes). Add CLAUDE.md index pointer.
  >
- **B21.3.4** Lint rule `lint:scope-literals` `[P3]` `[ ]B21.1.4`
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `0ffe20d` (2026-05-09): chore: refresh local IDE state and launcher log
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `6513cfd` (2026-05-09): fix(B22): dynamic ID column width tracks max visible depth in ResourceTree
> Commit `3f0dbbe` (2026-05-09): fix(B22): fix dynamic ID column — re-fit on width change, floor at declared width
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `743b077` (2026-05-10): feat(roles): drop MVP single-admin workspace constraint
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `8ada5e5` (2026-05-11): refactor: nest Organisation & Work Items under Vector Admin tab
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `1cb8b7d` (2026-05-11): refactor: tenant-aware subtitle on Vector Admin tab
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `d4a48bb` (2026-05-12): chore(PLA-0041): wire Flow States v2 secondary-nav tab on workspace-settings
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `cc38e98` (2026-05-12): docs(PLA-0043): handover for cross-machine continuation [FE-POR-API-0002]
> Commit `32002b3` (2026-05-12): docs(R054): Rally user-to-project assignment UX research
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `fea4fc9` (2026-05-12): feat(PLA-0043): chrome rework — typecase.css, viewport-anchored title, breadcrumbs [FE-POR-0003.1]
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `8825bab` (2026-05-13): feat(PLA-0043): add Workspace Admin / User Management / Vector Admin nav entries [FE-POR-0003.1]
> Commit `45cb68c` (2026-05-13): feat(PLA-0043): seed Vector Admin / Workspace Admin / User Management nav groups [FE-POR-0003.1]
> Commit `101aaf3` (2026-05-13): feat(PLA-0043): Workspace Admin sub-page catalogue entries [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `e529fc1` (2026-05-13): fix(PLA-0043): fix _shared import paths in relocated admin route trees [FE-POR-0003.1]
> Commit `b8d1e66` (2026-05-13): fix(PLA-0043): dev_tools nav — auto-pin pages, Research first, remove hardcoded gear link [FE-POR-0003.1]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `2e3c142` (2026-05-14): refactor(PLA-0048 / RF1.2.1): rename package orgdesign → topology [RF1.2.1.rename]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `d0f31ee` (2026-05-14): refactor(PLA-0048 / RF1.4.2.subscriptions): rename subscription_* + entity_stakeholders [RF1.4.2.subscriptions]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `d00e3d1` (2026-05-14): chore(PLA-0048 / RF1.4.4): ship lint:column-prefix-convention (warn-only) [RF1.4.4]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `8cdb4a9` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_roles_workspaces (§2.3) [RF1.4.4.users_roles_workspaces]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `d28b2f5` (2026-05-14): refactor(nav): final bucket reshape per Rick's locked spec (mig 192)
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `fd1042e` (2026-05-15): feat(PLA-0032): Story 00565b — rename Go package tenantmasterrecord → workspacemasterrecord [PLA-0032]
> Commit `3288391` (2026-05-16): test(td): refresh test fixtures for retired role UUIDs + filed prod-bug [TD-TEST-002]
> Commit `0bab39c` (2026-05-16): refactor(work-items): chip swap StarburstFilter → NavigationPie + multi-value filter shape
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `44f56a1` (2026-05-16): chore(claude): post-edit lint hook, dev-env lockdown, postgres MCP wrapper
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `35ecd8d` (2026-05-16): feat(vector_artefacts): green — backfill artefacts_types_slot per workspace [00583]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `65d22c3` (2026-05-16): fix(fields): non-admin users hit 500 on workspace field list [TD-FIELDS-WSPERMS-RENAME]
> Commit `4641ce7` (2026-05-16): feat(auth): green — POST /auth/switch-workspace + topology switcher rewire [00576.5]
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `d32ebd9` (2026-05-18): test(realtime): failing WS-revoke integration + registry unit tests [B16.8.12]
> Commit `47c2ca8` (2026-05-18): feat(realtime): WS session registry [B16.8.12]
> Commit `d6c660e` (2026-05-18): docs(claude): add swarm stack pointer to working-practices index
> Commit `b2c64b6` (2026-05-18): fix(b16810): INET cast for sessions list + remove duplicate DELETE in workspaces Mount [B16.8.10]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
  > Forbid hardcoded `'work'`/`'strategy'` string literals in `*.go` files outside `artefactitemsv2/` and seed-data files. Prevents new scope leaks. Ledger under `dev/registries/scope-literals-allowlist.txt`.
  >
- **B21.3.5** Migration note — `docs/c_c_v1_v2_cutover.md` `[P2]` `[ ]B21.1.7`
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `a743bb3` (2026-05-13): chore(PLA-0023): drop dead defects table from mmff_vector [P0'/P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `82951c5` (2026-05-13): fix(PLA-0023): renumber library_ack drop + drop o_search_index_outbox [P1]
> Commit `49b0909` (2026-05-13): chore(PLA-0023): drop 2 dead-leaf legacy tables, hold user_nav_* [P0']
> Commit `b76ed1c` (2026-05-13): chore(PLA-0023): drop obj_flow_* legacy family from mmff_vector [P0']
> Commit `1cbe497` (2026-05-13): chore(PLA-0023): drop shadow master_record_tenant from mmff_vector [P2]
> Commit `3ff59f0` (2026-05-13): chore(PLA-0023): P5 verification pass — drop 2 dead leaves, map blockers [P5]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `c7c00c2` (2026-05-13): fix(PLA-0023): remove stale o_flow_tenant DELETE from dev_reset, clarify P5 blockers
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `c9c78c5` (2026-05-16): chore(claude): add /migration skill — DB schema scaffolder
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `5ccef56` (2026-05-18): feat(migration): users_reauth_nonces table for step-up reauth [B16.8.10]
  > Add row: `/portfolio-items` joins `/work-items` under `artefactitemsv2`. Mark v1 portfolio routes for deprecation timeline.
  >
- **B21.3.6** Update CLAUDE.md hard-rule index `[P3]` `[ ]B21.3.3`
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `9a959ad` (2026-05-12): docs(PLA-0044,PLA-0045): unified topology walker plan + shared methods catalogue substrate [FE-POR-0003.9.1] [FE-POR-API-0006]
> Commit `6d568c0` (2026-05-12): docs(PLA-0044,PLA-0045): plan JSONs for /dev Plans tab + story-index bump to 00549 [FE-DEV-0025]
> Commit `a5237f1` (2026-05-12): feat(PLA-0045): shared methods catalogue substrate — directories, lint allow-list, scope rows [B18.7]
> Commit `0a2ee86` (2026-05-12): docs(PLA-0044): close out plan — catalogue row + index + plan JSON [FE-DEV-0025]
> Commit `82951c5` (2026-05-13): fix(PLA-0023): renumber library_ack drop + drop o_search_index_outbox [P1]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `71f127e` (2026-05-13): feat: dev/scripts/pace.sh — commit-mix + TD-register scoreboard
> Commit `952cc41` (2026-05-13): plan(PLA-0048): codebase recovery — lock conventions, install drift gates, consolidate SQL [RF1]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `4e1e171` (2026-05-14): docs(PLA-0048 / RF1.6): documentation pass — regenerate docs to post-rename truth [RF1.6]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `162d382` (2026-05-16): test(catalogue): red — F5 catalogue + chip + localStorage + sidecar [00605]
> Commit `c9c78c5` (2026-05-16): chore(claude): add /migration skill — DB schema scaffolder
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `7ed1728` (2026-05-16): feat(skill): add <tests> shortcut for Tracker red-green test queries
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `d6c660e` (2026-05-18): docs(claude): add swarm stack pointer to working-practices index
  > Add pointer to `c_c_wizard_sidecar.md` under "Working practices" so future Claude sessions load the spec when touching `p_wizard_*.json`.
  >

- **B21.4** Deferred follow-ups (post-cutover) `[P4]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `b4627dd` (2026-05-14): docs(PLA-0048 / RF1.4.4): file TD-NAME-001 for deferred column-prefix sweeps [RF1.4.4]
  > Tracked here so they don't get lost; do NOT block B21.1–B21.3 completion.
  >
- **B21.4.1** Generalise `useRefetchOnPush` topic to scope-aware `[P3]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `1bc9958` (2026-05-13): feat(PLA-0026/SA2): add artefact_adoption_state to vector_artefacts [FE-SQL-0019]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `f944e5a` (2026-05-16): test(artefacttypes): red — F3 slot substrate [00603]
> Commit `454004c` (2026-05-16): test(artefactitems): red — F4 UUID wire end-to-end [00604]
> Commit `09f9fdb` (2026-05-16): feat(vector_artefacts): green — slot enum substrate on artefacts_types [00582]
> Commit `35ecd8d` (2026-05-16): feat(vector_artefacts): green — backfill artefacts_types_slot per workspace [00583]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `5eba458` (2026-05-16): fix(test): bulk set_priority payload uses priority_id UUID [00595,00597 fixup]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
  > Currently `rankTopic("work_item", ...)` and `rankTopic("portfolio_item", ...)` are separate. Consider unifying as `rankTopic("artefact", scope, ...)` once realtime fan-out can dispatch by scope.
  >
- **B21.4.2** Sidecar pattern adoption beyond `p_ObjectTree` `[P4]`
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `a743bb3` (2026-05-13): chore(PLA-0023): drop dead defects table from mmff_vector [P0'/P1]
> Commit `49b0909` (2026-05-13): chore(PLA-0023): drop 2 dead-leaf legacy tables, hold user_nav_* [P0']
> Commit `1bc9958` (2026-05-13): feat(PLA-0026/SA2): add artefact_adoption_state to vector_artefacts [FE-SQL-0019]
> Commit `94ce536` (2026-05-13): feat(PLA-0044): page template baseline — primitives, PageHeading, Panel description prop [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `a8c32ec` (2026-05-14): docs(PLA-0048 / RF1.0): lock hierarchical table + column-prefix naming rules
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `26bc100` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[A]): pluralise user_* nav/prefs tables [RF1.4.2.users]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `e367266` (2026-05-15): docs: handover — table catalog restyle + permissions tree-lines session
> Commit `162d382` (2026-05-16): test(catalogue): red — F5 catalogue + chip + localStorage + sidecar [00605]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `5ccef56` (2026-05-18): feat(migration): users_reauth_nonces table for step-up reauth [B16.8.10]
  > Apply `p_wizard_*.json` to other primitives: `<Table>`, `<DiagramCanvas>`, `<TimeboxManager>`. Per-primitive spec rolls up under B15 + B21.3.3.
  >
- **B21.4.3** Storify additional 51 strategy artefact types in UI `[P3]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `6453099` (2026-05-12): docs(PLA-0043): topology scope clamp on artefact reads — plan + FE-POR-0003 scope items
> Commit `17e5960` (2026-05-12): feat(PLA-0043): migration 046 — artefacts.topology_node_id [FE-POR-API-0002]
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `a07d3b5` (2026-05-12): feat(PLA-0043): frontend auto-forwards ?scope= on artefact GETs + openapi doc [FE-POR-0003.1]
> Commit `816fbf7` (2026-05-12): chore: mcp whisper stdio type + theme slot-name sanitisation
> Commit `10eea24` (2026-05-12): feat(theme-classic): restore historic Theme Maker at /theme-classic
> Commit `810ab6a` (2026-05-13): chore(001_redesign): strip redundant PageShell wrappers from 13 pages
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `1bc9958` (2026-05-13): feat(PLA-0026/SA2): add artefact_adoption_state to vector_artefacts [FE-SQL-0019]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `07ffd7c` (2026-05-14): refactor(PLA-0048 / RF1.4.2.timeboxes): rename timebox_* tables + column-prefix [RF1.4.2.timeboxes]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `4a3a43e` (2026-05-14): refactor(PLA-0048 / RF1.4.2.library): rename library_* + column-prefix [RF1.4.2.library]
> Commit `e6a5bd3` (2026-05-14): refactor(PLA-0048 / RF1.4.2.topology): rename topology_role_grants + view_state plural + column-prefix [RF1.4.2.topology]
> Commit `9d5408f` (2026-05-14): refactor(PLA-0048 / RF1.4.2.master_record): rename + column-prefix [RF1.4.2.master_record]
> Commit `40421fe` (2026-05-14): refactor(PLA-0048 / RF1.4.2.flows): pluralise flow_* root family [RF1.4.2.flows]
> Commit `0f6a8a2` (2026-05-14): refactor(PLA-0048 / RF1.4.2.artefacts): pluralise artefacts_* family [RF1.4.2.artefacts]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `f173b93` (2026-05-14): chore(PLA-0048 / RF1.5): cross-DB writer hardening — lint + stubs [RF1.5]
> Commit `c6d3b19` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix master_record_tenants (§2.3) [RF1.4.4.master_record_tenants]
> Commit `7f9416f` (2026-05-14): refactor(PLA-0048 / RF1.4.4): artefactitemsv2 → artefactitems + column-prefix artefacts_fields_values [RF1.4.4.artefacts_fields_values]
> Commit `5b6bf20` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix flows family (7 tables) [RF1.4.4.flows]
> Commit `f573da8` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix artefacts_types (§2.3) [RF1.4.4.artefacts_types]
> Commit `c7f74bc` (2026-05-14): refactor(PLA-0048 / RF1.4.4): column-prefix users_nav family — TD-NAME-001 CLOSED [RF1.4.4.users_nav]
> Commit `dcd0863` (2026-05-14): refactor(nav): collapse admin_settings + lazy-seeded admin groups into 3 tag buckets
> Commit `39ac522` (2026-05-15): feat(roles): PLA-0049 Phase 0 — grp_* role rename + UUID-keyed page grants [PLA-0049]
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `0681a60` (2026-05-16): feat(dev): seed N Risk artefacts via POST /admin/dev/seed-risks
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `8b39c59` (2026-05-16): feat(stories): red-green feature-driven testing SOP + tracker rg-rerun wiring
> Commit `dbab228` (2026-05-16): test(workspace): red — F1 workspace clamp via JWT + rebuild PLA-0053 around existing substrate [00601]
> Commit `fca8efb` (2026-05-16): feat(auth): workspace_id JWT claim + auth.User.WorkspaceID + login resolves default workspace [00575]
> Commit `65b0be1` (2026-05-16): chore(workspace): close-out 00577 — artefact_types.workspace_id substrate already shipped via PLA-0026 [00577]
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `ce816f9` (2026-05-16): feat(workspace): artefacttypes + artefactitems services clamp by workspace_id from JWT context [00579]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `0465562` (2026-05-16): feat(workspace): useActiveWorkspace hook + workspace_id on /me payload [00580]
> Commit `f50f4c3` (2026-05-16): feat(stories): auto-provision tracker groups via rg-runner -create-if-missing
> Commit `f944e5a` (2026-05-16): test(artefacttypes): red — F3 slot substrate [00603]
> Commit `454004c` (2026-05-16): test(artefactitems): red — F4 UUID wire end-to-end [00604]
> Commit `162d382` (2026-05-16): test(catalogue): red — F5 catalogue + chip + localStorage + sidecar [00605]
> Commit `3f4009c` (2026-05-16): test(chip): red — F6 Status context + rename invariance [00606]
> Commit `09f9fdb` (2026-05-16): feat(vector_artefacts): green — slot enum substrate on artefacts_types [00582]
> Commit `35ecd8d` (2026-05-16): feat(vector_artefacts): green — backfill artefacts_types_slot per workspace [00583]
> Commit `862f375` (2026-05-16): feat(artefacttypes): green — DTO surfaces Slot field [00584]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `146430c` (2026-05-16): test(priority): red — F7 substrate [00607]
> Commit `cb77d87` (2026-05-16): test(priority): red — F8 CRUD + UUID wire [00608]
> Commit `37c9929` (2026-05-16): test(priority): red — F9 catalogue + chip + Showstopper [00609]
> Commit `4c45fba` (2026-05-16): feat(vector_artefacts): green — artefact_priorities table + seed [00594]
> Commit `f5ba706` (2026-05-16): feat(artefactpriorities): green — CRUD package + endpoints [00596]
> Commit `9df930e` (2026-05-16): feat(priority): green — catalogue context + Priority chip catalogue-driven [00598,00599]
> Commit `97e8501` (2026-05-16): feat(priority): green — artefacts.priority TEXT→UUID FK + handler ?priority_id [00595,00597]
> Commit `5eba458` (2026-05-16): fix(test): bulk set_priority payload uses priority_id UUID [00595,00597 fixup]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `fa434e2` (2026-05-18): feat(artefactitems): topology scope clamp on Summary [FE-POR-0003]
> Commit `b0cf595` (2026-05-18): feat(sentinel): coordinate switchWorkspace → scope reload [B16.8.P3]
  > Once backend serves them, surface theme/objective/feature creation flows in portfolio page. Distinct from B21 — that just plumbs the data.
  >
- **B21.4.4** Drop legacy `/v1/portfolio-items` routes `[P4]` `[ ]B21.3.5`
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `743b077` (2026-05-10): feat(roles): drop MVP single-admin workspace constraint
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `4efd532` (2026-05-12): fix(dev): drop accidental /api prefix from page-help admin calls
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `78fd394` (2026-05-12): feat(PLA-0043): artefactitemsv2 ?scope= clamp on /work-items + /portfolio-items [FE-POR-API-0002]
> Commit `53e018b` (2026-05-12): feat(PLA-0044): walkTopology TS engine + 6 golden fixtures [FE-POR-API-0006]
> Commit `1a56726` (2026-05-12): feat(PLA-0044): BFF tree handler routes Subtree through shared walker [FE-POR-API-0006]
> Commit `30b136c` (2026-05-13): feat(001_redesign): top bar reads PageHeaderContext + strip duplicate titles
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `bbb874f` (2026-05-13): feat(PLA-0023): migrate error_events from mmff_vector to vector_artefacts [P1]
> Commit `a743bb3` (2026-05-13): chore(PLA-0023): drop dead defects table from mmff_vector [P0'/P1]
> Commit `d8c8341` (2026-05-13): feat(PLA-0023): migrate library_acknowledgements from mmff_vector to vector_artefacts [P1]
> Commit `82951c5` (2026-05-13): fix(PLA-0023): renumber library_ack drop + drop o_search_index_outbox [P1]
> Commit `49b0909` (2026-05-13): chore(PLA-0023): drop 2 dead-leaf legacy tables, hold user_nav_* [P0']
> Commit `b76ed1c` (2026-05-13): chore(PLA-0023): drop obj_flow_* legacy family from mmff_vector [P0']
> Commit `1cbe497` (2026-05-13): chore(PLA-0023): drop shadow master_record_tenant from mmff_vector [P2]
> Commit `3ff59f0` (2026-05-13): chore(PLA-0023): P5 verification pass — drop 2 dead leaves, map blockers [P5]
> Commit `c4ae079` (2026-05-13): chore(PLA-0023): drop roles_org_nodes — superseded by VA topology_role_grants [P4]
> Commit `4411327` (2026-05-13): feat(PLA-0026/SA1): remove legacy vectorPool saga writes — VA is now sole write path [FE-POR-0003]
> Commit `a998fc5` (2026-05-13): refactor(PLA-0044): remove legacy AppSidebar_2 component — superseded by redesign two-rail nav
> Commit `8264471` (2026-05-13): refactor(PLA-0044): delete legacy PageHeaderBar + dead page-header CSS [FE-UI-0001]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `9abf139` (2026-05-13): chore(PLA-0039): retire /samantha/v1 dead paths + fix AdoptionOverlay [FE-POR-0003]
> Commit `4ab58a3` (2026-05-13): chore(PLA-0039): delete empty /samantha/v1 chi block from router [FE-POR-0003]
> Commit `5bdf3be` (2026-05-13): docs(PLA-0030): document 5 missing /samantha/v2 routes in openapi-v2.yaml
> Commit `f223f8a` (2026-05-13): feat(PLA-0023 P6): finish topology cutover — move commit checkpoint from mmff_vector to vector_artefacts [TD-ORG-001]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `93d26b8` (2026-05-14): refactor(PLA-0048 / RF1.4.3): route renames — singular→plural workspace routes [RF1.4.3]
> Commit `7e632d9` (2026-05-14): refactor(nav): remove tab menus from /work-items and /portfolio-items
> Commit `481bf54` (2026-05-15): feat(PLA-0032): vocab rename master_record_tenants → master_record_workspaces (atomic cutover) [PLA-0032]
> Commit `6747107` (2026-05-16): fix(users): translate legacy role enum to grp_* code before insert [TD-USERS-CREATE-001]
> Commit `57fda4e` (2026-05-16): feat(workspace): WorkspaceClampMiddleware reads JWT claim, drops ?ws= URL surface [00576]
> Commit `f6d4935` (2026-05-16): feat(workspace): mount WorkspaceClampMiddleware on artefact routes [00578]
> Commit `8192ec3` (2026-05-16): feat(chip): green — backend UUID wire + frontend catalogue/chip cutover [00585..00592]
> Commit `ccbd882` (2026-05-17): feat(tree): ObjectTree owns chrome — Panel + badge/title/subtitle/description, bottom-only pagination, corner-notch fix [B21]
> Commit `f53722c` (2026-05-17): refactor(tree): drop legacy panelHeader path — WorkItemsPanelHeader/RisksPanelHeader retired [B21]
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `802dd70` (2026-05-18): feat(auth): REQUIRE_SID_CLAIM kill-switch for legacy grace window [B16.8.11]
  > After v2 contract is stable in production for 2+ release cycles. Per gradual-DB-sanitisation rule (memory).
  >
- **B21.4.5** Per-scope flow-state validation `[P3]`
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `221ccff` (2026-05-12): feat(css): introduce <PageContent> wrapper to anchor sticky-nav top gap
> Commit `3f74127` (2026-05-12): feat(flow-states-v2): orbit PoC for add/remove states
> Commit `ff622cf` (2026-05-13): feat(PLA-0043): restructure admin URLs — /workspace-admin, /user-management, /vector-admin [FE-POR-0003.1]
> Commit `37ba249` (2026-05-13): feat(PLA-0023): migrate audit_log from mmff_vector to vector_artefacts [P1]
> Commit `f3bfd9b` (2026-05-13): feat(PLA-0044): roll canonical page template across all (user) pages — PageHeading + Panel header [FE-UI-0001]
> Commit `bccde30` (2026-05-13): fix(PLA-0039): wire portfolio-model layer PATCH end-to-end + checkpoint in-flight work [FE-POR-0003]
> Commit `860ccf4` (2026-05-14): refactor(PLA-0048 / RF1.3): per-DB migration directories [RF1.3]
> Commit `3032e79` (2026-05-14): refactor(PLA-0048 / RF1.4.2.{webhooks,audit,errors,admin}): rename + column-prefix [RF1.4.2]
> Commit `c479ee4` (2026-05-14): refactor(PLA-0048 / RF1.4.2.users[B]): rename auth-core tables to users_* [RF1.4.2.users]
> Commit `2421fa3` (2026-05-14): refactor(PLA-0048 / RF1.4.1): Go package renames + v-suffix doc [RF1.4.1]
> Commit `9a38482` (2026-05-15): feat(grid): PLA-0049 Phase 1 — bucket toggle + avatar floor + audit + auto-seed [PLA-0049]
> Commit `51a0ae3` (2026-05-15): feat(ui): catalog <Table> header restyle + group rows + permissions tree-lines
> Commit `c890627` (2026-05-16): feat(flow-states-v2): orbit visualisation across all artefact types
> Commit `60054f0` (2026-05-16): chore: file-index tooling + new memory entries + backend-validation doc
> Commit `d6f17f6` (2026-05-17): chore: stash working artefacts in repo — scratch correction prompt, flow-state v2 screenshots, risks seed, CircularAdditor props
> Commit `8dc9bb6` (2026-05-18): fix(login): scale sidebar wordmark to fill vertical space — hero element
> Commit `176eef5` (2026-05-18): feat(alerting): webhook fan-out for selected audit_logs actions [B16.8.P5]
  > `validItemTypesByScope` (B21.1.5) is one allow-list; flow-states may also need scope-keyed transitions if strategy artefacts have different lifecycle states. Audit `ListFlowStates` after B21.1.7 lands.
  >

---

## B22. Transport Segregation via Shared Service Core (PLA-0039)

> **The win-win.** Keep one product codebase. Segregate by **transport adapter**, not by **service**. Site features ship as fast as before because there is no detour: every handler — site or customer — calls the *same* `Service` method. Two thin transport mounts (`/_site` for the BFF, `/samantha/v2` for the customer-facing API) sit on top. SOC 2 sees one auditable boundary; URL prefixes make site-vs-customer traffic visibly separate at the gateway, in logs, in WAF rules; a DTO mapper guard stops internal columns leaking through the customer adapter.
>
> **Why this is win-win, not a detour:** the work that already exists (B21 `artefactitemsv2.Service`, the 18 service.go files, RFC 9457 errors, RBAC, rate-limit middleware) **is the substrate**. We are not rebuilding — we are renaming a frontend helper, mounting a router subtree, adding two lints, and writing one DTO convention. Site velocity is unaffected because nothing about how a site feature is built changes — handler-calls-service is already the dominant pattern.
>
> **Why now:** the 252 / 9 / 8 split between `api()` / `apiV2` / `apiInfra` proves the site is silently riding the customer pool. Today's Reset Adoption State 404 was caused by exactly this confusion. Every week we wait, more callers cement the wrong assumption. After PLA-0030 (v1→v2 cutover) lands but before any external customer touches the system is the cheapest moment to draw the line.
>
> **Out of scope (deliberately):** rewriting any service; introducing GraphQL; multi-region; tenant-per-database; anything that does not directly enforce the adapter boundary.

- ✅ ~~**B22.1** Mount `/_site` BFF subtree in `main.go` `[P1]`~~
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `5f85b87` (2026-05-09): feat(B22 PLA-0039): mount /_site BFF subtree + apiInfra→apiSite codemod [B22] [B22.1] [B22.2]
  > Re-home every site-only route under a single chi `Route("/_site", …)` block: `/admin/*`, `/me`, `/nav/*`, `/auth/refresh` + `/auth/logout`, `/dev/*`, `/healthz`, `/env*`, `/page-help/*`, `/library/releases/*`, `/custom-pages/*`, `/user/tab-order/*`, `/addressables/*`, `/errors/*`, `/workspaces/*`, `/status/pipeline`. Keep root-level shims for ≤2 release cycles emitting `Deprecation: site=/_site` header, then drop. After this lands, "is this route customer-facing?" is answered by `strings.HasPrefix(path, "/_site")` — usable in middleware, gateway rules, log filters.

- ✅ ~~**B22.2** Rename frontend helper `apiInfra` → `apiSite`; point at `/_site` `[P1]` `[ ]B22.1`~~
> Commit `5f85b87` (2026-05-09): feat(B22 PLA-0039): mount /_site BFF subtree + apiInfra→apiSite codemod [B22] [B22.1] [B22.2]
  > Single rename + base-URL change in `app/lib/api.ts` (the file already documents the routes in its header — they just need a shorter name and the `/_site` prefix). Codemod the 8 call sites. After this, `apiSite()` for site code is the literal name of what it does; helper count stays at 3, semantics sharpen.

- ✅ ~~**B22.3** Lint `lint:public-helper-allowlist` — gate `api()` and `apiV2` to a vetted file allowlist `[P1]` `[ ]B22.2`~~
> Commit `c87990e` (2026-05-09): feat(B22 PLA-0039): lint:public-helper-allowlist + lint:no-db-in-handlers [B22] [B22.3] [B22.4]
  > New python lint under `dev/scripts/lint_public_helper_allowlist.py` + ledger `dev/registries/public_helper_allowlist.txt`. Default rule: any file under `app/` or `dev/` that calls `api(` or `apiV2(` must be in the ledger. CI fails on a new caller that isn't allowlisted. Forces deliberate decisions; converts the 252 / 9 split from drift into evidence.

- ✅ ~~**B22.4** Lint `lint:no-db-in-handlers` — fail CI on `pgxpool` / `database/sql` import in any non-test `handler*.go` `[P1]`~~
> Commit `c87990e` (2026-05-09): feat(B22 PLA-0039): lint:public-helper-allowlist + lint:no-db-in-handlers [B22] [B22.3] [B22.4]
  > Python script under `dev/scripts/lint_no_db_in_handlers.py`; ledger `dev/registries/handler_db_exemptions.txt` seeded with the 8 known stragglers (auth, fields, errorsreport, libraryreleases, roles, portfoliomodels ×3, portfolio/master_record). Each removal from the ledger = one handler extracted to its service. The lint is the ratchet; the ledger is the migration tracker.

- ✅ ~~**B22.5** Extract `auth/handler.go` to `auth.Service` `[P2]` `[ ]B22.4`~~
> Commit `79b0d37` (2026-05-09): feat(B22 PLA-0039): extract auth.Service.LoadRoleAndPermissions [B22] [B22.5]
  > First straggler. `Login`, `Refresh`, `Logout` move into `auth.Service`; handler holds only HTTP concerns. Removes auth from the lint ledger.

- ✅ ~~**B22.6** Extract `fields/handler.go` to `fields.Service` `[P2]` `[ ]B22.4`~~
> Commit `7513242` (2026-05-09): feat(B22 PLA-0039): extract fields.Service from handler [B22] [B22.6]
  > Second straggler. Custom-field CRUD into service; ledger row removed.

- ✅ ~~**B22.7** Extract `errorsreport/handler.go` to `errorsreport.Service` `[P2]` `[ ]B22.4`~~
> Commit `90664bc` (2026-05-09): feat(B22 PLA-0039): extract errorsreport.Service from handler [B22] [B22.7]
  > Site-only handler — moves under `/_site/errors`; service writes go through `audit.Service` once B22.11 lands.

- ✅ ~~**B22.8** Extract `libraryreleases/handler.go` to `libraryreleases.Service` `[P2]` `[ ]B22.4`~~
> Commit `65b07a9` (2026-05-09): feat(B22 PLA-0039): extract libraryreleases.Service from handler [B22] [B22.8]
  > Library-DB-pool consumer; service holds the cross-DB read pattern.

- ✅ ~~**B22.9** Extract `roles/handler.go` to `roles.Service` `[P2]` `[ ]B22.4`~~
> Commit `be174cb` (2026-05-09): feat(B22 PLA-0039): extract roles.Service.ResolveActorPermissionIDs [B22] [B22.9]
  > `roles.Service` already exists for writes (per `lint:writer-boundary`); reads still in handler — fold them in.

- ✅ ~~**B22.10** Extract `portfoliomodels/handler*.go` (×3) and `portfolio/master_record_handler.go` to services `[P2]` `[ ]B22.4`~~
> Commit `f569af6` (2026-05-09): feat(B22 PLA-0039): extract portfoliomodels + portfolio.MasterRecord services [B22] [B22.10]
  > Largest straggler set. Bundle so PLA-0026 (per-workspace adoption cutover) and B22 stop colliding on the same files.

- ✅ ~~**B22.11** `audit_events` table + `audit.Service.Record()` sole-writer `[P1]` `[ ]B22.4`~~
> Commit `f20f11d` (2026-05-09): feat(B22 PLA-0039): audit source_transport + transport context tagging [B22] [B22.11]
  > New migration `db/schema/NNN_audit_events.sql`: `(id, tenant_id, actor_user_id, action, resource_type, resource_id, request_id, source_transport, before_jsonb, after_jsonb, created_at)`. `source_transport` ∈ {`site`, `public`} so SOC 2 reviewers can distinguish staff actions from customer actions. Mutating service methods call `audit.Record(ctx, …)` synchronously; failure rolls back the transaction. `lint:writer-boundary` extended so only `audit.Service` writes the table.

- ✅ ~~**B22.12** DTO + mapper convention — every service exposing data via `apiV2` declares `dto.go` `[P2]` `[ ]B22.11`~~
> Commit `c8838ef` (2026-05-09): feat(B22 PLA-0039): lint:public-dto-mapper + MapPublic seams [B22] [B22.12]
  > Pattern: `MapPublic(internal Foo) dto.FooPublic`. Lint `lint:public-dto-mapper`: any handler under `/samantha/v2` returning a Go struct from `internal/<svc>` (i.e. not from `internal/<svc>/dto`) fails. Stops a future PR accidentally exposing a column added internally. `portfoliomodels/dto.go` is the seed example; document the pattern in `docs/c_c_transport_segregation.md`.

- ✅ ~~**B22.13** Docs — `docs/c_c_transport_segregation.md` `[P2]` `[ ]B22.1`~~
> Commit `d97a096` (2026-05-09): docs(B22 PLA-0039): add c_c_transport_segregation.md leaf [B22] [B22.13]
  > Single page: the diagram (handler → Service → audit), the URL-prefix rule (`/_site` vs `/samantha/v2`), the three lints (`lint:public-helper-allowlist`, `lint:no-db-in-handlers`, `lint:public-dto-mapper`), the DTO mapper convention, and the SOC 2 evidence story (one audit table, two transports, one boundary). Linked from CLAUDE.md alongside `c_c_v1_v2_cutover.md`.

- ✅ ~~**B22.14** Gateway-layer rule — drop `/_site` requests at the public ingress `[P3]` `[ ]B22.1`~~
> Commit `fed62c4` (2026-05-09): docs(B22 PLA-0039): add gateway freeze rule to c_security.md [B22] [B22.14]
  > Once a real gateway lands (B17.9), add a rule: requests to `/_site/*` from outside the staff VPN/SSO are 404'd. Before the gateway exists, document the intent in `docs/c_c_transport_segregation.md` so it ships when B17.9 ships.

- ✅ ~~**B22.15** Decision log — site-only vs customer-also for new endpoints `[P3]`~~
> Commit `e76dd70` (2026-05-09): feat(B22 PLA-0039): add transport gate (Gate 8) to stories skill [B22] [B22.15]
  > One-line addition to the `<stories>` skill checklist: every new endpoint card declares `transport: site | public | both`. Forces the decision at story time, not at handler time. Keeps drift from re-emerging.

### B22 Phase 2 — `/_site` Full Coverage (14 allowlisted files → 0)

> **Goal:** Every internal app call routes through `/_site`. The 14 files currently in `public_helper_allowlist.json` all call `apiV2` directly — each needs a `/_site` route added to the Go backend and its frontend caller switched to `apiSite`. When the allowlist reaches 0 non-exempt entries, `lint:public-helper-allowlist` becomes a hard block with no exemptions.
>
> **State today (2026-05-09):** `/_site` has auth, me, nav, workspaces, webhooks, roles, custom-pages, addressables, library-releases, errors, user/tab-order. **Missing:** topology, work-items, portfolio-items, portfolio-model, flows, fields, rank, timeboxes, artefact-items (resourceUrl pattern).
>
> **Per-group work pattern:** (1) add route group to `mountSiteRoutes` in `main.go`; (2) switch frontend callers `apiV2` → `apiSite`; (3) remove files from allowlist; (4) verify lint passes.

- ✅ ~~**B22.16** Mount `/_site/topology/*` + switch `app/lib/topologyApi.ts` → `apiSite` `[P1]`~~
> Commit `35703e6` (2026-05-09): feat(B22 PLA-0039): mount /_site/topology + switch topologyApi.ts → apiSite [B22] [B22.16]
  > 18 topology operations (tree, nodes CRUD, roles, view-state, move, commit, reset, archive/restore, disconnected). All handlers exist under `/samantha/v2/topology`; duplicate the mount into `mountSiteRoutes`. topologyApi.ts is 1 file, ~20 call sites. Remove 1 entry from allowlist.

- ✅ ~~**B22.17** Mount `/_site/work-items/*` + switch `work-items/list`, `WorkItemDetailPanel`, `useWorkItemFlowStates`, `work-items-tree-config` → `apiSite` `[P1]`~~
> Commit `adcc284` (2026-05-09): feat(B22 PLA-0039): mount /_site/work-items + /portfolio-items + /rank; switch 7 callers → apiSite [B22] [B22.17] [B22.18] [B22.22] [B22.25]
  > Work-items list/summary, field-values, flow-states, tree pagination/sort/filter, PATCH. 4 frontend files. Handler group exists under `/samantha/v2/work-items`. Remove 4 entries from allowlist.

- ✅ ~~**B22.18** Mount `/_site/portfolio-items/*` + switch `portfolio-items/list/page.tsx` → `apiSite` `[P1]`~~
> Commit `adcc284` (2026-05-09): feat(B22 PLA-0039): mount /_site/work-items + /portfolio-items + /rank; switch 7 callers → apiSite [B22] [B22.17] [B22.18] [B22.22] [B22.25]
  > Single call: `/portfolio-items/summary`. Handler group exists under `/samantha/v2/portfolio-items`. Remove 1 entry from allowlist.

- ✅ ~~**B22.19** Mount `/_site/portfolio/*` + `/_site/workspace/{id}/portfolio/layers` + switch `portfolio-model/page.tsx` → `apiSite` `[P1]`~~
> Commit `ff79293` (2026-05-09): feat(B22): /_site mirrors for portfolio, flows, workspace-fields + frontend migration [B22] [B22.19] [B22.20] [B22.21]
  > Two calls: `/portfolio/master_record?workspace_id=` and `/workspace/{id}/portfolio/layers`. Table-name bug fixed (commit b3defb3); this removes the `apiV2` exposure. Remove 1 entry from allowlist.

- ✅ ~~**B22.20** Mount `/_site/flows/*` + switch `workspace-settings/work-items/page.tsx` → `apiSite` `[P1]`~~
> Commit `ff79293` (2026-05-09): feat(B22): /_site mirrors for portfolio, flows, workspace-fields + frontend migration [B22] [B22.19] [B22.20] [B22.21]
  > Single call: `GET /flows/`. Handler already mounted under `/samantha/v2/flows`. Remove 1 entry from allowlist.

- ✅ ~~**B22.21** Mount `/_site/workspace/{id}/fields` + switch `app/lib/fieldsApi.ts` → `apiSite` `[P1]`~~
> Commit `ff79293` (2026-05-09): feat(B22): /_site mirrors for portfolio, flows, workspace-fields + frontend migration [B22] [B22.19] [B22.20] [B22.21]
  > Single call: `GET /workspace/{id}/fields`. Handler (`fields.Service`) exists. Remove 1 entry from allowlist.

- ✅ ~~**B22.22** Mount `/_site/rank/move` + switch `app/hooks/useResourceRank.ts` → `apiSite` `[P2]`~~
> Commit `adcc284` (2026-05-09): feat(B22 PLA-0039): mount /_site/work-items + /portfolio-items + /rank; switch 7 callers → apiSite [B22] [B22.17] [B22.18] [B22.22] [B22.25]
  > Single call: `POST /rank/move`. Handler exists under `/samantha/v2`. Remove 1 entry from allowlist.

- ✅ ~~**B22.23** Mount `/_site/timeboxes/*` + switch `TimeboxManager.tsx` + `useTimebox.ts` → `apiSite` `[P2]`~~
> Commit `b587134` (2026-05-09): feat(B22): /_site mirrors for timeboxes + frontend migration + allowlist to 1 [B22] [B22.23] [B22.24]
  > Two files; `cfg.apiBase` is dynamic — the timebox kind registry at `app/components/timebox/kinds.ts` needs `/_site`-prefixed base strings. Calls: `GET ${cfg.apiBase}?...` and `POST ${cfg.apiBase}/bulk-create`. Remove 2 entries from allowlist.

- ✅ ~~**B22.24** Mount `/_site/work-items/relations/*` + switch `useRelationsData.ts` → `apiSite` `[P2]`~~
> Commit `b587134` (2026-05-09): feat(B22): /_site mirrors for timeboxes + frontend migration + allowlist to 1 [B22] [B22.23] [B22.24]
  > Relations graph calls. Handler exists under `/samantha/v2/work-items/relations`. Remove 1 entry from allowlist. Depends on B22.17 (shares the work-items mount group).

- ✅ ~~**B22.25** Switch `p_ObjectTree.tsx` (artefact-items resourceUrl pattern) → `apiSite` `[P1]`~~
> Commit `adcc284` (2026-05-09): feat(B22 PLA-0039): mount /_site/work-items + /portfolio-items + /rank; switch 7 callers → apiSite [B22] [B22.17] [B22.18] [B22.22] [B22.25]
  > The wizard sidecar `resourceUrl` is constructed dynamically (B21). `p_ObjectTree.tsx` calls `apiV2(resourceUrl + ...)`. Once B22.17 + B22.18 mount the underlying route groups under `/_site`, this file just needs its helper swapped. Remove 1 entry from allowlist. Depends on B22.17, B22.18.

- ✅ ~~**B22.26** Shrink `public_helper_allowlist.json` to zero; make lint a hard block `[P2]`~~
  > Once B22.16–B22.25 land, remove all 14 entries. The lint `--warn` mode becomes a hard fail. `app/lib/api.ts` (the definition file) gets a `# definition` exemption comment; all other callers must route through `apiSite`. Any future `apiV2` call requires an explicit PR-reviewed allowlist entry.

- ✅ ~~**B22.27** Update `docs/c_c_transport_segregation.md` with Phase 2 completion + full `/_site` route inventory `[P3]`~~
  > Document the complete `/_site` surface after Phase 2. Reference for the gateway block rule (B22.14) when B17.9 ships.

---

## FE-GOV-0003. Flow-State Descriptions & Per-State Exit Rules (PLA-0040)

Governance surface: every flow state gains a long-form description and an ordered, named **exit-rules checklist**. Users self-attest to each rule before moving an artefact out of the state — the system never enforces, only surfaces the list. Editor lives on `/workspace-settings/customisation/flow-states`, reached via two new icon buttons per state row (description glyph + exit-rules counter). Work Items page mirrors the data read-only (glyph + count columns); its existing "Manage flow states" footer button is the way to edit. Exit rules are first-class rows in a new `flow_state_exit_rules` table — drag-reorderable, inline-editable, soft-archivable, colour-tagged. Stored as a table (not JSON) for per-rule sort_order audit, `@dnd-kit` compatibility, and `lint:writer-boundary` enforcement. Backend extends the existing `flows` package (sole writer); five new `/_site/` routes for description PATCH + exit-rule CRUD. Plan: PLA-0040. `[P2]`

### FE-GOV-0003.1 Schema & migration

- **FE-GOV-0003.1.1** Migration `db/artefacts_schema/045_flow_state_description_and_exit_rules.sql` — `ALTER TABLE flow_states ADD COLUMN description TEXT`; `CREATE TABLE flow_state_exit_rules (id, flow_state_id FK CASCADE, sort_order, name, colour, created_at, updated_at, archived_at)`; partial index `(flow_state_id, sort_order) WHERE archived_at IS NULL`. `[P2]`

### FE-GOV-0003.2 Backend — `flows` package extensions

- **FE-GOV-0003.2.1** Extend `backend/internal/flows/types.go` — `FlowState` DTO gains `Description *string`, `ExitRules []FlowExitRule`, `ExitRuleCount int`; new `FlowExitRule` struct. `[P2]`
- **FE-GOV-0003.2.2** Extend `ListBySubscription` to LEFT JOIN active exit rules (sorted by `sort_order`); compute `ExitRuleCount`. `[P2]`
- **FE-GOV-0003.2.3** Service methods — `PatchFlowStateDescription`, `ListExitRules`, `CreateExitRule` (appends at `max(sort_order)+10`), `PatchExitRule` (name/colour/sort_order), `DeleteExitRule` (soft-archive). `[P2]`
- **FE-GOV-0003.2.4** Allow `description` field on existing `PatchFlowState` so the FE has one PATCH path for state-level fields. `[P2]`
- **FE-GOV-0003.2.5** Register five new `/_site/` routes in `backend/internal/flows/handler.go`: `PATCH /flow-states/{id}/description`, `GET|POST /flow-states/{id}/exit-rules`, `PATCH|DELETE /flow-state-exit-rules/{id}`. `[P2]`

### FE-GOV-0003.3 Lint & writer boundary

- **FE-GOV-0003.3.1** Register `flow_state_exit_rules → backend/internal/flows/` in `dev/scripts/lint_writer_boundary.py`'s `WRITER_BOUNDARY` map; no exemption row needed (first writer is correct). `[P2]`

### FE-GOV-0003.4 Frontend — Flow States page (editor surface)

- **FE-GOV-0003.4.1** Extend `app/lib/flowStatesApi.ts` with `patchStateDescription`, `listExitRules`, `createExitRule`, `patchExitRule`, `deleteExitRule`. `[P2]`
- **FE-GOV-0003.4.2** Add two icon-button columns to the StateRow table (after COLOUR): DESCRIPTION (`MdOutlineDescription`) and EXIT RULES (`FaListOl` + count pill). `[P2]`
- **FE-GOV-0003.4.3** Inline expander row — single `<tr>` rendered below the active state row, mode `"description" | "rules"` held in a single state slot so only one expander is open at a time. `[P2]`
- **FE-GOV-0003.4.4** Description expander — textarea + 250ms debounced autosave (matches existing colour-picker convention on this page). `[P2]`
- **FE-GOV-0003.4.5** Exit rules expander — drag-reorder (`@dnd-kit/sortable` + `verticalListSortingStrategy`, mirrors existing `handleSlotReorder` lines 814-859); inline-edit name on click; `ColourPicker` for per-rule colour (defaults to parent state colour); edit/delete icon row; bottom form `Add exit rule`. PATCH calls debounced 250ms. `[P2]`

### FE-GOV-0003.5 Frontend — Work Items page (read-only mirror)

- **FE-GOV-0003.5.1** Add two non-interactive columns after `Initial` on `app/(user)/workspace-settings/customisation/work-items/page.tsx`: **Description** (`MdOutlineDescription` glyph + text tooltip; dash if null) and **Exit Rules** (`FaListOl` + count pill if `> 0`; dash otherwise). Existing footer "Manage flow states" button remains the only edit path. `[P3]`

### FE-GOV-0003.6 CSS

- **FE-GOV-0003.6.1** Extend `app/globals.css` with `.flow-editor__expander` row styles (full-span row, sunken background, padded inner block). No new global primitives invented — only extends the `.flow-editor__*` family already on this page. `[P3]`

### FE-GOV-0003.7 Verification

- **FE-GOV-0003.7.1** Run `go build ./cmd/server/...`, `npm run typecheck`, `npm run lint:writer-boundary`, apply migration on dev DB; browser-test description save, exit-rule CRUD + drag-reorder + colour, read-only mirror on Work Items page, Strategy section parity. `[P2]`

---

## FE-GOV-0004. Orbit View Transition Editor & Artefact-Move Enforcement (PLA-0041)

Governance surface: stand up a **new 3rd-level secondary-nav page** at `/workspace-settings/workspace-settings/transition-rules` dedicated to defining which workflow transitions are allowed per flow. **Page move (companion):** Flow States and Work Items leave the Customisation L3 group and join the Workspace Settings L3 group (siblings of Organisation / Workspaces / Custom Fields / Portfolio Model); Transition Rules slots between Flow States and Work Items so the journey reads *Organisation → Workspaces → Custom Fields → **Flow States → Transition Rules → Work Items** → Portfolio Model*. **Removes** the existing N×N `TransitionMatrix` from the Flow States page — that page is already heavy (state CRUD + colour + description + exit rules + kind + is_pullable + ordering) and adding transition editing would overload users and conflate two mental models. The new page hosts a focus-one-source "Orbit View" per flow — picked source state sits in the centre of an SVG canvas with every other state orbiting it; tap an orbit node to toggle the `(focus → orbiting)` transition; a warm-gold inbound arrow confirms allowance. Mental model: *"Where can a card go from HERE?"* — one question at a time. Left rail lists all states with live outbound-rule counts; footer shows resolved rule set across all sources. No drag, no multi-select, no modes — one control: tap. **Critical companion piece**: artefact PATCH (`backend/internal/artefactitemsv2/service.go:675-693`) currently validates only that the target `flow_state_id` exists, not that `(current → new)` is in `flow_transitions` — meaning the rules editor is cosmetic without backend enforcement. This entry closes that gap across `artefactitemsv2` and audits `portfolioitemsv2` + any bulk-move endpoints for the same hole. Empty-flow default (no rules defined → allow any move) preserves fresh-workspace UX. Same enforcement applied to portfolio items for consistency. Reference design brief: `Flow State Journey Maker.md`. Plan: `dev/plans/PLA-0041.md`. `[P2]`

### FE-GOV-0004.0 New page + Workspace Settings move (secondary-nav surface)

- ✅ ~~**FE-GOV-0004.0.1** Create new route `app/(user)/workspace-settings/workspace-settings/transition-rules/page.tsx` — calls existing `flowStatesApi.list()`; renders Work Types + Strategy Types sections with `PageAnchorNav` TOC matching Flow States page conventions; one labelled `<OrbitView>` per flow; reuses `useTenantName()` + permission gate `useHasPermission("flows.manage")` (mirrors Work Items gating); top-of-page AAA-grade help paragraph explaining the orbit mental model in plain language.~~ `[P1]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.0.2** Remove from Customisation layout `app/(user)/workspace-settings/customisation/layout.tsx` — drop `flow_states` and `work_items` from `TABS`, `KEY_TO_SEG`, `SEG_TO_KEY`, and the `items` array (and the `canManageFlows` gate on Work Items). Customisation L3 becomes *Tenant Details → Artefact Types → Topology → Topology Map*.~~ `[P1]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.0.3** Add to Workspace Settings layout `app/(user)/workspace-settings/workspace-settings/layout.tsx` — append `flow_states`, `transition_rules`, `work_items` to `TABS`, `KEY_TO_SEG`, `SEG_TO_KEY`, and slot them between **Custom Fields** and **Portfolio Model** in the `items` array. All three gated by `useHasPermission("flows.manage")` (introduces a permission gate to this layout, currently ungated). Final order: *Organisation → Workspaces → Custom Fields → Flow States → Transition Rules → Work Items → Portfolio Model*.~~ `[P1]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.0.4** Move route folders on disk: `mv app/(user)/workspace-settings/customisation/flow-states/ app/(user)/workspace-settings/workspace-settings/flow-states/` and same for `work-items/`. Page-component code is unchanged — Next.js segments derive from folder path. Update the one `router.push("/workspace-settings/customisation/flow-states")` in `customisation/work-items/page.tsx:231` (note: the file itself moves with this step) to `/workspace-settings/workspace-settings/flow-states`. Update the docstring comment at `app/lib/apiSite/index.ts:489` to the new path.~~ `[P1]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.0.5** Remove the `TransitionMatrix` component from `flow-states/page.tsx` (lines 1159-1246) and its `.fs-transition-matrix__*` CSS from `app/globals.css`. The Flow States page no longer owns transition editing — replace any inline help that referred to transitions with a one-line pointer link to the new Transition Rules tab.~~ `[P2]`
  > Last checked: 2026-05-11

### FE-GOV-0004.1 Frontend — Orbit View component primitives

- ✅ ~~**FE-GOV-0004.1.1** Create `app/components/flow-rules/StateRail.tsx` — fixed 200px-wide left rail; real `<button aria-pressed>` rows; per-row outbound-rule count badge; selected row uses `--sunken` + `--border-strong` outline; eyebrow label "SOURCE STATE" (10px / 600 / 0.12em letter-spacing / `--ink-subtle`).~~ `[P2]`
  > Last checked: 2026-05-11
- ⚠️ PARTIAL ~~**FE-GOV-0004.1.2** Create `app/components/flow-rules/OrbitCanvas.tsx` — pure SVG (no `<canvas>`); viewBox `760 × 440`; centre node radius 48px (stroke `--ink`, fill `--canvas`); orbit radius 155px; orbit node radius 32px; positioning math `angle = (-Math.PI / 2) + (i / orbiting.length) * 2 * Math.PI; x = cx + cos(angle) * R; y = cy + sin(angle) * R`; single `<marker>` definition for arrowhead; arrow line only drawn when `(focus → orbiting)` is in the allowed set, offset by 50px from centre and `R - 32` from node; allowed node fill `--accent-soft`, stroke `--accent`; blocked node fill `--surface-2`, stroke `--border-strong`; two-word names wrap (first word y=3, second y=15 muted). No hard-coded colours anywhere.~~ `[P2]` — built as `role="button"` `<g>` not the real `<button>` overlay called for in 4.2.1; revisit when 4.2.1 lands.
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.1.3** Create `app/components/flow-rules/rules.ts` — `type StateId = string; type Transition = { from: StateId; to: StateId };` plus helpers `has(from,to)`, `toggle(from,to)`, `allow(from,to)`, `block(from,to)`, `countOutbound(from)`, `all()`. Internal storage `Set<"from>to">`.~~ `[P2]` — implemented `has`, `keyOf`, `fromTransitions`, `toTransitions`, `countOutbound`; `toggle/allow/block/all` weren't needed because mutations go through the API client, not local helpers.
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.1.4** Create `app/components/flow-rules/OrbitView.tsx` — flex-row composition (`<StateRail>` + `<OrbitCanvas>`); props `{ flowId, states, transitions, onTransitionsChange }` (drop-in for `TransitionMatrix` call-site); local state for focused state id; toggle handler calls `flowsApi.createTransition` / `flowStatesApi.deleteTransition`; busy-state lock prevents concurrent toggles on same edge.~~ `[P2]`
  > Last checked: 2026-05-11

### FE-GOV-0004.2 Frontend — accessibility & motion

- **FE-GOV-0004.2.1** Each orbit node is a real `<button>` overlaid on the SVG node (not `<g role="button">`); aria-label format `"Allow move from {from} to {to}"` (toggles to "Block …" when active). `[P2]` — currently shipped as `<g role="button" tabIndex={0}>` (functional but not the spec; revisit if a11y audit flags).
- ✅ ~~**FE-GOV-0004.2.2** Keyboard: Tab walks orbit nodes; Space/Enter toggles; **arrow keys walk the orbit clockwise / counter-clockwise** (Right/Down → next; Left/Up → previous); focus visibly outlined with `--accent` ring.~~ `[P2]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.2.3** Motion: 150ms tone change on allow/block toggle; 200ms ease on inbound arrow stroke-opacity appear/disappear; no bounce, no spring; `prefers-reduced-motion` shortcuts all transitions to 0ms.~~ `[P3]`
  > Last checked: 2026-05-11

### FE-GOV-0004.3 Frontend — edge cases & footer

- ✅ ~~**FE-GOV-0004.3.1** Zero rules from focused state — centre + all-blocked orbit; footer reads "No transitions allowed yet."~~ `[P3]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.3.2** More than 8 states — scale orbit radius up, orbit node radius down; never add scroll (the whole point is seeing all destinations at once).~~ `[P3]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.3.3** Self-transitions excluded from orbit by construction; ignore if present in data model.~~ `[P3]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.3.4** Footer summary — live count + resolved `(from → to)` pairs across all sources; eyebrow label "RULE COUNT".~~ `[P3]`
  > Last checked: 2026-05-11

### FE-GOV-0004.4 Frontend — swap matrix → orbit

- ✅ ~~**FE-GOV-0004.4.1** Note: the matrix call-site lives inside the moved `flow-states/page.tsx` (now under `workspace-settings/workspace-settings/flow-states/`). Removal is folded into **FE-GOV-0004.0.5** — there is no separate "swap" step because the orbit editor lives on its own page (FE-GOV-0004.0.1), not in place of the matrix. Retained here as a marker that no `?view=matrix` query-param fallback ships; matrix dropped entirely.~~ `[P2]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.4.2** Add `.fs-orbit__*` / `.flow-rules__*` styles to `app/globals.css` (rail, canvas, node, arrow, focus ring). No bespoke colours — tokens only.~~ `[P3]`
  > Last checked: 2026-05-11

### FE-GOV-0004.5 Backend — artefact-move enforcement (`artefactitemsv2`)

- **FE-GOV-0004.5.1** In `backend/internal/artefactitemsv2/service.go` `PatchWorkItem`, before writing the new `flow_state_id`, fetch current `flow_state_id` for the artefact; if `current != new` and at least one `flow_transitions` row exists for the flow, require `EXISTS (SELECT 1 FROM flow_transitions WHERE from_state_id = current AND to_state_id = new)`; otherwise return `ErrInvalidInput` with message `"transition not permitted"`. `[P1]`
- **FE-GOV-0004.5.2** Empty-flow exemption: if `(SELECT COUNT(*) FROM flow_transitions ft JOIN flow_states fs ON fs.id = ft.from_state_id WHERE fs.flow_id = $flow_of_current_state) = 0`, skip the check and allow the move — preserves fresh-workspace UX. `[P1]`
- **FE-GOV-0004.5.3** No-op move (`current == new`) bypasses the transition check entirely. `[P2]`

### FE-GOV-0004.6 Backend — audit other writers for the same gap

- **FE-GOV-0004.6.1** Audit `backend/internal/portfolioitemsv2/service.go` (`PatchPortfolioItem` or equivalent) for a `flow_state_id` write path; apply the same enforcement + empty-flow exemption + no-op bypass. `[P1]`
- **FE-GOV-0004.6.2** Audit any bulk-move / drag-to-column kanban endpoints (`/bulk-status`, `/kanban-move` style); apply the same checks per-row; fail-fast on first invalid move with a structured error indicating which row(s) violated. `[P2]`
- **FE-GOV-0004.6.3** Audit any v1 routes still mutating `flow_state_id` on the legacy pools — close the gap there too or document why they're exempt (e.g. retiring under PLA-0030). `[P2]`

### FE-GOV-0004.7 Backend — tests

- **FE-GOV-0004.7.1** Go-test `artefactitemsv2.PatchWorkItem`: (a) allowed transition succeeds, (b) blocked transition returns `ErrInvalidInput`, (c) no-op move succeeds even when current state has no outbound rules, (d) empty-flow exemption allows any move, (e) subscription isolation — rule defined in tenant A cannot be triggered by tenant B. `[P2]`
- **FE-GOV-0004.7.2** Parallel test suite for portfolio items, mirroring 4.7.1. `[P2]`

### FE-GOV-0004.8 Frontend — error toast on rejected move

- **FE-GOV-0004.8.1** Verify existing `notify.apiError` path surfaces the `"transition not permitted"` message cleanly on work-items + portfolio-items PATCH; if copy reads as raw API error, map to friendly "Move not allowed — `{from}` → `{to}` is not in the workflow rules for this {artefact-type}." in the handler. `[P3]`

### FE-GOV-0004.9 Verification

- **FE-GOV-0004.9.1** `go build ./cmd/server/...`, `npm run typecheck`, `npm run lint:writer-boundary` all pass (no new tables → no writer-boundary registry change). `[P2]`
- **FE-GOV-0004.9.2** Browser test on `/workspace-settings/workspace-settings/transition-rules` (and confirm Flow States + Work Items resolve at their new `workspace-settings/<tab>` URLs): pick state in rail → centred in canvas with no layout shift outside canvas; tap orbit node → arrow animates in/out; refresh → rule persists; rail outbound count + footer update live; Tab through nodes; arrow keys walk orbit; Space toggles. `[P2]`
- **FE-GOV-0004.9.3** Browser test on `/work-items`: drag a card across a blocked transition → toast rejects, card snaps back; drag across an allowed transition → succeeds; fresh tenant (no transitions defined) → all moves allowed; add one rule then re-test → only that rule passes. `[P1]`
- **FE-GOV-0004.9.4** Parity check on Strategy section (portfolio items): same UI + same enforcement behaviour as work items. `[P2]`

### FE-GOV-0004.10 Open decisions (resolve before story creation)

- **FE-GOV-0004.10.1** Empty-flow default — **decided: open** (no rules → any move allowed). Preserves fresh-workspace UX. Recorded here so the contract is durable. `[P2]`
- **FE-GOV-0004.10.2** Portfolio enforcement — **decided: yes**, same enforcement as work items. Consistency over scope creep. `[P2]`
- **FE-GOV-0004.10.3** Matrix coexistence — **decided: drop entirely** (no `?view=matrix` fallback). Matrix is internal-only with no muscle-memory users. `[P2]`
- **FE-GOV-0004.10.4** Working-prototype reuse — confirm whether `Flow rule builders.html` + `m3-orbit.jsx` exist in the repo and whether to copy SVG math verbatim. If absent, treat the brief's math snippet as authoritative spec. `[P3]`

---

## FE-POR-0002. Chrome Scope Picker (PLA-0042) ★ FORCING FUNCTION

Chrome-level scope picker mounted before the breadcrumbs in `RedesignTopBar` (Rally / Linear convention; see research paper [R051](dev/research/R051.json)). Lets a logged-in user pick between the topology nodes they hold a live grant on — `admin | editor | viewer` rows from `users_roles_topology_nodes` (post-RF1.4.2 rename of the original `topology_role_grants`) — so the active scope follows them across pages. **Iteration 1 (this entry):** picker UI + `ScopeContext` + URL `?scope=<node_id>` + localStorage persistence; no read-path wiring yet (picking a scope persists the choice but does not narrow backlogs / portfolios / dashboards). **Iteration 2 (separate plan):** wire `activeNodeId` into work-items / portfolio-items / dashboard reads as a `?scope=` server filter — every consuming endpoint gets a clamp parameter, and the backend has to decide how scope clamps stack with workspace clamps. Plan: `dev/plans/PLA-0042.md`. `[P2]` ✅ DONE 2026-05-17 (was ★ FORCING FUNCTION — all 11 sub-items shipped; iteration 2 follow-up parked as FE-POR-0003)

### FE-POR-0002.1 Backend — `GET /api/topology/grants/me`

- ✅ ~~**FE-POR-0002.1.1** `Service.ListMyGrants(ctx, subscriptionID, userID)` in `backend/internal/orgdesign/service.go` — JOIN `topology_role_grants` + `topology_nodes`; filter `revoked_at IS NULL` AND `archived_at IS NULL`; return `MyGrant{grant_id, node_id, workspace_id, parent_id, name, label_override, colour, icon, role, granted_at}` ordered by node name.~~ `[P2]`
  > Last checked: 2026-05-17 — landed in `backend/internal/topology/service.go:1000` (package renamed orgdesign → topology per RF1.4.1). Joins `users_roles_topology_nodes` (post-RF1.4.2 column rename of `topology_role_grants`) + `topology_nodes`. Adds `actorRole` param + gadmin-synth-grant override; adds `Position` field for PLA-0044 walker. SQL in `sql.go` (sole-writer boundary).
- ✅ ~~**FE-POR-0002.1.2** `Handler.MyGrants` in `backend/internal/orgdesign/handler.go` — thin wrapper; reads actor from `auth.UserFromCtx`.~~ `[P2]`
  > Last checked: 2026-05-17 — landed in `backend/internal/topology/handler.go:608`.
- ✅ ~~**FE-POR-0002.1.3** Register `GET /grants/me` on **both** `/_site` and `/samantha/v2` per PLA-0039 transport-segregation; **not** inside the workspace-clamped subrouter — a user's grants legitimately span workspaces inside the subscription.~~ `[P2]`
  > Last checked: 2026-05-17 — registered in `backend/cmd/server/main.go:1190` and `main.go:1539`.

### FE-POR-0002.2 Frontend — ScopeContext + client

- ✅ ~~**FE-POR-0002.2.1** `MyGrant` interface + `listMyGrants()` method on `topologyApi` (`app/lib/topologyApi.ts`) routed through `apiSite()`.~~ `[P2]`
  > Last checked: 2026-05-17 — `topologyApi.ts:54` (interface) + `topologyApi.ts:132` (method).
- ✅ ~~**FE-POR-0002.2.2** New `app/contexts/ScopeContext.tsx` — provider holds `{grants, activeNodeId, activeGrant, loading, error, setActiveNodeId, reload}`; fetches on mount when authed; resolves active id from URL `?scope=` → localStorage `vector.scope.activeNodeId` → `null`; validates the candidate is still in the grant set (revoked / archived → falls back to `null`); `setActiveNodeId` writes both URL via `router.replace` and localStorage.~~ `[P2]`
  > Last checked: 2026-05-17 — `app/contexts/ScopeContext.tsx` present with all listed state + storage key `vector.scope.activeNodeId`.
- ✅ ~~**FE-POR-0002.2.3** Mount `<ScopeProvider>` in `app/(user)/layout.tsx` between `ActiveNavProvider` and `DomRegistryProvider`.~~ `[P2]`
  > Last checked: 2026-05-17 — `app/(user)/layout.tsx:40` (between ActiveNavProvider and DomRegistryProvider, as specified).

### FE-POR-0002.3 Frontend — `<ScopePicker />` chrome component

- ✅ ~~**FE-POR-0002.3.1** New `app/components/ScopePicker.tsx` — trigger button (`.btn.btn--ghost`) showing active scope label + chevron; outside-click + Escape close; auto-focus filter input on open.~~ `[P2]`
  > Last checked: 2026-05-17 — `app/components/ScopePicker.tsx` (183 lines).
- ✅ ~~**FE-POR-0002.3.2** Dropdown panel: filter input (`.form__input`), indented tree of granted nodes reconstructed from flat list via `parent_id` walks inside the grant set, role pill per row, role-coded active state. Visual indent capped at depth 6 via `.scope-picker__item--d{0..6}` modifier classes (no inline `style={{}}`).~~ `[P2]`
  > Last checked: 2026-05-17 — inside same `ScopePicker.tsx`; `buildTree()` walks parent links inside the grant set; `.scope-picker__item--d{0..6}` depth modifiers.
- ✅ ~~**FE-POR-0002.3.3** Edge states: zero grants → picker renders nothing (no disabled stub); filter no-match → "No matches."; load error → inline error row.~~ `[P3]`
  > Last checked: 2026-05-17 — inside same `ScopePicker.tsx`.
- ✅ ~~**FE-POR-0002.3.4** Mount `<ScopePicker />` at the start of the breadcrumbs row in `app/redesign/components/RedesignTopBar.tsx` (the real chrome header — original spec named `PageHeaderBar.tsx` which doesn't exist). RedesignTopBar renders inside the `ViewportSlot kind="header"` and is the host for all `(user)` pages via `RedesignShell`.~~ `[P2]`
  > Last checked: 2026-05-17 — imported and mounted before the breadcrumbs `<nav>` in `RedesignTopBar.tsx:7,23`. ScopePicker self-hides when grants.length === 0 (per .3.3) so chrome stays clean for users with no topology grants.
- ✅ ~~**FE-POR-0002.3.5** CSS in `app/globals.css` under `.scope-picker*` namespace, appended after the `.avatar-menu` block; tokens only (`--surface`, `--border`, `--ink-1`, `--ink-3`, `--hover`); no shadow.~~ `[P3]`
  > Last checked: 2026-05-17 — `app/globals.css:586+` with `.scope-picker`, `.scope-picker__trigger`, `.scope-picker__panel`, `.scope-picker__search`, `.scope-picker__list`, `.scope-picker__item` rules.

### FE-POR-0002.4 Follow-up (deferred — separate plan)

- ✅ ~~**FE-POR-0002.4.1** Read-path wiring — `?scope=<id>` becomes a server filter on `/work-items`, `/portfolio-items`, `/sprints`, `/releases`, dashboard endpoints. Each handler decides whether scope-clamp stacks with workspace-clamp or replaces it. Cards filed under a new plan when this lands.~~ `[P2]` — superseded by FE-POR-0003 (PLA-0043).
- **FE-POR-0002.4.2** "Recent scopes" / "Pinned scopes" submenus (R051 nice-to-have; Linear / Jira pattern). `[P4]`
- **FE-POR-0002.4.3** Cross-subscription scope picker (only if multi-sub support ships). Currently out of scope — grants are subscription-scoped by design. `[P5]`

---

# Parked — solo-dev mode (since 2026-05-17)

Items below were in-flight when solo-dev mode was established 2026-05-17 but exceed the WIP-cap of 5. **Content preserved verbatim** — every sub-item, every commit ref, every priority tag. To unpark, swap with a live item (cap stays at 5). Re-activation in prod-ready mode unparks all. See [`.claude/memory/feedback_solo_dev_mode.md`](.claude/memory/feedback_solo_dev_mode.md).

---

## FE-POR-0003. Topology Scope Clamp on Artefact Reads (PLA-0043) — parked 2026-05-17

Iteration-2 follow-up to PLA-0042: the chrome picker writes `?scope=<topology_node_id>` to the URL, this plan teaches the **read path** to honour it. Artefacts gain a nullable `topology_node_id` FK on `vector_artefacts.artefacts`; backend services clamp list reads to "this node + every descendant" via a recursive-CTE helper; grants inherit DOWN only (a grant on a parent reaches descendants; a grant on a child never reaches its parent); gadmin bypass preserved. Stacks with the existing workspace clamp — both must pass.

Design validated against Rally / Jira / ADO via R052 + R053: single-FK ownership is universal across all three; adjacency-list + recursive-CTE matches Rally's storage model; grant-inherits-down matches ADO's permission convention. Move semantics (leave-vs-carry descendants) defer to PLA-0044.

> R054 (Rally user-to-project assignment UX, 2026-05-12) further validates the PLA-0042 / PLA-0043 direction: Rally's only built-in dynamic inheritance is the grant-inherits-down read clamp Vector ships in FE-POR-0003.3 (`CanReadScope`); all other Rally cascades are opt-in one-shot copies (workspace default-grant at user-create, copy-users on child-project-create). The R054-driven user-management surfaces (per-user grid page, workspace default-access setting, copy-grants on child create, CSV bulk import, re-parent policy) are scoped under B6.8–B6.12, not under PLA-0042/PLA-0043, since those plans cover the picker + read clamp respectively. Rally pattern confirms Vector should keep the per-user view as primary; per-node roster view (Rally's "Project Setup → Users tab") is a future P4 add.

### FE-POR-0003.1 Schema — `topology_node_id` FK on artefacts

- **FE-POR-0003.1.1** Migration `db/artefacts_schema/NNN_artefacts_topology_node_id.sql` — add `topology_node_id UUID NULL REFERENCES topology_nodes(id) ON DELETE SET NULL` on `vector_artefacts.artefacts`; partial index `WHERE topology_node_id IS NOT NULL AND archived_at IS NULL`. NULL = un-assigned (visible in unscoped view, excluded from scoped view). `[P2]`

### FE-POR-0003.2 Backend — `DescendantNodeIDs` helper

- **FE-POR-0003.2.1** `orgdesign.Service.DescendantNodeIDs(ctx, subscriptionID, rootNodeID) ([]uuid.UUID, error)` in `backend/internal/orgdesign/service.go` — recursive CTE walking `topology_nodes` children; skip `archived_at IS NOT NULL`; cycle-guard via depth cap (max 12 levels, matches portfolio convention). Returns root + all live descendants. Follows the same shape as existing `ArchivedDescendants` helper at line 960. `[P2]`
- **FE-POR-0003.2.2** Unit tests in `service_test.go` — single node, parent+children, multi-level tree, archived child excluded, cycle-safe (synthetic bad data). `[P3]`

### FE-POR-0003.3 Backend — `CanReadScope` permission helper

- **FE-POR-0003.3.1** New `backend/internal/orgdesign/permissions.go` exporting `CanReadScope(ctx, userID, targetNodeID) (bool, error)` — gadmin bypass; otherwise check if any of user's grants are on `targetNodeID` itself OR on any **ancestor** of `targetNodeID` (grant-inherits-down). Grants on descendants of target do NOT count (no upward leakage). Uses adjacency-list walk via existing `parent_id` chain. `[P2]`
- **FE-POR-0003.3.2** Unit tests — grant on self passes; grant on parent passes; grant on grandparent passes; grant on child rejects parent; gadmin bypass; revoked grant rejects; archived target rejects. `[P3]`
- **FE-POR-0003.3.3** Audit-log code `scope_read_denied` emitted from list handlers when scope clamp filters out everything (signal: misconfigured grant or stale URL). `[P3]`

### FE-POR-0003.4 Backend — `artefactitemsv2.List` scope clamp

- **FE-POR-0003.4.1** `artefactitemsv2.Service.ListWorkItems` (backend/internal/artefactitemsv2/service.go:83) — accept optional `scopeNodeID *uuid.UUID`; when non-nil: call `CanReadScope` (403 if false), then `DescendantNodeIDs`, then add `WHERE topology_node_id = ANY($N::uuid[])` to the existing workspace-clamped query. Workspace clamp + scope clamp BOTH applied. `[P2]`
- **FE-POR-0003.4.2** Handler — parse `?scope=<uuid>` from query in `backend/internal/artefactitemsv2/handler.go`; validate UUID format (400 on parse fail); pass to service. Unset/empty → unscoped (existing behaviour). `[P2]`
- **FE-POR-0003.4.3** Handler tests — unscoped (no `?scope=`) returns all artefacts in workspace as today; scoped to leaf returns only that node's artefacts; scoped to parent returns parent + descendants; scoped to node user has no grant on → 403; un-assigned artefacts excluded from scoped view, included in unscoped view. `[P3]`

### FE-POR-0003.5 Frontend — `apiSite` scope forwarding

- **FE-POR-0003.5.1** `app/lib/api.ts` — extend `apiSite()` to auto-append `?scope=<activeNodeId>` (read from current `window.location.search`) on GET requests when the URL already carries `scope`. POST/PATCH/DELETE remain unchanged (writes addressed in PLA-0044). Single touch-point replaces per-page wiring. `[P2]`

### FE-POR-0003.6 Public API — OpenAPI

- **FE-POR-0003.6.1** `dev/openapi/openapi-v2.yaml` — document `?scope=<uuid>` query parameter on `/work-items` (and any other artefact-list route promoted to v2). Note grant requirement: scope node must be in caller's grant set or an ancestor of one. `[P3]`

### FE-POR-0003.7 Verification

- **FE-POR-0003.7.1** Manual verification — seed fixture artefacts on nodes A, A/B, A/B/C; grant role on A/B; verify: picker on B shows B+C artefacts; picker on A → 403 (no grant); picker cleared → all artefacts in workspace (including A and un-assigned). `[P3]`

### FE-POR-0003.8 Follow-ups (deferred)

- **FE-POR-0003.8.1** Write-side node assignment — `topology_node_id` on artefact create/update; "leave vs carry descendants" radio on topology node move (industry-divergent option, default = leave per Rally/Jira/ADO). Deferred (PLA-0044.followup-B; walker is the substrate, move-policy UX is the deferral). `[P2]`
- **FE-POR-0003.8.2** Portfolio + timebox (sprint/release) scope clamps. Deferred to PLA-0045. `[P3]`
- **FE-POR-0003.8.3** Un-assigned artefact ETL — backfill `topology_node_id` for existing rows where workspace → topology mapping is unambiguous. Deferred to PLA-0046. `[P3]`

### FE-POR-0003.9 Unified topology-traversal engine (PLA-0044)

Single shared topology walker — eliminates four independent walks (canvas dagre layout, canvas-tree state hook, topology flyout, scope rail) currently drifting on orphan policy, sort order, and depth-0 quirks. Surfaced when ScopeRail showed a spurious "D" node that the canvas correctly dropped: ScopeRail re-rooted orphans (parent_id set but parent not in user's grant set), while the canvas dropped them. Single walker + consistent orphan policy fixes the drift. Walker lives in `app/lib/shared/topology/` (cross-runtime TS) with a Go parallel at `backend/internal/shared/topology/` — see PLA-0045 for the shared-methods home convention. Iteration 1 powers the `/_site` BFF tree response; public `/samantha/v2/topology/tree` exposure is deferred to PLA-0044.followup-A.

- **FE-POR-0003.9.1** `app/lib/shared/topology/walker.ts` — generic `walkTopology<T extends TopologyNode>(nodes, opts)` returning `{rows, visibleIds, visibleEdges, childrenOf}`. Opts: `collapsed: Set<string>`, `sort: (a,b)=>number`, `filter?: (n)=>boolean` (default: archived_at IS NULL), `maxDepth?: number` (default 12). Orphans (parent_id set but parent missing/filtered) dropped — caller pre-resolves if a different policy is needed. Generic over node shape so it works for both `OrgNode` (canvas, has `position`) and `MyGrant` (rail). Cross-runtime: imported by frontend React components AND `/_site` BFF route handlers. `[P2]`
- **FE-POR-0003.9.2** Refactor `app/components/topology/layoutWithDagre.ts` — replace inline visible-set + edges walk (lines 30–38, 51–59) with `walkTopology()` output; dagre still attaches coordinates after. Canvas card map (image 1) uses this. `[P2]`
- **FE-POR-0003.9.3** Refactor `app/components/topology/useTopologyTreeState.ts` — replace its own `childrenOf` useMemo by destructuring from `walkTopology()` result (`result.childrenOf`). Topology table view (image 2) uses this. `[P2]`
- **FE-POR-0003.9.4** Refactor `app/components/TopologyTreeFlyout.tsx` — replace `buildTree()` with `walkTopology()`. Renderer (not walker) handles depth-0 spine column drawing; removes the depth-0 path-zeroing quirk from the engine. `[P2]`
- **FE-POR-0003.9.5** Refactor `app/components/ScopeRail.tsx` — replace `buildTree()`/`flattenTree()` with `walkTopology()`. Renderer skips depth-0 spine column (flush-left root). Fixes spurious "D" orphan bug. ScopeRail rail (image 3) uses this. `[P2]`
- **FE-POR-0003.9.6** Unit tests `app/lib/shared/topology/walker.test.ts` — flat list, single-root deep tree, multi-root forest, orphan-drop, cycle-guard (depth-cap synthetic loop), collapse hides subtree but keeps row, sort by label vs position, edges only between visible nodes. Reads same fixtures as the Go suite. `[P3]`
- **FE-POR-0003.9.7** Backend Go mirror `backend/internal/shared/topology/walker.go` — generic `WalkTopology[T any](nodes, opts)` mirrors TS surface with accessor-func opts (no method-interface). Iteration 1: powers `/_site/topology/tree` (BFF) only. Public `/samantha/v2/topology/tree` exposure deferred to PLA-0044.followup-A. Parity locked by `dev/fixtures/shared/topology/*.json` golden fixtures consumed by both TS Vitest and Go test suites. `[P3]`
- **FE-POR-0003.9.8** Add `position INT` to `MyGrant` (`backend/internal/orgdesign/service.go` struct + `ListMyGrants` query) so ScopeRail can sort by position to match the canvas. Followup commit. `[P3]`
- **FE-POR-0003.9.9** Visual smoke — canvas card map renders identically pre/post refactor; topology tree table renders identically; flyout renders identically; ScopeRail no longer shows orphan "D". Single `<screenshot>` reference set in `dev/research/` if drift detected. `[P3]`
- **FE-POR-0003.9.10** `app/components/topology/UserNodeAssignment.tsx` — new gadmin-only tree picker (checkbox per row) for assigning users to topology node(s). Fifth consumer of `walkTopology()`: walker provides visible-rows + edges + collapse semantics; only the row renderer is bespoke (checkbox cell instead of name). Validates that the walker is reusable for non-display-tree consumers. `[P3]`

---

## B-SHARE. Short-link service for sharing views & filters — parked 2026-05-18

Polymorphic short-link lookup service so users can share URLs and (later) full view/filter payloads without 500-char QR codes or unreadable links. Table `short_links` in `mmff_vector` with `kind` discriminator (`url` | `payload`), nullable `target_url` / `payload` columns enforced by CHECK constraint, tenant-scoped via `tenants_id` FK, opt-in `expires_at` TTL, soft-delete via `archived_at`, plus `resolve_count` / `last_resolved_at` for lightweight analytics. Slugs are 8-char base62 from `crypto/rand` (~218 trillion possibilities, not enumerable). Backend service at `backend/internal/shortlinks/` follows the handler/service/sql split (RF1.2 convention); v2 routes `POST /samantha/v2/short-links`, `GET /samantha/v2/short-links/:slug`, `DELETE /samantha/v2/short-links/:slug`, `GET /samantha/v2/short-links`. Frontend route `app/s/[slug]/page.tsx` resolves and either server-redirects (`kind='url'`) or rehydrates state (`kind='payload'`). Helper at `app/lib/shared/shortlinks.ts` (per shared-methods catalogue convention) used by `QRCodeTrigger` popover and any future "Copy share link" action.

> **Parked 2026-05-18** — design captured but unparking deferred until a real consumer arrives (saved-views feature, mobile QR-share for stakeholder demos, or repeated user pain from long filter URLs). Today's `QRCodeTrigger` encodes `origin + pathname` only (strips query/hash) — sufficient density for the in-page sharing primitive. When unparked, the trigger swaps to minting `/s/<slug>` on popover open and the `kind='payload'` path lights up alongside whatever view/filter persistence ships. Decisions baked in: polymorphic from day one (`kind='url' | 'payload'`), random base62 slugs (not enumerable, no vanity slugs to spoof), tenant-scoped (signed-in users only — no public/anonymous resolution; defence/finance buyer requirement), opt-in TTL (no expiry by default), always mint new slug per share (no dedup — simpler audit trail, payload-kind rows can't dedup anyway).

- **B-SHARE.1** Migration — `db/mmff_vector_schema/NNN_short_links.sql` creates `short_links` table with CHECK constraint enforcing kind/payload coherence, `tenant_idx` partial index `WHERE archived_at IS NULL`, `expires_idx` partial index `WHERE expires_at IS NOT NULL AND archived_at IS NULL`. `[P3]`
- **B-SHARE.2** Backend service — `backend/internal/shortlinks/{handler,service,sql,service_test,sql_test}.go`; slug minting uses `crypto/rand.Read(6)` + base62 encode + `INSERT … ON CONFLICT (slug) DO NOTHING RETURNING id` with 5-retry collision loop. Wire in `backend/cmd/server/main.go` using the `pool` variable. `[P3]`
- **B-SHARE.3** Backend routes — `POST/GET/DELETE/GET-list` on `/samantha/v2/short-links` with tenant-clamp on every read (NEVER ASSUME — golden-rule re-verify on resolve). `[P3]`
- **B-SHARE.4** Frontend route — `app/s/[slug]/page.tsx` server component; 404 on expired/archived/wrong-tenant, 401 → `/login?next=/s/<slug>`, `kind='url'` server-redirect, `kind='payload'` hydration client component. `[P3]`
- **B-SHARE.5** Shared helper — `app/lib/shared/shortlinks.ts` with `createShortLink({ kind, target_url?, payload?, expires_in_seconds? })` + companion Go helper if needed in `backend/internal/shared/shortlinks/`; entry in `docs/c_shared_methods.md`. `[P3]`
- **B-SHARE.6** `QRCodeTrigger` rewire — on popover open (not page load), mint `/s/<slug>` for current href, cache by href, show "Generating link…" intermediate state, encode `https://vector.app/s/<slug>` in the 256px popover QR; 40×40 trigger keeps the pathname-only encoding for instant render with no network call. `[P3]`
- **B-SHARE.7** Nightly sweeper — cron or scheduled job that hard-archives rows where `expires_at < now() - interval '30 days'` and `archived_at IS NULL`. Out of scope until a real expiring-link use-case appears; document the schema readiness only. `[P4]`
- **B-SHARE.8** Slug-enumeration security test — automated test (Go) hammers `/s/<random-slugs>` and asserts: 404 on non-existent, 401 on wrong-tenant existing, no rate-limit bypass via slug brute-force. Tracks B16.8 security-hardening posture. `[P3]`

---

## Unmatched Commits

> Commit `877ec30` (2026-05-09): fix(B22): move dynamicIdColWidth above fixedWidths — fix ReferenceError
> Commit `4ebf82f` (2026-05-09): fix: resolve getParentId/getChildrenCount functions in wizard config
> Commit `ca3e543` (2026-05-09): feat(PLA-0030 B19.7): wire p_wizard.json sidecar pattern to work-items and portfolio-items pages
> Commit `5c8f97b` (2026-05-09): docs(B20): add User Access Rights & Navigation Control section [B20]
> Commit `65851a0` (2026-05-09): fix: auto-redirect to first accessible tab in workspace-settings
> Commit `974c640` (2026-05-09): fix: allow padmin to access workspace-settings with role-gated tabs
> Commit `5989e2b` (2026-05-09): docs: mark B9 (webhooks) as complete [B9]
> Commit `4bdfeea` (2026-05-09): fix(B9.1): resolve webhookSvc variable shadowing bug
> Commit `8b194b6` (2026-05-09): fix: add CSRF token to webhook form submission [B9.1]
> Commit `88ff415` (2026-05-09): docs(B6.7): update scope with workspace-settings padmin fix completion
> Commit `61a1876` (2026-05-09): fix(PLA-0018): grant padmin access to workspace-settings [B6.7]
> Commit `22f6bfc` (2026-05-09): docs(B15.2): add example ObjectTreeConfig props for work_items and strategy_items
> Commit `fa56b2c` (2026-05-09): refactor(B15.2): organize ObjectTree into dedicated folder structure
> Commit `01a0c38` (2026-05-09): fix(B6.7): workspace-settings should not be default-pinned
> Commit `027638a` (2026-05-09): chore(B6.6): drop legacy topology V1 tables (org_nodes, org_levels, org_node_roles)
