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

> **Scope note:** the rules below apply to the **Go package directory name** only. They do NOT apply to Go types, functions, variables, file names, SQL identifiers, or URL paths — each has its own conventions covered later in this doc. Go-side case rules (PascalCase for exported, camelCase for unexported) are enforced by Go tooling and not restated here.

1. **All lowercase, single concept token.** No camelCase, no PascalCase, no underscores, no hyphens. The package's directory name IS the package name. This is a Go-language constraint, not a stylistic choice: `gofmt`, `go vet`, and `staticcheck` flag any deviation. (The hierarchical chain rule used for SQL table names — §2.2 — does not apply to Go packages because Go forbids underscores in package names.)
2. **Version suffixes are allowed when "version" is a real distinction in the domain.** The suffix earns its place by carrying meaning a future reader cares about — a substrate transition, API-contract version, or compatibility break. Rule of thumb: if you can finish the sentence *"this is v2 of \_\_\_ because v1 was \_\_\_"* with a real architectural fact, keep the suffix. If the sentence is vague, drop it.
   - `artefactitemsv2` (keep) — the v2 marks the post-PLA-0023 artefact substrate; v1 was the deleted `obj_*` work-items pipeline. The version is meaningful even though the v1 directory no longer exists.
   - `flowsv2` would be wrong if it just means "the new file I started after a rewrite" with no architectural version concept behind it.
   - When a package carries a version suffix, its `doc.go` must explain what previous version it supersedes and why the suffix exists. "What was v1?" must have a documented answer.
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
2. **Plural for collections.** Almost every table is a collection of rows → name is plural. `users`, `topology_nodes`, `flow_states`, `artefacts`, `users_permissions`.
3. **Same family = same pluralisation.** Pick a family root (e.g. `topology_`), list all tables in that family, every tail follows the same plural rule. Don't mix `topology_view_state` (singular) with `topology_nodes` (plural).
4. **No version suffixes on tables.** A table is the table; if the schema migrates, the migration file does the work.
5. **No abbreviations.** `obj_custom_field_lib` is wrong (truncates `library`). `library`, `definitions`, `template` written in full.
6. **Timestamps end in `_at`, booleans start with `is_`/`has_`.** Combined with the column-prefix rule (§2.4) this gives: `users_created_at`, `users_is_active`, `users_email_is_verified`.

### §2.2 — Hierarchical table naming (root → leaf)

**The table name walks from the most general grouping down to the specific thing it represents, separated by underscores.** A DBA running `\dt users_*` sees the whole users family, then `\dt users_permissions_*` drills into permissions, then `\dt users_permissions_admin_*` drills further. The schema's directory tree is visible in the table names alone.

```
users                                  ← root entity
users_permissions                      ← permissions belonging to users
users_permissions_admin                ← admin-scope permissions
users_permissions_users                ← users-scope permissions
users_permissions_admin_pages          ← admin permissions for pages
users_permissions_admin_pages_help     ← admin permissions for page-help
```

Reading right-to-left answers "what?" — `help` (the leaf concept).
Reading left-to-right answers "where does it live?" — under `pages`, under `admin`, under `permissions`, owned by `users`.

#### Junction / multi-parent tables

For tables that join two entities, the **dominant parent (the entity that *owns* the relationship) is the root**, followed by feature(highest)_feature(subset). Concretely:

| Relationship | Root | Feature(highest) | Feature(subset) | Table |
|---|---|---|---|---|
| A role assigned to a user in a workspace | `users` | `roles` | `workspaces` | `users_roles_workspaces` |
| A grant of a topology role to a user on a node | `users` | `roles` | `topology_nodes` | `users_roles_topology_nodes` |
| Page-help record attached to a page addressable | `pages` | `help` | — | `pages_help` |
| API key issued by an admin | `admin` | `api_keys` | — | `admin_api_keys` |

Rule of thumb: ask "this thing belongs to ___" → the answer is the root.

### §2.3 — Column-name prefix rule (every column carries its table name)

**Every column on a table is prefixed with the full table name.** No bare `name`, `description`, `created_at`. Every column carries its provenance, which makes joins read without aliasing.

```
Table: users
  users_id                              ← PK
  users_email
  users_email_is_verified
  users_password_hash
  users_force_pwd_change
  users_created_at
  users_archived_at

Table: users_permissions
  users_permissions_id                  ← PK
  users_permissions_name
  users_permissions_description
  users_permissions_created_at

Table: artefacts
  artefacts_id                          ← PK
  artefacts_title
  artefacts_description
  artefacts_priority
  artefacts_created_at
```

Joins read clearly without aliasing:

```sql
SELECT users.users_email,
       users_permissions.users_permissions_name
  FROM users
  JOIN users_roles_workspaces ON users_roles_workspaces.users_roles_workspaces_id_user = users.users_id
  JOIN users_permissions      ON users_permissions.users_permissions_id = users_roles_workspaces.users_roles_workspaces_id_permission
```

No `u.email` vs `up.name` aliasing required. Every column self-identifies.

### §2.4 — Primary keys and foreign keys

The conventions for PKs and FKs differ — PK ends in `_id`, FK puts `_id_<target>` after the table prefix.

#### Primary keys → `<table>_id`

Every table's primary key column is `<table>_id`:

| Table | PK column |
|---|---|
| `users` | `users_id` |
| `users_permissions` | `users_permissions_id` |
| `topology_nodes` | `topology_nodes_id` |
| `users_roles_workspaces` | `users_roles_workspaces_id` |

This makes the PK self-identifying in any context. `SELECT users_id FROM users` is unambiguous; `SELECT id FROM users` is not.

#### Foreign keys → `<table>_id_<target>`

When a column on table A is an FK pointing at table B, the column reads **function-then-modifier** — the function is `_id` (it's an identifier), and the target is what kind of id it is. So the pattern is:

```
<table_name>_id_<target_table_singular>[_<semantic_role>]
```

Examples:

| Table | FK target | Column |
|---|---|---|
| `users` | their role | `users_id_role` |
| `users` | their subscription | `users_id_subscription` |
| `topology_nodes` | parent node | `topology_nodes_id_parent` |
| `topology_nodes` | workspace | `topology_nodes_id_workspace` |
| `artefacts` | flow state | `artefacts_id_flow_state` |
| `artefacts` | topology node | `artefacts_id_topology_node` |
| `users_roles_workspaces` | the user | `users_roles_workspaces_id_user` |
| `users_roles_workspaces` | the role | `users_roles_workspaces_id_role` |
| `users_roles_workspaces` | the workspace | `users_roles_workspaces_id_workspace` |

#### Multiple FKs to the same parent → role suffix

When a column is an FK whose semantic role matters (e.g. several FKs to `users` representing creator vs owner vs assignee), append the role after the target table:

```
<table_name>_id_<target_table_singular>_<semantic_role>
```

Examples:

| Table | FK | Role | Column |
|---|---|---|---|
| `artefacts` | `users` | owner | `artefacts_id_user_owner` |
| `artefacts` | `users` | creator | `artefacts_id_user_creator` |
| `artefacts` | `users` | assignee | `artefacts_id_user_assignee` |
| `topology_commits` | `users` | committer | `topology_commits_id_user_committer` |

Reads as: "this artefact's id-of-user-in-the-owner-role." Function (`id`) → which table (`user`) → which capacity (`owner`).

#### Polymorphic FKs

Polymorphic FKs use two columns: `_kind` + `_id_entity`:

```
page_addressables_id            ← PK
page_addressables_entity_kind   ← discriminator: 'workspace' | 'portfolio' | 'product'
page_addressables_entity_id     ← the polymorphic id (no FK constraint)
```

Polymorphic columns are an exception to the `_id_<target>` rule because there isn't a single target. See [`c_polymorphic_writes.md`](c_polymorphic_writes.md) for the writer contract.

#### Why PK and FK patterns disagree on the `_id` position

- PK puts `_id` at the **end** — `users_id` reads as "the users' id" (this row's identity).
- FK puts `_id` in the **middle** — `users_id_role` reads as "the users' id-of-role" (a pointer to a role).

The asymmetry is intentional: a PK is *this row's identity*, an FK is *a pointer to another row*. Reading the column name aloud should distinguish them.

### §2.5 — Constraints, indexes, triggers

Constraint and index names follow predictable patterns so a DBA can find them by guess:

- **Primary key** — `<table>_pkey` (Postgres default — `users_pkey` on column `users_id`).
- **Unique constraints** — `<table>_<columns>_unique`. Example: `topology_view_states_id_workspace_id_user_unique`.
- **Indexes** — `idx_<table>_<columns>` for general; `idx_<table>_<columns>_where_<condition>` for partial. Example: `idx_artefacts_id_workspace`, `idx_users_roles_workspaces_id_user_revoked_at_where_revoked_null`.
- **Foreign keys** — `<table>_<column>_fkey` (Postgres default). Cross-DB FKs are app-enforced — see [`c_polymorphic_writes.md`](c_polymorphic_writes.md).
- **Triggers** — `trg_<table>_<verb>_<purpose>`. Example: `trg_artefacts_after_insert_notify`.
- **Functions** — `<table>_<purpose>()`. Example: `artefacts_notify_rank_changed()`.

### §2.6 — Approved root families

Every table starts with one of these roots. Adding a new root requires a TD entry and a one-line addition to this table.

| Root | Meaning | Lives in | Examples |
|---|---|---|---|
| `users`, `users_*` | Users + everything owned by users (auth, permissions, roles, sessions, prefs) | `mmff_vector` | `users`, `users_sessions`, `users_password_resets`, `users_permissions`, `users_roles_workspaces`, `users_roles_topology_nodes`, `users_nav_profiles`, `users_tab_order`, `users_custom_pages` |
| `subscriptions`, `subscriptions_*` | Tenant root + tenant-scoped data | `mmff_vector` | `subscriptions`, `subscriptions_sequence` |
| `workspaces`, `workspaces_*` | Workspace anchor (the per-tenant scope unit) | `vector_artefacts` | `workspaces`, `workspaces_fields` (post-rename of `artefact_workspace_fields` — see §2.7) |
| `topology_*` | Org canvas | `vector_artefacts` | `topology_nodes`, `topology_view_states`, `topology_commits` |
| `flows`, `flows_*` | Workflow + state machine | `vector_artefacts` | `flows`, `flows_states`, `flows_transitions`, `flows_states_exit_rules` |
| `artefacts`, `artefacts_*` | Artefact substrate (work + strategy items + their fields) | `vector_artefacts` | `artefacts`, `artefacts_types`, `artefacts_types_fields`, `artefacts_fields_library`, `artefacts_fields_values`, `artefacts_number_sequences`, `artefacts_search_outbox` |
| `timeboxes_*` | Sprint + release scheduling | `vector_artefacts` | `timeboxes_sprints`, `timeboxes_releases` |
| `webhooks_*` | Event delivery | `vector_artefacts` | `webhooks_subscriptions`, `webhooks_deliveries` |
| `pages`, `pages_*` | Page registry + addressables + help | `mmff_vector` | `pages`, `pages_tags`, `pages_addressables`, `pages_help` |
| `library_*` | Library content (MMFF-authored templates, releases) | `mmff_library` | `library_releases`, `library_release_actions`, `library_release_logs`, `library_portfolio_models`, `library_portfolio_models_layers` |
| `errors_*` | Error catalogue + event log | `mmff_library` (codes) + `vector_artefacts` (events) | `errors_codes`, `errors_events` |
| `audit_logs` | Append-only audit trail | `vector_artefacts` (post-P1) | `audit_logs` |
| `master_record_*` | Single-row anchor with cross-DB soft FKs | `vector_artefacts` | `master_record_portfolios`, `master_record_tenants` |

### §2.7 — Forbidden patterns

**No new table may use any of these.** Existing tables that match are scheduled for rename in RF1.4.2.

- `obj_*` — legacy artefact prefix from pre-PLA-0023. Replaced by explicit `artefacts_*` / `topology_*` / etc.
- `o_*` — older still; renamed to `obj_*` in mig 123, now being phased out.
- Bare singular collections (`workspace`, `product`, singular `portfolio`).
- Bare columns without table prefix (every column on every table carries its table name — §2.3).
- `<column>_id` for FKs (must be `<table>_id_<target>` — §2.4).
- Underscores collapsed inappropriately — `workspace_id` is wrong as a column name in any table (right form depends on context: `workspaces_id` as the workspaces PK, or `<some_table>_id_workspace` as an FK).

### §2.8 — Scheduled renames (RF1.4.2)

Every table that doesn't conform to §2.1–2.7 is scheduled for rename. Listed here for traceability; rename migrations land in RF1.4.2 of PLA-0048.

**Table renames** (large set — the new convention forces more renames than the original plan accounted for):

| Current | Target | DB | Reason |
|---|---|---|---|
| `roles` | `users_roles` | `mmff_vector` | Roles belong to users; hierarchical root |
| `roles_workspaces` | `users_roles_workspaces` | `mmff_vector` | Dominant parent is users |
| `roles_org_nodes` / `topology_role_grants` | `users_roles_topology_nodes` | `vector_artefacts` | Single canonical name; dominant parent is users |
| `roles_pages` | `users_roles_pages` | `mmff_vector` | Dominant parent is users |
| `roles_permissions` | `users_roles_permissions` | `mmff_vector` | Junction; users root |
| `permissions` | `users_permissions` | `mmff_vector` | Permissions belong to users |
| `sessions` | `users_sessions` | `mmff_vector` | Sessions belong to users |
| `password_resets` | `users_password_resets` | `mmff_vector` | Password resets belong to users |
| `api_keys` | `admin_api_keys` | `mmff_vector` | API keys are admin-issued |
| `user_nav_profiles` | `users_nav_profiles` | `mmff_vector` | Pluralise root |
| `user_nav_prefs` | `users_nav_prefs` | `mmff_vector` | Pluralise root |
| `user_nav_groups` | `users_nav_groups` | `mmff_vector` | Pluralise root |
| `user_nav_profile_groups` | `users_nav_profile_groups` | `mmff_vector` | Pluralise root |
| `user_tab_order` | `users_tab_order` | `mmff_vector` | Pluralise root |
| `user_custom_pages` | `users_custom_pages` | `mmff_vector` | Pluralise root |
| `user_custom_page_views` | `users_custom_page_views` | `mmff_vector` | Pluralise root |
| `page_tags` | `pages_tags` | `mmff_vector` | Pluralise root |
| `page_addressables` | `pages_addressables` | `mmff_vector` | Pluralise root |
| `page_help` | `pages_help` | `mmff_vector` | Pluralise root |
| `subscription_sequence` | `subscriptions_sequence` | `mmff_vector` | Pluralise root |
| `subscription_item_type_icons` | `subscriptions_item_type_icons` | `mmff_vector` | Pluralise root |
| `subscription_portfolio_model_state` | (drop — superseded by `artefact_adoption_state`) | `mmff_vector` | Already on drop path |
| `entity_stakeholders` | `subscriptions_stakeholders` | `mmff_vector` | Already keyed by subscription_id; root is subscriptions |
| `master_record_portfolio` | `master_record_portfolios` | `vector_artefacts` | Pluralise |
| `master_record_tenant` | `master_record_tenants` | `vector_artefacts` | Pluralise |
| `master_record_workspaces` | `workspaces` | `vector_artefacts` | Customer-facing noun (PLA-0048 §2.6 root family) |
| `topology_view_state` | `topology_view_states` | `vector_artefacts` | Pluralise |
| `topology_role_grants` | (drop — merged into `users_roles_topology_nodes` above) | `vector_artefacts` | Single canonical |
| `audit_log` | `audit_logs` | `vector_artefacts` | Pluralise |
| `artefact_types` | `artefacts_types` | `vector_artefacts` | Pluralise root |
| `artefact_type_fields` | `artefacts_types_fields` | `vector_artefacts` | Pluralise root |
| `artefact_field_library` | `artefacts_fields_library` | `vector_artefacts` | Pluralise root |
| `artefact_workspace_fields` | `workspaces_fields` | `vector_artefacts` | Root is workspaces (the workspace owns its admitted-field set) |
| `artefact_field_values` | `artefacts_fields_values` | `vector_artefacts` | Pluralise root |
| `artefact_number_sequence` | `artefacts_number_sequences` | `vector_artefacts` | Pluralise both ends |
| `artefacts_search_outbox` | `artefacts_search_outbox` | `vector_artefacts` | Already correct under new rule |
| `artefact_adoption_state` | `artefacts_adoption_states` | `vector_artefacts` | Pluralise both ends |
| `flow_states` | `flows_states` | `vector_artefacts` | Pluralise root |
| `flow_transitions` | `flows_transitions` | `vector_artefacts` | Pluralise root |
| `flow_state_exit_rules` | `flows_states_exit_rules` | `vector_artefacts` | Hierarchical chain |
| `flow_defaults` | `flows_defaults` | `vector_artefacts` | Pluralise root |
| `flow_state_defaults` | `flows_states_defaults` | `vector_artefacts` | Hierarchical chain |
| `flow_transition_defaults` | `flows_transitions_defaults` | `vector_artefacts` | Hierarchical chain |
| `timebox_sprints` | `timeboxes_sprints` | `vector_artefacts` | Pluralise root |
| `timebox_releases` | `timeboxes_releases` | `vector_artefacts` | Pluralise root |
| `webhook_subscriptions` | `webhooks_subscriptions` | `vector_artefacts` | Pluralise root |
| `webhook_deliveries` | `webhooks_deliveries` | `vector_artefacts` | Pluralise root |
| `library_acknowledgements` | `library_releases_acknowledgements` | `vector_artefacts` | Hierarchical: acks belong to releases |
| `library_release_log` | `library_release_logs` | `mmff_library` | Pluralise |
| `library_release_actions` | `library_releases_actions` | `mmff_library` | Pluralise root |
| `portfolio_templates` | `library_portfolio_models` | `mmff_library` | Rename + reroot (under library_*); aligns with public route `/portfolio-models` |
| `portfolio_template_layer_definitions` | `library_portfolio_models_layers` | `mmff_library` | Rename + reroot + drop filler "definitions" |
| `error_codes` | `errors_codes` | `mmff_library` | Pluralise root |
| `error_events` | `errors_events` | `vector_artefacts` | Pluralise root |
| `library_help_defaults` | `library_help_defaults` | `mmff_vector` | Already correct (note: `library_help_defaults` lives in mmff_vector, not mmff_library — see §2.6) |

**Column renames** (every column on every renamed table also gains the table-prefix). Scope is large; see RF1.4.4.

**Scheduled drops:**

| Table | DB | Why |
|---|---|---|
| `workspace` (singular) | `mmff_vector` | Legacy stack-layer entity; last reader migrated. |
| `sprints` (mmff_vector) | `mmff_vector` | Superseded by `timeboxes_sprints` in vector_artefacts. |
| `subscription_portfolio_model_state` | `mmff_vector` | Superseded by `artefacts_adoption_states` (already on drop path). |
| `subscription_workflows` / `subscription_workflow_transitions` / `subscription_layers` / `subscription_artifacts` / `subscription_terminology` | `mmff_vector` | Adoption-mirror tables on drop path. |
| Remaining `obj_*` family | `mmff_vector` | As last readers migrate. |
| `topology_role_grants` | `vector_artefacts` | Merged into `users_roles_topology_nodes` (single canonical). |

### §2.9 — Trade-offs and known costs

**The column-prefix rule has real cost.** Every existing query in `backend/internal/` that references a bare column name (`SELECT email FROM users`, `WHERE workspace_id = $1`, etc.) needs updating. Audit estimate: 461 SQL strings across the codebase will need rewriting; many touch multiple columns.

**Mitigating factors:**

1. Phase 2 (`sql.go` consolidation) lands BEFORE Phase 4. By the time column renames hit, all SQL lives in one file per package, so the rename is mechanical find-and-replace per package, not grep-across-codebase.
2. Postgres `ALTER TABLE ... RENAME COLUMN ...` is cheap and atomic. The schema rename costs ~1 second per column; the cost is in updating the Go code.
3. Joins read DRAMATICALLY better. Every existing `SELECT u.email, p.title FROM users u JOIN profiles p` pattern becomes `SELECT users_email, users_profiles_title FROM users JOIN users_profiles` — no aliasing, no cross-team "which u is this" debugging.

**Acknowledged downside:** column names get long. `users_roles_workspaces_id_user` is 27 characters. For very long table chains the column names will exceed 40-50 characters. This is a deliberate trade — readability beats brevity at every query site.

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
