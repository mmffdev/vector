# The state of the codebase, and how we get it right

**Status:** Locked plan. Each step ends at a clearly defined commit. No step proceeds without explicit user confirmation. If a step doesn't work out, **stop, discuss, change course, do not improvise**.

**Author note:** Built from four parallel Opus audits run 2026-05-13, not from memory. Sources cited inline.

---

## §0 — The honest assessment

The codebase has 42 backend packages, 32,877 lines of non-test Go, 461 raw SQL string literals embedded in service files, **zero `sql.go` files**, three databases with 72 live tables, 22 cross-DB function paths (5 high-risk), and 27 entries in the tech-debt register.

The structure is not catastrophic. It is also not what a DBA or engineer would recognise as "good". Specifically:

1. **SQL is scattered across 56 of 137 backend files.** Moving a table = grep across many files instead of editing one.
2. **One package has a meaningless `v2` suffix** with no `v1` to distinguish from (`artefactitemsv2`).
3. **Migration directories are named by content (`db/schema/`, `db/artefacts_schema/`), not by which DB they target.** A future engineer reads the directory contents to know which DB each touches.
4. **Singular/plural inconsistency across tables and routes.** `topology_view_state` (singular) sits next to `topology_nodes` (plural). `/workspace/{id}/fields` (singular) sits next to `/workspaces` (plural). Both are in the same `mountSiteRoutes`.
5. **`master_record_*` table family is internal naming leaking into public routes.** `/portfolio` serves `master_record_portfolio` rows; the customer doesn't need to know that internal term.
6. **Two co-existing tables with near-identical names** (`workspace` singular legacy + `master_record_workspaces` plural canonical). Active code reads from both.
7. **The route `/portfolio-models` serves `portfolio_templates`** (different word for the same thing). Same package called `portfoliomodels`. Three names for one concept.
8. **CI gates only fire on PR-to-main**, not on feature-branch push. 56 commits of drift can accumulate before the gate ever sees them.
9. **The CSS naming HARD RULE has no automated lint.** Compliance is by trust.
10. **Tech-debt deferrals lived in chat / commit messages** until the deferral-register memory rule was added today (2026-05-13).

None of these are emergencies. All of them compound. The plan below addresses each at a specific phase, in an order designed so that **earlier phases make later phases cheaper**.

---

## §1 — Target architecture (the shape we are aiming for)

```
backend/
  cmd/
    server/main.go                ← thin wiring; no SQL, no business logic
    migrate/main.go               ← runs migrations per DB
  internal/
    <package>/                    ← one package per business domain
      doc.go                      ← what does this package own
      service.go                  ← business logic, calls sql.go constants
      handler.go                  ← HTTP layer; parses + renders, calls service
      sql.go                      ← ★ every SQL string in this package
      types.go                    ← exported DTOs + errors
      *_test.go                   ← tests, including cross-DB integration tests
      crossdb_test.go             ← required for any package using >1 pool

db/
  mmff_vector/                    ← ★ migration dir named after the DB
    schema/
      0001_*.sql
      down/0001_*.down.sql
    seed/
  vector_artefacts/
    schema/
      0001_*.sql
      down/0001_*.down.sql
    seed/
  mmff_library/
    schema/
      0001_*.sql
      down/0001_*.down.sql
    seed/

docs/
  c_c_db_routing.md               ← pool → DB → package matrix (kept current)
  c_c_naming_conventions.md       ← ★ the canonical naming spec (§3 below)
  c_tech_debt.md                  ← register, ratcheted (cannot grow silently)
```

Three concrete changes from where we are:

- **`sql.go` per package** — every SQL string moves out of function bodies into named constants in one file. Moving a table from DB A to DB B becomes: edit one `sql.go`, run two migrations.
- **Per-DB migration directories** — `db/schema/` → `db/mmff_vector/schema/`, `db/artefacts_schema/` → `db/vector_artefacts/schema/`. No renumbering, no breaking history; just relocation.
- **Naming convention applied uniformly** — codified once in `c_c_naming_conventions.md`, enforced by new lints (§5).

What we are **NOT** changing in this plan:

- The three-database split itself.
- The two transport surfaces (`/_site` BFF + `/samantha/v2` public).
- Any business logic.
- Any handler signatures or route paths in the same step as a code rename (route changes are deferred to a dedicated phase).

---

## §2 — The conventions (locked, codified, no improvisation)

These are the rules. They will live in `docs/c_c_naming_conventions.md` as a leaf doc. Any deviation requires a register entry; any new file must conform.

### §2.1 — Go packages

- **All lowercase**, single concept word.
- **No version suffixes** unless a coexisting version exists in the same tree.
- **Match the canonical noun of the domain** — the package name must equal either:
  - the table family it owns (e.g. `flows` owns `flows`, `flow_states`, etc.); OR
  - the customer-visible concept it serves (e.g. `auth`, `topology`).
- **No insider abbreviations.** `wsperms` → `workspacepermissions`, `entityrefs` → `polymorphicrefs`, etc. (these are scheduled, not done in this plan; see §4).

### §2.2 — Database tables

- **Plural for collections, singular for single-row-per-tenant master records.**
  - `topology_nodes`, `flow_states`, `users`, `roles` — plural collections.
  - `master_record_tenant`, `master_record_portfolio` — single-row anchors, singular *tail* but the `master_record_` prefix marks them.
- **Snake case throughout.**
- **Prefix conventions:**
  - `topology_*` — topology canvas tables (all in `vector_artefacts`).
  - `flow_*` / `flows` — workflow tables (`vector_artefacts`).
  - `artefact_*` / `artefacts` — artefact substrate (`vector_artefacts`).
  - `master_record_*` — single-row anchors with cross-DB soft FKs (`vector_artefacts`).
  - `timebox_*` — sprint/release scheduling (`vector_artefacts`).
  - `library_*` — library content (`mmff_library`).
  - `user_*` / `users` / `roles*` — auth substrate (`mmff_vector`).
- **No `obj_*`, no `o_*`, no abbreviations.** These are legacy and must be renamed when their last reader is migrated.
- **No version suffixes on tables.**

### §2.3 — HTTP routes

- **Always plural collections** (`/workspaces/{id}/...`, `/flows/{id}/...`).
- **REST canonical verbs** — `POST /api-keys` not `POST /api-keys/issue`; `DELETE /api-keys/{id}` not `POST /api-keys/revoke`.
- **Nested routes follow the resource hierarchy** — `/flows/{flowId}/states/{stateId}/exit-rules/{id}`, not `/flow-state-exit-rules/{id}`.
- **Internal concepts do not appear in routes.** `master_record` stays internal; routes say `/portfolios`, `/workspaces`.
- **One canonical noun per concept.** Pick `portfolio_models` OR `portfolio_templates`, not both.

### §2.4 — Go files inside a package

- **`doc.go`** — package-level documentation only.
- **`service.go`** — business logic. May reference `sql*` constants but contains NO raw SQL literals.
- **`handler.go`** — HTTP layer. Parses input, calls service, renders output. NO DB access, NO SQL.
- **`sql.go`** — ★ all SQL string constants for this package. Named in the form `sql<Verb><Resource>` (e.g. `sqlSelectCommitStatus`, `sqlUpsertCommit`).
- **`types.go`** — exported DTOs and sentinel errors.
- **`*_test.go`** — tests.
- **`crossdb_test.go`** — required for any package that uses >1 database pool.

### §2.5 — Migration files

- **Per DB, named numerically with leading zeros.** `0001_<descriptive_name>.sql`, paired with `down/0001_<descriptive_name>.down.sql`.
- **Every migration has a header block** with: title, motivation, run command, backfill notes, sole writer pointer.
- **No `obj_*`/`o_*` new tables** under any circumstances.

---

## §3 — The phased plan, with hard stop gates

Each phase ends at a labelled commit. After every phase: **STOP, present results, await explicit user confirmation**. If anything breaks mid-phase: STOP, revert if possible, discuss.

Phases are ordered so that **earlier phases make later phases mechanical**. The single biggest leverage is Phase 2 (sql.go consolidation). Everything after Phase 2 is comparatively cheap.

### Phase 0 — Codify the conventions (no code changes)

**Goal:** put §2 above into `docs/c_c_naming_conventions.md` as a leaf doc, referenced from `c_c_db_routing.md` and `CLAUDE.md` index.

**Files touched:** 1 new doc, 1 update to `CLAUDE.md` index line.

**Stop gate:** user reviews the conventions doc and confirms before any code change happens.

**Exit commit:** `docs: lock canonical naming conventions [PHASE-0]`

### Phase 1 — Add drift-prevention lints BEFORE the rewrite

**Goal:** install the gates that would have caught the worst of the drift. These run on push (locally and CI), so they catch regressions during Phases 2–6.

**New lints to add** (in this order):
1. `lint:sql-in-sqlfile-only` — forbids raw SQL outside `sql.go` files. Pre-Phase-2 it would fail loudly across the whole codebase; we add it with a wide allow-list seeded from the current state, then shrink the allow-list one package per Phase 2 step.
2. `lint:no-empty-route-block` — fails any `r.Route(...)` with no verb registrations inside.
3. `lint:exemption-ratchet` — `*_exempt.json` files cannot grow commit-to-commit.
4. `lint:deferral-needs-td-id` — commit messages containing deferral phrases must reference `TD-*`.
5. `lint:package-naming-convention` — fails any `*v\d+` package without a register entry naming the predecessor.

**Files touched:** 5 new lints under `dev/scripts/`, 1 update to `package.json`, 1 new workflow `tests.yml` running them all on push.

**Stop gate:** all five lints pass against current HEAD (with allow-lists where needed). User reviews lint configs.

**Exit commit:** `chore: install drift-prevention lints [PHASE-1]`

### Phase 2 — `sql.go` consolidation, one package at a time

**Goal:** every package with >0 SQL literals has all its SQL in a single `sql.go` file as named constants. Service functions reference the constants.

**Order** (cleanest-first, highest-leverage-first, sagas last):
1. `topology` (clean, post-tonight) — but this also includes the rename `orgdesign` → `topology` for Section-1 consistency. The package directory rename touches `main.go` and tests.
2. `auth` — single-DB, well-bounded, 21 SQL strings, foundational.
3. `users` — 15 SQL strings, single-DB.
4. `roles` — 10 SQL strings, single-DB.
5. `permissions` — 3 SQL strings, single-DB, foundational.
6. `addressables` — 21 SQL strings, single-DB.
7. `nav` — 53 SQL strings, single-DB.
8. `flows` — 30 SQL strings, single-DB.
9. `webhooks` — 11 SQL strings, single-DB.
10. `timeboxsprints` + `timeboxreleases` — small, single-DB.
11. `workspaces` — 18 SQL strings, 2 DBs.
12. `tenantsettings` — 4 SQL strings, 2 DBs.
13. `fields` — 5 SQL strings, 2 DBs.
14. `searchworker` — 7 SQL strings, 2 DBs.
15. `errorsreport` — 2 SQL strings, 3 DBs.
16. `libraryreleases` — 1 SQL string (rest delegated), 3 DBs.
17. `librarydb` — 15 SQL strings, 3 DBs (library access layer).
18. `portfolio` — 6 SQL strings, 2 DBs.
19. `artefactitemsv2` — 26 SQL strings, 1 DB (deferred name fix).
20. `portfoliomodels` — 51 SQL strings, 3 DBs. **Hardest. Last.**

**Per-package step shape (identical for all 20):**
1. Create `<pkg>/sql.go`.
2. Move every SQL string into `const ( ... )` block with `sqlVerbResource` naming.
3. Update service/handler functions to reference the constants.
4. Build clean.
5. Run existing tests.
6. Manual smoke: hit one route served by this package, confirm response.
7. Commit. Push.
8. Shrink `lint:sql-in-sqlfile-only` allow-list to remove this package.

**Stop gates:** after every package. The user confirms before the next package starts.

**Exit commit (per package):** `refactor: sql.go consolidation for <pkg> [PHASE-2.N]`

**No naming-convention fixes happen during Phase 2.** SQL moves only. Renames come in Phase 4.

### Phase 3 — Per-DB migration directories

**Goal:** `db/schema/` → `db/mmff_vector/schema/`, `db/artefacts_schema/` → `db/vector_artefacts/schema/`, `db/library_schema/` → `db/mmff_library/schema/`. Down-migrations move with them.

**Files touched:**
1. `git mv` the three directories.
2. `backend/cmd/migrate/main.go` — update paths.
3. `.claude/commands/c_db-backup.md` — update doc.
4. `dev/scripts/backup-on-push.sh` — update paths.
5. CI workflows + any tooling that walks `db/`.

**Stop gate:** verify `go run ./cmd/migrate -dry-run` finds zero pending migrations on each DB (i.e. the relocation didn't make any migration look "new" again).

**Exit commit:** `refactor: per-DB migration directories [PHASE-3]`

### Phase 4 — Naming-convention sweep, one rename at a time

**Goal:** apply §2 conventions to packages, tables, and routes. Each rename is a separate commit. Mechanical, reversible.

**Order** (lowest-risk first):

**4.1 — Package renames (Go import paths)**
- `orgdesign` → `topology` (done in Phase 2.1 already, listed for completeness).
- `artefactitemsv2` → `artefactitems`.
- `wsperms` → `workspacepermissions` (if package still exists; check first).
- `entityrefs` → `polymorphicrefs`.
- `dbcheck` → `dbinvariants`.
- `models` → `roletypes`.
- `messages` → `usermessages`.
- `tenantsettings` → `tenantmasterrecord`.
- `workspaces` → confirm whether to rename package OR table (recommend keeping package, renaming table back from `master_record_workspaces` to `workspaces`).

**4.2 — Table renames (per-DB, lowest-traffic first)**

> **Scope expansion (2026-05-14):** the column-prefix rule locked in §2.3 of [c_c_naming_conventions.md](c_c_naming_conventions.md) significantly enlarges Phase 4.2. The full canonical list of ~40 table renames + the new family-rooting (e.g. `permissions` → `users_permissions`, `roles` → `users_roles`, `flow_states` → `flows_states`) is maintained in [c_c_naming_conventions.md §2.8](c_c_naming_conventions.md#28--scheduled-renames-rf142). That doc is now authoritative for the table rename list; this section summarises only.

Each table rename needs: a migration with `ALTER TABLE ... RENAME TO ...`, paired DOWN, plus the `sql.go` constants in the owning package updated, plus comments. With Phase 2 done, the SQL update is ONE FILE per package.

Highlight renames (full list in conventions doc):
- `roles` → `users_roles`, `permissions` → `users_permissions`, `sessions` → `users_sessions` etc. (root by dominant parent — `users` owns the relationship).
- `flow_states` → `flows_states`, `flow_transitions` → `flows_transitions` etc. (pluralise root).
- `artefact_types` → `artefacts_types` etc. (pluralise root across the artefact family).
- `topology_view_state` → `topology_view_states` (pluralise leaf).
- `master_record_workspaces` → `workspaces` (customer-facing root family per §2.6).
- `portfolio_templates` → `library_portfolio_models` (rename + reroot under library_*).
- `audit_log` → `audit_logs`.

Legacy drops still scheduled: `workspace` (singular), `sprints` in mmff_vector, `subscription_portfolio_model_state`, adoption-mirror tables, remaining `obj_*` family.

**4.4 — Column renames (NEW — added 2026-05-14)**

The §2.3 column-prefix rule requires every column on every table to carry the table-name prefix:

- `users.email` → `users.users_email`
- `users.role_id` → `users.users_id_role` (FK function-then-modifier per §2.4)
- `topology_nodes.parent_id` → `topology_nodes.topology_nodes_id_parent`
- `artefacts.title` → `artefacts.artefacts_title`

Per [c_c_naming_conventions.md §2.9 "Trade-offs and known costs"](c_c_naming_conventions.md#29--trade-offs-and-known-costs): this affects every SQL query in `backend/internal/`. Mitigated by Phase 2 first (all SQL is then in one `sql.go` per package), making the rename mechanical per package.

Order: each package's column rename ships in lockstep with its table rename. One migration touches BOTH `RENAME TO <new_table>` and the per-column `RENAME COLUMN <old> TO <new>` statements. The owning package's `sql.go` is updated in the same commit.

This phase is the largest one in absolute LoC change. Per-package commits keep blast radius bounded.

**4.3 — Route renames (BFF + public, deliberate; coordinated with frontend)**

- `/workspace/{id}/fields` → `/workspaces/{id}/fields`.
- `/workspace/{id}/portfolio/layers` → `/workspaces/{id}/portfolio/layers`.
- `/portfolio` → `/portfolios`.
- `/nav/bookmark` → `/nav/bookmarks`.
- `/user/tab-order/{pageId}` → `/me/tab-order/{pageId}`.
- `/admin/api-keys/issue` (POST) → `POST /admin/api-keys`.
- `/admin/api-keys/revoke` (POST) → `DELETE /admin/api-keys/{id}`.
- `/flow-states/{id}` → `/flows/{flowId}/states/{id}` (and exit-rules nested).
- `/errors/report` → `POST /error-reports`.
- `/admin/dev/adoption-reset` → `/admin/dev/reset-adoption-state`.
- `/tenant-settings` → `/workspace-settings` (matches what the table actually keys by — verify first).

Each rename is one commit. Old route stays mounted with a 410 Gone or a 301 to the new path for one release cycle.

**Stop gates:** after every rename. User reviews and confirms.

### Phase 5 — Cross-DB writer hardening

**Goal:** the 5 high-risk cross-DB writers identified by the audit get explicit `crossdb_test.go` regression tests, transaction-bracket review, and partial-failure documentation.

The 5 writers:
1. `portfoliomodels.Orchestrator.Adopt` (3 DBs).
2. `portfoliomodels.DevResetHandler.MasterReset` (2 DBs).
3. `artefactitemsv2.Service.CreateWorkItem` (cross-DB read inside a write tx).
4. `libraryreleases.Handler.Ack` (validate L, write A; no shared tx).
5. `errorsreport.Handler.Report` (validate L, write A or V; no shared tx).

For each: write the partial-failure scenario as a comment, add the integration test, file a TD entry if the partial-failure case is actually a bug.

**Stop gate:** after each writer.

### Phase 6 — Documentation pass

**Goal:** `docs/c_c_db_routing.md` regenerated from code reality. `docs/c_schema.md` updated. `docs/c_c_naming_conventions.md` finalised. CLAUDE.md index reduced to one-line entries per the standing rule.

**Stop gate:** user reads the regenerated docs.

---

## §4 — What's deliberately deferred

Filed as register entries; not in scope of this plan:

- The bigger architectural question of whether the three-database split is paying back (separate decision, not a structural fix).
- Conversion from `sql.go` constants to `sqlc` or stored procedures (post-Phase-2 decision; Phase 2 makes either easy).
- Bug fixes in the touched code paths (those ship in separate commits, not this plan).
- Frontend reorganisation (not in scope; only frontend changes happen if a route or table renames demand them, and those are one-line import path changes).

---

## §5 — Drift-prevention final state (Phase 1 lints, made permanent)

After Phase 1 the repo has these gates running on every push:

1. `lint:sql-in-sqlfile-only` — no raw SQL outside `sql.go`.
2. `lint:no-empty-route-block` — no `r.Route(...)` with no handlers.
3. `lint:exemption-ratchet` — no `*_exempt.json` may grow.
4. `lint:deferral-needs-td-id` — deferrals reference `TD-*`.
5. `lint:package-naming-convention` — no orphan `*v2` packages.
6. `lint:cross-db-writer-test` (added end of Phase 5) — every cross-DB writer has a sibling crossdb test.
7. `lint:openapi-mirror-sync` — Scalar copy must match root spec.
8. CI workflow `tests.yml` running `npm test`, `npx tsc --noEmit`, `go test ./...`, `go vet ./...` on every push.

---

## §6 — How we know it's done

The plan is complete when a hypothetical engineer cloning the repo for the first time can:

1. Open `backend/internal/<any-package>/` and find `doc.go` + `service.go` + `handler.go` + `sql.go` + tests, in that order.
2. Read `docs/c_c_naming_conventions.md` once and predict every future name.
3. Run `go run ./cmd/migrate -dry-run` against each DB and see zero pending migrations.
4. Run `npm run api:check && npm test && go test ./...` and see zero failures.
5. Open `docs/c_c_db_routing.md` and find every service mapped to its DB and tables — and trust that it matches the code.

When all five hold, we are done.

---

## §7 — Rules of engagement (locked, do not deviate)

1. **No phase begins without explicit user confirmation.** Saying "go" once authorises the current step, not the next one.
2. **No naming improvisation.** Names come from §2 or from the conventions doc. If the conventions doc doesn't cover it, STOP and ask.
3. **Every commit is reversible.** If a phase step cannot be reverted with `git revert + DOWN migration`, it does not land.
4. **Stop gates are absolute.** Hitting a stop gate means: present what happened, await direction. No "while I'm waiting let me also..."
5. **Tests must pass after every step.** If they don't, the step is incomplete; do not commit.
6. **Cross-DB sagas (Phase 5) require partial-failure docs.** No exception.
7. **Any deviation files a TD entry first, then asks for direction.** Improvising without a register entry is what got us here.
