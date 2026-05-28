# Vector — Completed Scope Archive

**Extracted from:** [`Vector_Scope.md`](Vector_Scope.md) on 2026-05-28
**Purpose:** keep the live scope tracker focused on in-flight + scoped-but-dormant work. Closed top-level themes live here in full so the audit narrative survives (commit SHAs, dates, TD pointers, phase outcomes).

**Extraction rule (2026-05-28 cleanup):** whole top-level themes marked `✅ DONE` were moved here verbatim, minus commit-trail lines that the auto-appender had injected unrelated to the story above them. Per-story commits that actually describe the work in their subject line were kept. The original `Vector_Scope.md` leaves a one-line pointer in place of each moved block.

---

## Table of Contents

- [RF1. Codebase Recovery (PLA-0048)](#rf1-codebase-recovery-pla-0048--done-2026-05-18)
- [B14. Addressables & Page Help](#b14-addressables--page-help--done)
- [B15. UI Primitives & Design System](#b15-ui-primitives--design-system--done)
- [Historical change log — Vector_Scope.md header](#historical-change-log--vector_scopemd-header)

---

## RF1. Codebase Recovery (PLA-0048) ✅ DONE 2026-05-18

Drag the codebase from its current state (SQL scattered across 56 of 137 backend files, inconsistent table/route naming, CI gates that only fire on PR-to-main) into a shape a DBA or fresh engineer can read at first glance. Built from four parallel Opus audits run 2026-05-13 — not from memory. Audit findings: 42 backend packages, 32,877 lines non-test Go, 461 raw SQL string literals embedded in service files, **zero `sql.go` files**, 10 packages touching >1 database, 22 cross-DB function paths (5 high-risk). Master plan: [`docs/c_c_the_state_of_the_codebase.md`](docs/c_c_the_state_of_the_codebase.md). Plan card: [`dev/plans/PLA-0048.json`](dev/plans/PLA-0048.json). Hard stop gates between every phase; no improvisation; every commit reversible. `[P1]`

**Outcome:** all 7 phases closed (drift-prevention lints, sql.go consolidation in 20 packages, per-DB migration dirs, naming-convention sweep, cross-DB writer hardening, docs pass, completion tests). 461 raw SQL literals consolidated into named consts; allow-list shrunk from 58 files at seed to 10 files reserved for later phases. Two follow-up gaps surfaced by RF1.7 captured as **TD-RF1-DOC-GO-ADOPTION** (S3, 41 packages need a `doc.go`) and **TD-RF1-TEST-COLUMN-RENAME-DRIFT** (S2, 14 packages have test-fixture column-rename drift) — neither blocks production.

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
- ✅ **RF1.1.3** ~~`lint:exemption-ratchet` — `*_exempt.json` files cannot grow commit-to-commit.~~ Walks 11 ledgers, fails on any growth vs HEAD~1. `[P1]`
- ✅ **RF1.1.4** ~~`lint:deferral-needs-td-id` — commit messages containing deferral phrases must reference `TD-*`.~~ Standalone script; commit-msg hook installation deferred (RF1.1.7 follow-up). `[P1]`
- ✅ **RF1.1.5** ~~`lint:package-naming-convention` — fails any `*v\d+` package without a register entry naming the predecessor.~~ Updated to match §1.1.2 v-suffix-with-meaning rule (doc.go must explain predecessor). `[P1]`
- ✅ **RF1.1.6** ~~New CI workflow `tests.yml` running `npm test`, `npx tsc --noEmit`, `go test ./...`, `go vet ./...` on every push (not just PR-to-main).~~ Five jobs: frontend, backend, rf1-lints, existing-lints, plus existing api-contracts.yml unchanged. `[P1]`
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
> Commit `f6b3f3d2` (2026-05-26): feat(prefix): Pillar 1 wave 1 — 5 leaf-table column-prefix sweeps [wave-1] [RF1.5.1]
- ✅ **RF1.5.2** ~~`portfoliomodels.DevResetHandler.MasterReset` stub.~~ `[P2]`
> Commit `80fda3a1` (2026-05-26): feat(prefix): Pillar 1 wave 2 — 5 VA leaf-table column-prefix sweeps [wave-2] [RF1.5.2]
- ✅ **RF1.5.3** ~~`artefactitems.Service.CreateWorkItem` stub.~~ `[P1]`
> Commit `fe8b6e14` (2026-05-26): feat(prefix): Pillar 1 wave 3 + trigger-function repair [wave-3] [RF1.5.3] [RF1.5.4]
- ✅ **RF1.5.4** ~~`libraryreleases.Handler.Ack` stub.~~ `[P2]`
- ✅ **RF1.5.5** ~~`errorsreport.Handler.Report` stub.~~ `[P3]`
> Commit `acec2814` (2026-05-26): feat(prefix): Pillar 1 wave 4 — 4 prefix sweeps + MRW PK normalize + trigger fix [wave-4] [RF1.5.5]
- ✅ **RF1.5.6** ~~`lint:cross-db-writer-test` shipped with shrinking ledger (6 packages on ledger).~~ `[P1]`
> Commit `cb13298e` (2026-05-26): feat(prefix): Pillar 1 wave 5 — pages + subscriptions prefix sweep [wave-5] [RF1.5.6]

### RF1.6 Phase 6 — Documentation pass ✅ DONE 2026-05-14 (commit 4e1e171 + closing commit c7f74bc)

- ✅ **RF1.6.1** ~~Regenerate `docs/c_c_db_routing.md` from code reality post-rewrite.~~ `[P1]`
- ✅ **RF1.6.2** ~~Update `docs/c_schema.md` with renamed table names + DB locations.~~ `[P1]`
- ✅ **RF1.6.3** ~~Finalise `docs/c_c_naming_conventions.md` post-Phase-4 — §2.8 now reads "COLUMN-PREFIX SWEEP COMPLETE"; §1.1.2 v-suffix example updated post-artefactitems rename; §3.3 status column added.~~ `[P2]`
- ✅ **RF1.6.4** ~~Reduce CLAUDE.md index to one-line-only entries per the standing rule.~~ `[P2]`
- ✅ ~~**RF1.6.5** Stop gate: user reads the regenerated docs.~~ Closed 2026-05-18. `docs/c_c_db_routing.md` (93 lines) + `docs/c_c_naming_conventions.md` (565 lines) reviewed and accepted; both reflect the post-RF1.4 state of the codebase. `[P1]`

### RF1.7 Completion tests (from master doc §6) — run 2026-05-18

- ⚠️ **RF1.7.1** Open `backend/internal/<any-package>/` and find `doc.go` + `service.go` + `handler.go` + `sql.go` + tests, in that order. `[P1]` — service/handler/sql.go present in every package, `doc.go` missing from 41 of 42 packages (only `artefactitems/doc.go` exists). Filed as **TD-RF1-DOC-GO-ADOPTION** (S3).
- ✅ **RF1.7.2** ~~Read `docs/c_c_naming_conventions.md` once and predict every future name.~~ Doc exists (565 lines), reviewed and accepted. `[P1]`
- ✅ **RF1.7.3** ~~Run `go run ./cmd/migrate -dry-run` against each DB and see zero pending migrations.~~ Applied pending `082_drop_subscription_prefix_unique.sql` to `vector_artefacts` on 2026-05-18; all three DBs now report "up to date". `[P1]`
- ⚠️ **RF1.7.4** Run `npm run api:check && npm test && go test ./...` and see zero failures. `[P1]` — 14 backend packages fail tests due to pre-RF1.4.4 column references in test fixtures (production code is unaffected — the renamed columns are correctly used by `sql.go`). Filed as **TD-RF1-TEST-COLUMN-RENAME-DRIFT** (S2).
- ✅ **RF1.7.5** ~~Open `docs/c_c_db_routing.md` and find every service mapped to its DB and tables — and trust that it matches the code.~~ Doc exists (93 lines), reviewed and accepted. `[P1]`

**RF1.7 outcome:** 3 of 5 tests fully clean; 2 surfaced real gaps captured as TD entries with explicit pay-down plans. Neither gap blocks production — `doc.go` is a docstring convention shortfall; test-fixture column drift is test-suite hygiene. RF1's core deliverables (sql.go discipline, drift-prevention lints, naming sweep, regenerated docs) are all in place.

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

> **Extraction note (2026-05-28):** B15.3 / B15.4 / B15.5 / B15.6 / B15.8 / B15.9 were contaminated in the source by an auto-appender that injected ~40 unrelated commit lines (RF1.4.4, sentinel S22/S25, CUT1.*, PLA-0049 etc.) inside their bodies. Those were stripped at extraction. Each story keeps the commit lines that actually describe the work in their subject. Run `git log -- app/components/Badge.tsx` etc. for the canonical history.

- ✅ **B15.1** `<Table>` component — single sanctioned table primitive `[P2]`
  > `app/components/Table.tsx` — canonical primitive (657 LOC); `lint:no-raw-table` enforcement; 4 tree exceptions on allow-list; spec: `docs/c_c_table_component.md`
- ✅ **B15.2** `<ResourceTree>` / `ObjectTree` — hierarchical tree + configuration registry `[P2]`
  `[x] Generic dumb primitive (p_ObjectTree.tsx); pluggable data-type config via object-tree-registry.tsx; ready for releases/sprints/portfolio items`
  > `app/components/ResourceTree.tsx` (1554 LOC); five prop sets (Data/Scaffold/Features/CogMenu/Colour); addressable substrate; spec: `docs/c_c_resource_tree.md`
- **B15.2.5** Sidecar wizard JSON pattern (`p_wizard_*.json`) `[P2]`
  > Each `p_*` primitive component reads its config from a sibling JSON file in `app/components/<primitive>/configs/`. Static config (UI labels, columns, dnd type, **resourceUrl**, **scope**, panel header / filter chip selectors) lives in JSON; runtime closures (accessors, hooks, React nodes) injected by the page via `resolveWizardConfig()`. Goal: non-technical users configure components by editing JSON, no TypeScript. First adopter: `p_ObjectTree` with `p_wizard_workitems.json` + `p_wizard_portfolio.json`. Spec to write: `docs/c_c_wizard_sidecar.md` (tracked under B21.3.3).
- ✅ **B15.3** `<Badge>` — status / count / letter / tag variants `[P2]`
  > `app/components/Badge.tsx` — semantic tone derivation (status + domain maps); pill CSS family; spec: `docs/c_c_badge.md`
- ✅ **B15.4** `<TimeboxManager>` — sprints + releases surface `[P2]`
  > `app/components/TimeboxManager.tsx` (369 LOC) — generic `kind` system (sprint/release); table-per-kind via `kinds.ts` registry; spec: `docs/c_c_timebox_manager.md`
- ✅ **B15.5** `<DiagramCanvas>` — Canvas2D + dagre + d3-zoom `[P3]`
  > Spec: `docs/c_c_diagram_canvas.md` — Vector-built Canvas2D + dagre layout + d3-zoom; 10px snap-to-grid default; pluggable node renderer; exposed via Samantha API as `samantha.diagram.canvas`
- ✅ **B15.6** Drag-and-drop (`@dnd-kit`) `[P2]`
  > `@dnd-kit/core` + `@dnd-kit/sortable` installed; canonical DnD library; sortable lists/tables/tabs; server is order of truth (250ms debounce); no competing libs; spec: `docs/c_c_dnd.md`
- ✅ **B15.7** Theme pack system `[P3]`
  > CSS variable theming live; warm neutrals palette per Design System; color derivation in Badge, Table, tree styles
- ✅ **B15.8** Dev-UI primitives (`.dui-*` catalog for internal pages) `[P3]`
  > `dev/styles/dev-ui.css` — `.dui-*` catalog live; HARD RULE: every `/dev` panel composes from catalog, no bespoke per-page classes, no inline styles; spec: `docs/c_c_dev_ui_primitives.md`
- ✅ **B15.9** CSS table migration — legacy `.table*` → canonical classes `[P3]`
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

## Historical change log — Vector_Scope.md header

The `Last updated:` and `Doc version:` paragraphs at the top of `Vector_Scope.md` had accreted an `Earlier — ... Earlier — ...` chain reaching back several weeks. As of 2026-05-28 the live header carries only the current state; the prior chain is archived here for the audit trail.

**Last updated chain (as of 2026-05-27):**

- 2026-05-27 — ✅ NV1.S06 MERGED at `7683049e` (Wave 3 closed). Notifications v2 Wave 3 pipeline package (enrich → filter → router) shipped: 14 files, 32/32 tests green (24 unit + 8 integration live-DB), validator PASS on re-review at `e93fb5dc`. PendingStore interface + InMemoryPendingStore in tree; Valkey impl deferred to S12 (Wave 4). Substrate pivoted from Redis → Valkey for licence-cleanliness (Redis SGPL/RSAL since March 2024; Valkey = BSD-3 Linux Foundation fork, AWS/GCP/Oracle-backed, wire-protocol-compatible). Valkey live on dev swarm at `localhost:6379` with read-only Redis Commander UI on `:3003`. 8/16 NV1 stories merged (~52 of ~104 points); Wave 4 next (S09 dispatchers + S12 Valkey impl, parallel-safe).
- Earlier — NV1.S06 added.
- Earlier — NEW FB1 top-level theme: FlowBoard — standalone Kanban component for `/value-flow` (PLA066). 15 stories across 4 phases (schema · backend · frontend · integration); 3 new migrations (132 `topology_nodes_members`, 133 `topology_nodes_wip_limits`, 134 `users_flowboard_prefs`); new `backend/internal/flowboard/` package with 5 endpoints; new `app/components/FlowBoard/` family mirroring ObjectTreeV2's sidecar+loader pattern (`p_wizard_flowboard_workitems.json`); samanthaAPI-addressable. Team ≡ topology node (Rally project-IS-team); WIP hangs off the node keyed by `flow_state_id` (no `flow_boards` table). Spec at `docs/superpowers/specs/2026-05-27-flowboard-design.md`. All 15 `P2 🔵 IN FLIGHT`.
- Earlier — B18.9 REVISED: column-prefix HARD RULE rolled back from 3-letter abbreviation to FULL TABLE NAME (`users.users_id`, `subscriptions.subscriptions_tier`, `master_record_workspaces.master_record_workspaces_id`). Mechanical, zero-collision, no registry needed. Matches the existing RF1.4.4 convention already partly applied across 9 migrations on 2026-05-14 (245→0 findings) plus the `lint:column-prefix-convention` lint already in tree. Registry doc `docs/c_c_column_prefix_registry.md` deleted. The 3-letter-abbreviation detour was a 2026-05-25 mistake corrected same-week.
- Earlier — B18.9 added: 3-letter column-prefix HARD RULE (rolled back).
- Earlier — B18.8 added: dev-action "Wipe & Reseed Vector substrate" button (one-click rebuild of mmff_vector + vector_artefacts from canonical seed, scoped to vector DBs only — mmff_dev + mmff_library untouched). Picked up after wipe-and-reseed plan completes.
- Earlier — PLA064 v4 doc refresh: orphan count 508 → 1,263 corrected post-cron-bug-fix (commit 57ed1958); cohort framing updated to match CUT1.5.0 remediation plan.
- Earlier — CUT1.5.0 added — orphan triage + remediation; the CUT1.0.2 cron's first run found 508 orphans across 14 columns (corrected to 1,263 post-bug-fix); CUT1.5.0 blocks CUT1.5.1; PLA064 v3 posted.
- Earlier — CUT1.0.2 + CUT1.5.1 AC counts corrected 8→50 after SY003 v2 regen; PLA064 v2 posted with matching corrections.
- Earlier — CUT1 added — 14-story mmff_vector → vector_artefacts cutover from PLA064.
- Earlier — PLA061 Phase 2 landed — 6 deferred candidates scoped under F2.5–F2.10 (no marker, awaiting trigger) + 2 promoted to 🔵 IN FLIGHT under B16.16 (helmet + @next-safe CSP) and B16.17 (isomorphic-dompurify) on the defence-finance procurement narrative.
- Earlier — PLA061 Phase 1 quick wins scoped — new F2 top-level (4 stories: react-scan, Million, culori+APCA, stack-picks doc) + B16.14/B16.15 perimeter rate-limit pair. All 6 🔵 IN FLIGHT. Origin: Next.js Ecosystem Library Adoption — Shortlist, /dev/reporting Plan tab.
- Earlier — New RF2 top-level theme added — Service Depth (PLA-0058), 13 stories across 7 phases, all grilled to 95% confidence via parallel Opus sub-agents — deep-module refactor of `backend/internal/artefactitems` (1929 LoC, 17 ops → 8 ops + 4 setters, 0 pass-through pairs, 0 hasWorkspace branches). Behaviour-preserving; pattern doc + RF2.0.1 stop-gate; cross-package callers in featuretests handled in Phase 5.
- Earlier — PLA056 revised: Phase 2/3 dependency softened, VIZ1.3.4a permission sub-story added between VIZ1.3.4 and VIZ1.3.5, VIZ1.3.6 AC sharpened from decide-localStorage-vs-DB to design-users_visualiser_groups-table — see PLA056 Change Log on /dev/reporting.
- Earlier — New OBJ1 top-level theme added — ObjectTreeV2 Filter-Chip Scope Facets, 8 stories across 4 phases (TD · backend · frontend · doc), per PLA057 on /dev/reporting. Closes the 2026-05-23 chip-vs-grid UUID mismatch where 27 Tasks were visible but the Task chip returned empty.
- Earlier — New VIZ1 top-level theme added — Vector Relationship Explorer, 14 stories across 3 phases (stabilise · deepen · data-feed swap), per PLA056 on /dev/reporting.
- Earlier — 2026-05-19 late night — B5.11–B5.16 scoped: permissions-collapse (PLA-0053) — drop `pages_tags.min_auth_level` tier gate, leave `users_roles_pages` as the sole catalogue gate; permissions page becomes the single authoring surface. Decomposed into migration / backend / frontend / UX / audit / TD-retirement. Origin: 2026-05-19 nav-rail incident where granting Team Member access to dev pages didn't surface the bucket because the tag-tier gate fired first.
- Earlier late night — B1.9 scoped: unified `/artefacts` REST API parked for later cycle. Single CRUD surface with intent verbs (reprioritise/reparent/restore/move) replaces the split `/work-items` + `/portfolio-items` clamp wiring. Decomposed into 9 sub-stories, last closes the `item_type` kill per the legacy-enum audit.
- Night session — B20.5.K + B20.5.L Scalar IDE dev-key auth: `DEV_API_KEY` in env + `apikeys.Middleware` dual-mounted on `/_site` with synthetic-user shim via `auth.Service.FindServiceUserForSubscription`. Full 268-endpoint surface now reachable from Scalar with one bearer token.
- Late-evening — B20.5.J Mount(r) resolution + route-orphan lint. B20.5.I extractor hardening pushed needs-curation 25 → 1.
- Earlier evening — B20.5.H chokepoint enforcement. B20.5.G handler-shape extractor.
- Afternoon — B20.5.A–.F: spec round-trip, parser tests, middleware-chain fix.

**Doc-version chain (as of v2.67):**

- 2.67 — ✅ NV1.S06 MERGED 2026-05-27 at `7683049e` — Wave 3 closed, 8/16 stories done, ~52 of ~104 points. Wave 4 next: S09 dispatchers + S12 Valkey PendingStore, parallel-safe.
- 2.66 — NV1.S06 added (PLA067), pipeline package single 13pt story, worker brief committed, S06 worker dispatched. Substrate pivoted Redis → Valkey for licence-cleanliness; Valkey live on swarm `:6379` + Redis Commander UI `:3003`.
- 2.65 — NV1.S06 added — Notifications v2 Wave 3 pipeline package, single 13pt story, PLA067.
- 2.64 — NEW FB1 — FlowBoard PLA066, 15 stories, 3 migrations, 1 new backend package, 1 new frontend component family.
- 2.63 — B18.9 REVISED — column-prefix HARD RULE rolled back from 3-letter abbreviation to FULL table-name prefix; registry doc deleted; matches existing RF1.4.4 convention.
- 2.62 — B18.9 3-letter version (rolled back).
- 2.61 — B18.8 dev wipe-and-reseed action button.
- 2.60 — PLA064 v4 doc refresh.
- 2.59 — CUT1.2.1 + CUT1.2.2 merge-plan DDLs.
- 2.58 — CUT1.5.0 added.
- 2.57 — CUT1.5.1 corrected 8→50.
