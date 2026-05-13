# Naming Conventions — Canonical Spec

**Status:** Locked. PLA-0048 / RF1.0. Authoritative source for every name in the codebase. Any deviation requires a `TD-*` register entry in [`c_tech_debt.md`](c_tech_debt.md) before merging.

**Read this before:** creating a new Go package, table, column, route, migration, or `.go` file inside `backend/internal/`.

**When this doc disagrees with code:** the doc wins. Open a rename TD entry.

---

## Why this exists

Three weeks of architectural drift across a multi-session AI build produced 42 backend packages with inconsistent naming, 461 inline SQL strings spread across 56 files, tables with stale `obj_*`/`o_*` prefixes, singular/plural mismatches across same-family tables and routes, and one Go package (`artefactitemsv2`) carrying a meaningless version suffix. The master plan that fixes it is [`c_c_the_state_of_the_codebase.md`](c_c_the_state_of_the_codebase.md). **This doc is the conventions half of that plan, extracted so it can be referenced standalone.**

A future engineer or DBA cloning this repo should be able to read this one page and predict every file, table, column, route, and import path in the system. If they cannot, the doc is wrong — fix it.

---

## §1 — Go packages

### §1.1 — Package naming rules

1. **All lowercase, single concept word.** No camelCase, no PascalCase, no underscores. The package's directory name IS the package name.
2. **No version suffixes** unless a coexisting peer version exists in the same tree.
   - `artefactitems` (correct) — there's only one version.
   - `artefactitemsv2` (wrong) — the suffix implies a v1 that does not exist.
   - `flowsv2` would only be correct if `flows` (v1) still existed alongside it.
3. **Match the canonical noun of the domain.** The package name must equal either:
   - the table family it owns — e.g. `flows` owns `flows`, `flow_states`, `flow_transitions`; or
   - the customer-visible concept it serves — e.g. `auth` (login flow), `topology` (org canvas).
4. **No insider abbreviations.** If a fresh engineer would have to ask "what does `wsperms` mean?" the name is wrong.
   - Wrong → Right:
     - `wsperms` → `workspacepermissions`
     - `entityrefs` → `polymorphicrefs`
     - `dbcheck` → `dbinvariants`
     - `tenantsettings` → `tenantmasterrecord` (if the package writes `master_record_tenant`)
5. **No filler nouns.** A package called `manager`, `helper`, `util`, `common` is banned. Either name the domain or split the work.
6. **Compound nouns are joined, no separator.** `customPages` is wrong; `custompages` is right.

### §1.2 — Package directory layout

Every package directory under `backend/internal/<pkg>/` contains, in this order:

```
backend/internal/<pkg>/
  doc.go                 ← package-level doc comment only, no code
  service.go             ← business logic; references sql.go constants; NO raw SQL
  handler.go             ← HTTP layer; parses + renders; calls service; NO DB
  sql.go                 ← ★ every SQL string for this package as named constants
  types.go               ← exported DTOs + sentinel errors
  *_test.go              ← unit + integration tests
  crossdb_test.go        ← REQUIRED if this package uses >1 database pool
```

Rules:
- **`doc.go`** holds only a `package <name>` declaration and a Go doc comment. No imports beyond the doc. One doc per package.
- **`service.go`** may grow into `service_<area>.go` if the file exceeds ~600 LoC. Splits are by feature area, not by SQL operation.
- **`handler.go`** may split the same way (`handler_<route_group>.go`).
- **`sql.go`** is a single file per package — see §1.3.
- **`types.go`** is optional if the package has zero exported types beyond its handlers.
- **`*_test.go`** mirrors the source file name (`service_test.go`, `handler_test.go`).
- **`crossdb_test.go`** is mandatory for packages whose service references more than one `*pgxpool.Pool` field. Asserts the cross-DB read/write boundary's partial-failure behaviour.

### §1.3 — `sql.go` rules

**Every SQL string literal in a package lives in `sql.go`. No exceptions inside `service.go`, `handler.go`, or any sub-file.**

Format:

```go
// Package <name> SQL constants.
//
// Naming: sqlVerbResource — e.g. sqlSelectCommitStatus, sqlUpsertCommit.
// One constant per query. Multi-line queries use backtick strings.
// CTEs and dynamic WHERE-builders count: their literal text lives here.
package <name>

const (
    sqlSelectCommitStatus = `
        SELECT committed_at, committed_by
          FROM topology_commits
         WHERE subscription_id = $1
    `

    sqlUpsertCommit = `
        INSERT INTO topology_commits (subscription_id, committed_at, committed_by)
        VALUES ($1, NOW(), $2)
        ON CONFLICT (subscription_id) DO UPDATE
           SET committed_at = EXCLUDED.committed_at,
               committed_by = EXCLUDED.committed_by,
               updated_at   = NOW()
    `
)
```

Constant naming:
- **`sql<Verb><Resource>`** — `sqlSelectCommitStatus`, `sqlInsertWorkItem`, `sqlDeleteFlowState`.
- Verb is the dominant SQL action: `Select`, `Insert`, `Update`, `Delete`, `Upsert`, `Count`.
- Resource is the table or domain entity (singular when the query operates on one row, plural for list/aggregate queries).
- For grouped queries against the same resource, append a qualifier: `sqlSelectFlowStatesByFlow`, `sqlSelectFlowStatesByKind`.
- For complex CTE-heavy queries, use a descriptive name: `sqlDescendantNodeIDs`, `sqlDirtySinceCommit`.

What lives in `sql.go`:
- Every `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `WITH` literal.
- Every dynamic query fragment used by a query builder (the fragment is the constant; the builder concatenates constants).
- `pgx.LISTEN` channel names if used as SQL.

What does NOT live in `sql.go`:
- Migrations (those live in `db/<dbname>/schema/`).
- Connection strings or DSN templates.
- Procedural Go calling pgx (`pool.QueryRow`, `pool.Exec`) — that stays in `service.go`; the **strings** move to `sql.go`, the calls stay where they are.

Enforcement: `lint:sql-in-sqlfile-only` (RF1.1.1) — ripgrep for `SELECT |INSERT INTO |UPDATE [a-z_]+ SET |DELETE FROM ` inside non-`sql.go` `.go` files under `backend/internal/*/`. Fails on any hit not on the package-by-package allow-list (which shrinks one package per RF1.2 commit).

---

## §2 — Database tables

### §2.1 — General rules

1. **Snake_case throughout.** No camelCase, no kebab-case, no PascalCase. `topology_nodes`, not `topologyNodes`.
2. **Plural for collections, singular only for single-row-per-tenant anchors.**
   - Collections (most tables): `users`, `roles`, `topology_nodes`, `flow_states`, `artefacts`.
   - Single-row-per-tenant anchors: tail is singular, but the `master_record_` prefix marks them — see §2.3.
3. **Same family = same pluralisation.** If `topology_nodes` is plural, then `topology_view_state` is wrong and must be `topology_view_states`. Audit-time check: pick a family prefix, list all tables in that family, every tail is plural OR every tail is singular — never mixed.
4. **No version suffixes on tables.** A table is the table; if a schema migrates, the migration file does the work.
5. **Column names also snake_case.** Foreign-key columns use `<referenced_table_singular>_id` — e.g. `subscription_id`, `workspace_id`, `user_id`. Polymorphic columns use `entity_kind` + `entity_id` together.
6. **Timestamps end in `_at`, booleans usually start with `is_`/`has_`.** `created_at`, `updated_at`, `archived_at`, `is_active`, `is_pullable`, `has_children`.
7. **No abbreviations.** `obj_custom_field_lib` is wrong (truncates `library`). `library`, `definitions`, `template` written in full.

### §2.2 — Approved prefix families

Every prefix carries a specific meaning. Adding a new prefix family requires a TD entry and a one-line addition to this table.

| Prefix | Meaning | Lives in | Examples |
|---|---|---|---|
| `users`, `roles`, `roles_<scope>`, `permissions`, `sessions`, `password_resets`, `api_keys` | Auth substrate | `mmff_vector` | `users`, `roles`, `roles_workspaces`, `roles_org_nodes`, `roles_pages`, `roles_permissions` |
| `subscriptions`, `subscription_*` | Tenant root + tenant-scoped data | `mmff_vector` | `subscriptions`, `subscriptions_sequence` (per §2.5 rename) |
| `user_*` | Per-user state | `mmff_vector` | `user_nav_profiles`, `user_tab_order`, `user_custom_pages` |
| `master_record_*` | Single-row anchor with cross-DB soft FKs | `vector_artefacts` | `master_record_workspaces` → `workspaces` after RF1.4.2.10; `master_record_portfolio` → `master_record_portfolios` after RF1.4.2.5 |
| `topology_*` | Org canvas | `vector_artefacts` | `topology_nodes`, `topology_role_grants`, `topology_view_states`, `topology_commits` |
| `flows`, `flow_*` | Workflow + state machine | `vector_artefacts` | `flows`, `flow_states`, `flow_transitions`, `flow_state_exit_rules` |
| `artefact_*`, `artefacts` | Artefact substrate (work + strategy items + their fields) | `vector_artefacts` | `artefacts`, `artefact_types`, `artefact_type_fields`, `artefact_field_library`, `artefact_workspace_fields`, `artefact_field_values`, `artefact_number_sequences` (per §2.5 rename) |
| `timebox_*` | Sprint + release scheduling | `vector_artefacts` | `timebox_sprints`, `timebox_releases` |
| `webhook_*` | Event delivery | `vector_artefacts` | `webhook_subscriptions`, `webhook_deliveries` |
| `library_*`, `portfolio_template_*` | Library content (MMFF-authored templates) | `mmff_library` | `library_releases`, `library_release_actions`, `library_release_logs`, `portfolio_templates`, `portfolio_template_layers` |
| `error_codes`, `error_events` | Cross-DB error catalogue (read from library, write to artefacts) | `mmff_library` (codes) + `vector_artefacts` (events) | `error_codes`, `error_events` |
| `page_*`, `pages`, `nav_*` | Page registry + navigation | `mmff_vector` | `pages`, `page_tags`, `page_addressables`, `page_help` |
| `audit_logs` | Append-only audit trail | `vector_artefacts` (post-P1) | `audit_logs` (per §2.5 rename) |

### §2.3 — Forbidden prefixes

These prefixes are legacy. **No new table may use them.** Existing tables carrying them are scheduled for rename or drop in RF1.4.2.

- `obj_*` — legacy artefact prefix from the pre-PLA-0023 era. Replaced by the explicit `artefact_*` / `topology_*` / domain-specific prefixes.
- `o_*` — older still; the `o_*` family was renamed to `obj_*` in migration 123, and `obj_*` is being phased out.
- Bare singular collection names (`workspace`, `product`, `portfolio` as singular tables) — these are pre-renaming legacy. Either rename to plural or drop.

### §2.4 — Constraints, indexes, triggers

Constraint and index names follow predictable patterns so a DBA can find them by guess:

- **Primary keys** — `<table>_pkey` (Postgres default). Don't override.
- **Unique constraints** — `<table>_<columns>_unique`. Example: `topology_view_state_workspace_user_unique`.
- **Indexes** — `idx_<table>_<columns>` for general indexes; `idx_<table>_<columns>_where_<condition>` if it's a partial index. Example: `idx_artefact_workspace_fields_workspace`, `idx_topology_role_grants_user_node_where_revoked_null`.
- **Foreign keys** — `<table>_<column>_fkey` (Postgres default). Don't override unless cross-DB (cross-DB FKs are app-enforced — see [`c_polymorphic_writes.md`](c_polymorphic_writes.md)).
- **Triggers** — `trg_<table>_<verb>_<purpose>`. Example: `trg_artefacts_after_insert_notify`.
- **Functions** — `<table>_<purpose>()`. Example: `notify_rank_changed()`.

### §2.5 — Scheduled renames (RF1.4.2)

These tables exist today but do not conform. Listed here for traceability; the rename migrations land in RF1.4.2.

| Current | Target | DB | Reason |
|---|---|---|---|
| `topology_view_state` | `topology_view_states` | `vector_artefacts` | Plural-family consistency |
| `audit_log` | `audit_logs` | `vector_artefacts` | Plural-family consistency |
| `artefacts_search_outbox` | `artefact_search_outbox` | `vector_artefacts` | Prefix consistency (sibling tables use singular `artefact_` prefix) |
| `artefact_number_sequence` | `artefact_number_sequences` | `vector_artefacts` | Plural-family consistency |
| `master_record_portfolio` | `master_record_portfolios` | `vector_artefacts` | Plural-family consistency |
| `master_record_tenant` | `master_record_tenants` | `vector_artefacts` | Plural-family consistency |
| `library_release_log` | `library_release_logs` | `mmff_library` | Plural-family consistency |
| `portfolio_template_layer_definitions` | `portfolio_template_layers` | `mmff_library` | "definitions" is filler — table IS the definition |
| `portfolio_templates` | `portfolio_models` | `mmff_library` | Align with public route `/portfolio-models` + package `portfoliomodels` |
| `master_record_workspaces` | `workspaces` | `vector_artefacts` | Customer noun is "workspaces"; legacy singular `workspace` table dropped separately |
| `subscription_sequence` | `subscriptions_sequence` | `mmff_vector` | Match parent table plural |

Scheduled drops (RF1.4.2):

| Table | DB | Why |
|---|---|---|
| `workspace` (singular) | `mmff_vector` | Legacy stack-layer entity, distinct from `master_record_workspaces`; last reader migrated |
| `sprints` (mmff_vector) | `mmff_vector` | Superseded by `vector_artefacts.timebox_sprints` |
| Remaining `obj_*` family | `mmff_vector` | As last readers migrate to `vector_artefacts` artefact substrate |

---

## §3 — HTTP routes

### §3.1 — General rules

1. **Always plural for collections.** `/workspaces/{id}`, not `/workspace/{id}`. `/portfolios`, not `/portfolio`.
2. **REST-canonical verbs.**
   - `POST /resources` to create — not `POST /resources/create` or `POST /resources/issue`.
   - `PATCH /resources/{id}` to update fields — not `POST /resources/{id}/update`.
   - `DELETE /resources/{id}` to delete or revoke — not `POST /resources/{id}/revoke`.
   - `GET /resources/{id}` to read one.
   - `GET /resources` to list (with `?skip=`, `?limit=`, `?sort=`, `?dir=` query params).
3. **Nested routes follow the resource hierarchy.** A flow's state is `/flows/{flowId}/states/{id}`, not `/flow-states/{id}`. An exit rule on a state is `/flows/{flowId}/states/{stateId}/exit-rules/{id}`.
4. **Internal naming concepts do not appear in routes.** Routes are customer/UI-facing. `master_record_*` is internal — routes say `/portfolios`, `/workspaces`, not `/master-record-portfolios`.
5. **One canonical noun per concept.** If the package is `portfoliomodels`, the route is `/portfolio-models`, and the table should be `portfolio_models`. All three must agree.
6. **Hyphenated for multi-word path segments.** `/portfolio-models`, `/api-keys`, `/error-reports`. Snake_case is for SQL, hyphen-case is for URLs.

### §3.2 — Route prefixes (transport segregation, PLA-0039)

The backend has two HTTP transports. They MUST stay separated.

| Prefix | Purpose | Auth | Audit transport |
|---|---|---|---|
| `/_site/` | BFF for the Vector web app (internal frontend) | JWT only | `source_transport='site'` |
| `/samantha/v2/` | Public API for customers, integrations, n8n | JWT OR API key | `source_transport='public'` |

Same handler may serve both surfaces, but the public surface goes through a `MapPublic*` DTO mapper (no internal `models.*` leaks to JSON). See [`c_c_transport_segregation.md`](c_c_transport_segregation.md).

Root-level routes (unversioned, no prefix): `/healthz`, `/env`, `/status/pipeline`, `/ws`, `/env/switch`. These are infra, not part of either transport.

### §3.3 — Scheduled route renames (RF1.4.3)

| Current | Target | Reason |
|---|---|---|
| `GET /workspace/{id}/fields` | `GET /workspaces/{id}/fields` | Plural collection |
| `GET/PATCH /workspace/{id}/portfolio/layers/batch` | `/workspaces/{id}/portfolio/layers/batch` | Plural |
| `/portfolio` (mount) | `/portfolios` | Plural |
| `POST /nav/bookmark` / `DELETE /nav/bookmark` | `POST /nav/bookmarks` / `DELETE /nav/bookmarks/{id}` | Plural, REST-canonical |
| `GET/PUT/DELETE /user/tab-order/{pageId}` | `GET/PUT/DELETE /me/tab-order/{pageId}` | Per-user resources live under `/me` |
| `POST /admin/api-keys/issue` | `POST /admin/api-keys` | REST-canonical create |
| `POST /admin/api-keys/revoke` | `DELETE /admin/api-keys/{id}` | REST-canonical delete |
| `PATCH /flow-states/{id}` etc. | `PATCH /flows/{flowId}/states/{id}` | Nested resource |
| `POST /errors/report` | `POST /error-reports` | Noun, not verb |
| `POST /admin/dev/adoption-reset` | `POST /admin/dev/reset-adoption-state` | Match neighbour `master-reset` verb-noun order |
| `/tenant-settings` | `/workspace-settings` | The settings key per workspace, not per tenant (verify before renaming) |

Cutover rule for `/samantha/v2/*` renames (public API breaking change): the old route stays mounted for one release cycle returning HTTP 410 Gone with a `Link: <new-url>; rel="successor"` header, OR a 301 redirect. `/_site/*` renames cut over immediately (frontend updates in same commit).

---

## §4 — Migrations

### §4.1 — Directory layout

Migrations live under `db/<dbname>/schema/`, one directory per database:

```
db/
  mmff_vector/
    schema/
      0001_<descriptive_name>.sql
      0002_<descriptive_name>.sql
      ...
      down/
        0001_<descriptive_name>.down.sql
        0002_<descriptive_name>.down.sql
        ...
    seed/
      0001_<descriptive_name>.sql       ← idempotent seed scripts
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
```

Rules:
- **Numeric prefix, 4-digit zero-padded.** `0001_`, `0042_`, `0180_`. (Existing pre-RF1 migrations keep their 3-digit numbers; new migrations from RF1.3 onward use 4 digits — or simply continue the existing numbering scheme without padding gain. The migration runner does not care about padding; it sorts lexically. **Decision pending RF1.3:** keep existing numbering scheme rather than re-pad. This doc to be updated at end of RF1.3.)
- **Descriptive name in snake_case.** `0180_drop_subscription_topology_committed_columns.sql`, `0053_topology_commits.sql`.
- **Every UP has a paired DOWN.** Same number, same descriptive name, `.down.sql` (or `_DOWN.sql` per existing convention — to be normalised in RF1.3).
- **No migration may be edited after merge.** A mistake is fixed by a new migration. The schema_migrations table is append-only.

### §4.2 — Migration file header

Every migration file starts with a header block:

```sql
-- ============================================================
-- MMFFDev - <dbname>: <short_title>
-- Migration <NNNN> — <one-line description>
-- Run against <dbname>:
--   psql -U mmff_dev -d <dbname> -f <NNNN>_<name>.sql
--
-- <multi-line description: what does this do, why, what does it depend on>
--
-- Backfill: <none | description of data migration steps>
-- Sole writer (post-migration): backend/internal/<package>/sql.go
-- ============================================================

BEGIN;

<DDL>

COMMIT;
```

Rules:
- **Always wrapped in `BEGIN; ... COMMIT;`.** Even if Postgres would auto-transact, explicit is the contract.
- **`IF EXISTS` / `IF NOT EXISTS` on every `CREATE` and `DROP`.** Migrations must be idempotent at the boundary.
- **No `obj_*` or `o_*` new tables.** Forbidden by §2.3.

### §4.3 — Seed scripts

Seed scripts live in `db/<dbname>/seed/` and are idempotent (`ON CONFLICT DO NOTHING` or `WHERE NOT EXISTS`). They are NOT run by the migration runner; they're run explicitly via `psql -f` from a script.

---

## §5 — Lint enforcement

These lints (added in RF1.1) make this doc executable, not aspirational. Each lint maps to a rule above.

| Lint | Enforces | Rule it backs |
|---|---|---|
| `lint:sql-in-sqlfile-only` | No raw SQL outside `sql.go` | §1.2, §1.3 |
| `lint:no-empty-route-block` | No `r.Route(...)` with zero verbs | §3 (catches dead handler scaffolding) |
| `lint:exemption-ratchet` | `*_exempt.json` cannot grow | All — prevents convention bypass via ledger-stuffing |
| `lint:deferral-needs-td-id` | Deferral commit messages need a `TD-*` | All — deferrals must hit the register |
| `lint:package-naming-convention` | No orphan `*v\d+` packages | §1.1.2 |
| `lint:cross-db-writer-test` (RF1.5) | Cross-DB writers need a sibling `_crossdb_test.go` | §1.2 (crossdb_test.go requirement) |

---

## §6 — Conflict resolution

If two rules in this doc disagree, file a TD entry and ask. Do not improvise.

If a name is unclear after reading this doc, file a TD entry and ask. Do not improvise.

If the doc says one thing and the code says another, the doc wins. Open a TD entry to bring the code into line.

**Improvisation is what got us here.** This doc is the contract that ends it.
