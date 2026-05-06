# Database schema — golden source

> Last verified live: 2026-04-25 against `mmff_vector`. Doc patched 2026-05-07 to reflect Phase 1+2 schema cleanup (migrations 122–123) — see "Phase 1+2 cleanup" callout below. Detailed column tables for unrenamed objects retain their 2026-04-25 verification; renamed/dropped tables are flagged inline. Re-snapshot pending — when you do, regenerate via the SQL at the bottom of this file.
>
> **Phase 4 / vector_artefacts cutover** — the `obj_*` family in this doc is the *current production* substrate. A separate PoC schema (`vector_artefacts` DB) is being prepared as the cutover target; production migration plan lives in [`c_c_vector_artefacts_backfill.md`](c_c_vector_artefacts_backfill.md). When that lands, this doc must be re-snapshotted in full.

This is the canonical map of every table in `mmff_vector`. Read here first instead of running blind `\d` queries — every column, FK, and delete rule below was dumped from the live DB.

## Phase 1+2 cleanup (migrations 122–123) — 2026-05-07

**Migration 122 dropped 11 orphan tables** (CASCADE; zero callers verified prior):
`o_artefact_note_reads`, `o_artefact_notes`, `o_artefact_versions`,
`o_artefacts_execution_epics`, `o_artefacts_execution_epics_field_values`,
`item_field_definitions`, `item_field_options`, `item_field_values`, `item_labels`, `item_tags`,
`pending_library_cleanup_jobs`.

**Migration 123 renamed 13 live tables to the `obj_*` family** (catalog-only; zero rows rewritten):

| Old name | New name |
|---|---|
| `o_artefacts_execution_work_items` | `obj_work_items` |
| `o_artefacts_execution_work_items_field_values` | `obj_work_items_field_values` |
| `o_execution_work_item_templates` | `obj_field_templates` |
| `o_execution_work_item_template_fields` | `obj_field_template_fields` |
| `o_execution_custom_field_library` | `obj_custom_field_lib` |
| `o_artefact_types_system` | `obj_execution_types` |
| `o_artefact_types_tenant` | `obj_execution_types_tenant` |
| `o_artefact_types_overrides` | `obj_execution_types_overrides` |
| `portfolio_item_types` | `obj_strategy_types` |
| `portfolio_items` | `obj_portfolio_items` |
| `subscription_layers` | `obj_strategy_types_layers` |
| `o_flow_system` | `obj_flow_system` |
| `o_flow_tenant` | `obj_flow_tenant` |

**Migration 124 dropped 6 more legacy tables** (verified empty in dev 2026-05-07): `o_artefacts_execution_test_cases`, `o_artefacts_execution_test_cases_field_values`, `o_artefacts_execution_defects_field_values`, `o_artefacts_execution_tasks_field_values`, `o_artefacts_strategic`, `o_artefacts_strategic_field_values`.

**Migration 125 dropped the last 2** (`o_artefacts_execution_defects`, `o_artefacts_execution_tasks`) — the 6 rows they held were dummy payload superseded by the canonical `obj_work_items` seed in `db/seed/002_work_items_poc.sql`. The whole legacy per-type artefact family is retired.

Still live (intentionally): `o_search_index_outbox` (active worker queue), `o_artefact_visibility_levels` (FK target), `canonical_states` (FK target of `obj_flow_*`).

> **`mmff_library` (second database)** — Phase 1 created the read-only library DB on the same Postgres cluster: `portfolio_models` spine + 6 bundle children + `portfolio_model_shares` + four roles (`mmff_library_admin`/`_ro`/`_publish`/`_ack`) + grant matrix. Schema files live at `db/library_schema/NNN_*.sql`; the MMFF seed bundle is at `db/library_schema/seed/001_mmff_model.sql`. CI canary: `backend/internal/librarydb/grants_test.go` enforces the role/table grant matrix. Connection pools: `backend/internal/librarydb/db.go` (3 pools — RO, Publish, Ack). **Phase 2** added the bundle fetcher (`bundle.go`/`fetch.go`) — see [`c_c_librarydb_fetch.md`](c_c_librarydb_fetch.md). **Phase 3** added the release-notification channel: 3 tables in `mmff_library` (`library_releases`, `library_release_actions`, `library_release_log`) + 1 table in `mmff_vector` (`library_acknowledgements`) + grants extension (`006_grants_release_channel.sql`) + page-registry row (vector migration `022_library_releases_page.sql`) — see [`c_c_library_release_channel.md`](c_c_library_release_channel.md). **Phase-4 prep** added `error_codes` (read-only catalogue: `code` PK, `severity` IN (`info`,`warning`,`error`,`critical`), `category` IN (`adoption`,`library`,`auth`,`validation`), `user_message`, `dev_message`) seeded with six adoption codes; admin=ALL, ro/publish/ack=SELECT — file `db/library_schema/008_error_codes.sql`. Plan: `dev/planning/feature_library_db_and_portfolio_presets_v3.md`.

If you find drift, re-run the snapshot at the bottom of this file and update.

## Engine

- **Postgres 16** in Docker container `mmff-ops-postgres` on `mmffdev.com`.
- **Database:** `mmff_vector`.
- **App role:** `mmff_dev`. Password in `backend/.env.dev` (`DB_PASSWORD`).
- **Local access:** SSH tunnel `localhost:5435` → server `:5432` (dev env; see active marker in [`/.claude/CLAUDE.md`](../.claude/CLAUDE.md)). See [c_postgresql.md](c_postgresql.md).
- **Schema migrations:** `db/schema/NNN_*.sql`, applied in number order. Each file wraps its DDL in `BEGIN; … COMMIT;`.

## Invariants that span tables

These rules are the contract; every query/handler/migration honours them.

1. **Subscription isolation by row.** Every business table carries `subscription_id UUID NOT NULL REFERENCES subscriptions(id)`. Every read path MUST filter by the session's subscription. A query that forgets `WHERE subscription_id = $1` is a data leak. (Renamed from `tenant_id`/`tenants` in migration 017; the JWT layer dual-accepts the old `tenant_id` claim for one release.)
2. **Soft-archive only.** Business rows expose `archived_at TIMESTAMPTZ` and are never hard-deleted (SoW §7 audit-trail requirement). `WHERE archived_at IS NULL` is the live-row predicate; partial indexes (`… WHERE archived_at IS NULL`) accelerate it.
3. **UUIDs are the identity.** Primary keys are `UUID DEFAULT gen_random_uuid()` (`pgcrypto`). Human-readable references (`US-00000347`) are rendered at display time from `key_num` + the current tag on `*_item_types`; they are NOT stored on work items.
4. **Per-subscription key counters.** `subscription_sequence(subscription_id, scope)` hands out monotonic `key_num` values. Gaps are permitted (archived numbers never reused). Lock pattern: `SELECT next_num … FOR UPDATE; UPDATE … SET next_num = next_num + 1`.
5. **`updated_at` is trigger-maintained.** Tables with an `updated_at` column have a `BEFORE UPDATE` trigger calling `set_updated_at()`. Handlers never set it explicitly.
6. **Append-only history.** `item_state_history` rejects UPDATE and DELETE via trigger. `audit_log` is append-only by convention.
7. **Polymorphic FKs — layered enforcement.** `entity_stakeholders.entity_id`, `item_type_states.item_type_id`, `item_state_history.item_id`, and `page_entity_refs.entity_id` point at different tables depending on a `*_kind` discriminator. The DB enforces the vocabulary (CHECK); migration 013 dispatch triggers enforce parent existence + subscription match + non-archived parent on INSERT/UPDATE for three of the four tables (`item_state_history` deferred — parent tables not yet built). The Go `entityrefs` service is the required writer path for the other three. See [`c_polymorphic_writes.md`](c_polymorphic_writes.md).

---

## Domain → tables index

| Domain | Tables |
|---|---|
| Subscription & auth | `subscriptions`, `users`, `sessions`, `password_resets`, `api_keys` |
| Topology — workspaces tier (PLA-0006) | `workspaces`, `workspace_roles`, `org_nodes`, `org_node_roles`, `org_node_view_state`, `org_levels` |
| Roles & permissions (PLA-0007) | `roles`, `permissions`, `role_permissions` |
| ACL (legacy) | `user_workspace_permissions` |
| Audit & history | `audit_log`, `item_state_history` |
| Numbering | `subscription_sequence` |
| Portfolio stack (legacy singular) | `company_roadmap`, `workspace`, `portfolio`, `product`, `entity_stakeholders` |
| **Strategy artefacts (`obj_*`)** | `obj_portfolio_items`, `obj_strategy_types`, `obj_strategy_types_layers` |
| **Execution artefacts (`obj_*`)** | `obj_work_items`, `obj_work_items_field_values`, `obj_execution_types`, `obj_execution_types_tenant`, `obj_execution_types_overrides` |
| **Custom-field plumbing (`obj_*`)** | `obj_custom_field_lib`, `obj_field_templates`, `obj_field_template_fields` |
| **Flows (`obj_*`)** | `obj_flow_system`, `obj_flow_tenant` |
| Item type catalogues (legacy execution) | `execution_item_types` |
| Workflow states | `canonical_states`, `item_type_states`, `item_type_transition_edges` |
| Page registry | `pages`, `page_tags`, `page_roles`, `page_entity_refs`, `page_help` |
| User navigation | `user_nav_prefs`, `user_nav_groups`, `user_nav_profiles`, `user_nav_profiles_links`, `user_tab_order`, `user_theme_pack` |
| User custom pages | `user_custom_pages`, `user_custom_page_views` |
| Library release acks | `library_acknowledgements` |
| Library adoption state | `subscription_portfolio_model_state` |
| Portfolio model mirror | `subscription_workflows`, `subscription_workflow_transitions`, `subscription_artifacts`, `subscription_terminology` |
| Search infra | `o_search_index_outbox` |
| Error tracking | `error_events` |
| Icons | `vector_icons` |

Notes:
- Tables marked **`obj_*`** are renamed in migration 123. Detailed column tables further down still appear under their pre-rename names (e.g. `portfolio_item_types`); treat the `obj_*` name as canonical and the legacy column tables as accurate-by-shape pending re-snapshot.
- `pending_library_cleanup_jobs` (migration 019) was dropped in migration 122 — see Phase 1+2 callout above.
- `subscription_layers` was renamed to `obj_strategy_types_layers` in migration 123 (kept its column tables under the legacy name in the adoption-mirrors leaf [`c_c_schema_adoption_mirrors.md`](c_c_schema_adoption_mirrors.md) until that doc is refreshed).

---

## Tables (live snapshot)

Notation: `pk` = primary key. `→ table.col (rule)` = FK target with ON DELETE rule. `*` after a column name = NOT NULL.

### `subscriptions`

The root of multi-subscription isolation. Every business row pivots off a `subscription_id`. (Renamed from `tenants` in migration 017; migration 018 added `tier`.)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `name`* | text | no | — | |
| `slug`* | text | no | — | |
| `is_active`* | bool | no | `true` | |
| `tier`* | text | no | `'pro'` | CHECK in (`free`,`pro`,`enterprise`); drives `mmff_library` entitlements |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | trigger-maintained |

### `users`

Identity. One row per human; tied to one subscription.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `email`* | text | no | — | unique |
| `password_hash`* | text | no | — | bcrypt |
| `role`* | enum `user_role` | no | `'user'` | `gadmin` / `padmin` / `user` |
| `is_active`* | bool | no | `true` | |
| `last_login` | timestamptz | yes | — | |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |
| `auth_method`* | text | no | `'local'` | `local` or `ldap` |
| `ldap_dn` | text | yes | — | populated when `auth_method='ldap'` |
| `force_password_change`* | bool | no | `false` | |
| `password_changed_at` | timestamptz | yes | — | |
| `failed_login_count`* | int | no | `0` | |
| `locked_until` | timestamptz | yes | — | non-null = locked |
| `mfa_enrolled`* | bool | no | `false` | scaffold; not enforced yet |
| `mfa_secret` | text | yes | — | TOTP secret |
| `mfa_enrolled_at` | timestamptz | yes | — | |
| `mfa_recovery_codes` | text[] | yes | — | |

### `sessions`

Refresh-token sessions. One row per logged-in browser/device.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `user_id`* | uuid | no | — | → `users.id` (CASCADE) |
| `token_hash`* | text | no | — | sha256(refresh_token) |
| `created_at`* | timestamptz | no | `now()` | |
| `expires_at`* | timestamptz | no | — | |
| `last_used_at`* | timestamptz | no | `now()` | |
| `ip_address` | inet | yes | — | |
| `user_agent` | text | yes | — | |
| `revoked`* | bool | no | `false` | logout / rotation marks `true` |

### `password_resets`

Password-reset tokens. One row per request.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `user_id`* | uuid | no | — | → `users.id` (CASCADE) |
| `token_hash`* | text | no | — | sha256(reset_token) |
| `expires_at`* | timestamptz | no | — | typically +1h |
| `used_at` | timestamptz | yes | — | non-null = consumed |
| `requested_ip` | inet | yes | — | |
| `created_at`* | timestamptz | no | `now()` | |

### `workspaces`

> **Naming note** — the older, unrelated portfolio-stack table is singular `workspace` (migration 004); this PLA-0006 table is plural `workspaces`. They share neither rows nor FKs. The legacy `user_workspace_permissions.workspace_id` still points at the singular `workspace` table; PLA-0006 role grants live in `workspace_roles` below.

Workspace tier above `org_nodes` (migration 098, PLA-0006). A subscription holds 1..N workspaces; each workspace owns its own `org_nodes` tree. The workspace is the top-level tenant container — clamp predicate, role grants, and addressable scoping all narrow through here. Sole writer: [`backend/internal/workspaces.Service`](../backend/internal/workspaces/service.go); see [`c_c_topology.md`](c_c_topology.md). Enforced by `dev/scripts/lint_writer_boundary.py`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `name`* | text | no | — | CHECK `length(trim(name)) > 0` |
| `slug`* | text | no | — | CHECK regex `^[a-z0-9][a-z0-9-]*$` |
| `description` | text | yes | — | optional free-form |
| `created_by`* | uuid | no | — | → `users.id` (RESTRICT) |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | trigger-maintained |
| `archived_at` | timestamptz | yes | — | soft-archive (limbo) |
| `archived_by` | uuid | yes | — | → `users.id` (RESTRICT) |

Constraints + indexes:
- `workspaces_archived_pair` CHECK — `archived_at` and `archived_by` are both NULL or both set (every archive records who did it).
- **Partial unique slug index** `workspaces_subscription_slug_live ON (subscription_id, slug) WHERE archived_at IS NULL` — slug uniqueness only among LIVE workspaces in a subscription; archived rows release their slug for re-use.
- `workspaces_subscription_idx ON (subscription_id)` — hot-path lookup "list workspaces for a tenant".
- `trg_workspaces_updated_at BEFORE UPDATE` → `set_updated_at()`.

Invariants enforced by the sole writer:
- **Last-live guard** — `Service.Archive` refuses if the workspace is the only live one for its subscription (returns `ErrCannotArchiveLastLive`); a tenant must always own ≥1 live workspace so `org_nodes.workspace_id` stays satisfiable.
- **Default workspace on tenant signup** — every tenant boots with exactly one live workspace named "Default" (slug `default`). Existing tenants were backfilled by migration 099's bootstrap seed; future signups must call `Service.CreateDefault` in the same transaction as the `subscriptions` INSERT (see [`c_c_topology.md`](c_c_topology.md) § "Future: tenant-signup hook").

### `workspace_roles`

Workspace-scoped role grants — admin / editor / viewer (migration 098, PLA-0006). Mirrors `org_node_roles` at the workspace tier. Sole writer: [`backend/internal/workspaces.Service`](../backend/internal/workspaces/service.go).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `workspace_id`* | uuid | no | — | → `workspaces.id` (RESTRICT) |
| `user_id`* | uuid | no | — | → `users.id` (RESTRICT) |
| `role`* | text | no | — | CHECK in (`admin`, `editor`, `viewer`) |
| `can_redelegate`* | bool | no | `false` | column ships from day one (Phase X); MVP UI does not expose it |
| `granted_by`* | uuid | no | — | → `users.id` (RESTRICT) |
| `granted_at`* | timestamptz | no | `now()` | |
| `revoked_at` | timestamptz | yes | — | non-null = revoked (soft) |
| `revoked_by` | uuid | yes | — | → `users.id` (RESTRICT) |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | trigger-maintained |

Constraints + indexes:
- `workspace_roles_revoked_pair` CHECK — `revoked_at` and `revoked_by` are both NULL or both set.
- **Active-grant uniqueness** `workspace_roles_active_user UNIQUE ON (workspace_id, user_id) WHERE revoked_at IS NULL` — at most one active grant per (workspace, user); revoked rows are kept for audit, allowing re-grant after revoke.
- **MVP single-admin invariant** `workspace_roles_single_admin UNIQUE ON (workspace_id) WHERE role = 'admin' AND revoked_at IS NULL` — at most one active admin per workspace; drop this index to enable multi-admin in Phase X.
- `workspace_roles_user_idx ON (user_id) WHERE revoked_at IS NULL` — hot-path "which workspaces does user X touch" for the clamp predicate.
- `trg_workspace_roles_updated_at BEFORE UPDATE` → `set_updated_at()`.

The Service surfaces `ErrSingleAdminViolation` (translated from SQLSTATE 23505 on the partial unique index) so callers see a typed error rather than a raw constraint violation.

### `user_workspace_permissions`

Per-(user, workspace) ACL. Row-level overrides on top of role grants.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `user_id`* | uuid | no | — | → `users.id` (CASCADE) |
| `workspace_id`* | uuid | no | — | → `workspace.id` (CASCADE) |
| `can_view`* | bool | no | `false` | |
| `can_edit`* | bool | no | `false` | |
| `can_admin`* | bool | no | `false` | |
| `granted_by` | uuid | yes | — | → `users.id` (SET NULL) |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |

### `audit_log`

Append-only action log. NULL `user_id` = anonymous/system.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `user_id` | uuid | yes | — | → `users.id` (SET NULL) |
| `subscription_id` | uuid | yes | — | → `subscriptions.id` (SET NULL) |
| `action`* | text | no | — | e.g. `auth.login`, `user.created` |
| `resource` | text | yes | — | e.g. `user`, `workspace` |
| `resource_id` | text | yes | — | uuid or other id, free-form |
| `metadata` | jsonb | yes | — | per-action payload |
| `ip_address` | inet | yes | — | |
| `created_at`* | timestamptz | no | `now()` | |

### `subscription_sequence`

Per-subscription monotonic counters keyed by `scope` (e.g. `'workspace'`, `'portfolio'`). (Renamed from `tenant_sequence` in migration 017.)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT). pk part. |
| `scope`* | text | no | — | pk part |
| `next_num`* | bigint | no | `1` | next allocation |
| `updated_at`* | timestamptz | no | `now()` | |

### `company_roadmap`

The top of the portfolio stack. Owner user is RESTRICT-protected.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `key_num`* | bigint | no | — | unique within subscription |
| `name`* | text | no | — | |
| `owner_user_id`* | uuid | no | — | → `users.id` (RESTRICT) |
| `archived_at` | timestamptz | yes | — | soft-archive |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |

### `workspace`

A division/area of work under a `company_roadmap`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `company_roadmap_id`* | uuid | no | — | → `company_roadmap.id` (RESTRICT) |
| `key_num`* | bigint | no | — | unique within subscription |
| `name`* | text | no | — | |
| `owner_user_id`* | uuid | no | — | → `users.id` (RESTRICT) |
| `archived_at` | timestamptz | yes | — | |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |

### `portfolio`

A grouping of products inside a workspace.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `workspace_id`* | uuid | no | — | → `workspace.id` (RESTRICT) |
| `type_id` | uuid | yes | — | → `portfolio_item_types.id` (catalogue lookup) |
| `key_num`* | bigint | no | — | |
| `name`* | text | no | — | |
| `owner_user_id`* | uuid | no | — | → `users.id` (RESTRICT) |
| `archived_at` | timestamptz | yes | — | |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |

### `product`

The smallest portfolio-stack node — a product/service. Optionally nests under a portfolio.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `workspace_id`* | uuid | no | — | → `workspace.id` (RESTRICT) |
| `parent_portfolio_id` | uuid | yes | — | → `portfolio.id` (RESTRICT) |
| `type_id` | uuid | yes | — | catalogue lookup |
| `key_num`* | bigint | no | — | |
| `name`* | text | no | — | |
| `owner_user_id`* | uuid | no | — | → `users.id` (RESTRICT) |
| `archived_at` | timestamptz | yes | — | |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |

### `entity_stakeholders`

Polymorphic ownership/role grants on portfolio entities. `entity_kind` ∈ {`company_roadmap`, `workspace`, `portfolio`, `product`} (CHECK).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `entity_kind`* | text | no | — | CHECK against vocabulary |
| `entity_id`* | uuid | no | — | app-enforced FK |
| `user_id`* | uuid | no | — | → `users.id` (RESTRICT) |
| `role`* | text | no | `'stakeholder'` | e.g. `owner`, `stakeholder` |
| `created_at`* | timestamptz | no | `now()` | |

### `portfolio_item_types` → renamed `obj_strategy_types` (migration 123)

Per-subscription catalogue of strategy-layer node types (the catalogue, not instances). Renamed by migration 123 to `obj_strategy_types`; columns unchanged.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `name`* | text | no | — | display name |
| `tag`* | text | no | — | short tag (e.g. `WS`, `PT`); used in human IDs |
| `sort_order`* | int | no | `0` | |
| `archived_at` | timestamptz | yes | — | |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |

### `execution_item_types`

Per-subscription catalogue of work-item types (user-story, task, …). Same shape as portfolio_item_types.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `name`* | text | no | — | |
| `tag`* | text | no | — | |
| `sort_order`* | int | no | `0` | |
| `archived_at` | timestamptz | yes | — | |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |

### `canonical_states`

Global vocabulary of workflow state semantics. Seeded once; not per-subscription.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `code`* | text | no | — | pk (`backlog`, `in_progress`, `done`, …) |
| `label`* | text | no | — | |
| `clock_role`* | text | no | — | `unstarted`/`active`/`terminal` |
| `sort_order`* | int | no | — | |
| `created_at`* | timestamptz | no | `now()` | |

### `item_type_states`

Per-(subscription, item-type) state instances. `item_type_kind` ∈ {`portfolio`, `execution`}.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `item_type_id`* | uuid | no | — | app-enforced FK based on kind |
| `item_type_kind`* | text | no | — | CHECK |
| `name`* | text | no | — | |
| `canonical_code`* | text | no | — | → `canonical_states.code` (RESTRICT) |
| `sort_order`* | int | no | `0` | |
| `archived_at` | timestamptz | yes | — | |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |

### `item_type_transition_edges`

Allowed transitions between `item_type_states` for a given item-type.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `item_type_id`* | uuid | no | — | app-enforced FK |
| `item_type_kind`* | text | no | — | |
| `from_state_id`* | uuid | no | — | → `item_type_states.id` (RESTRICT) |
| `to_state_id`* | uuid | no | — | → `item_type_states.id` (RESTRICT) |
| `created_at`* | timestamptz | no | `now()` | |

### `item_state_history`

Append-only state-change journal. UPDATE/DELETE rejected by trigger.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `item_id`* | uuid | no | — | app-enforced FK to item table |
| `item_type_id`* | uuid | no | — | |
| `item_type_kind`* | text | no | — | |
| `from_state_id` | uuid | yes | — | → `item_type_states.id` (RESTRICT). NULL on first state. |
| `to_state_id`* | uuid | no | — | → `item_type_states.id` (RESTRICT) |
| `transitioned_by` | uuid | yes | — | → `users.id` (RESTRICT) |
| `transitioned_at`* | timestamptz | no | `now()` | |

### `pages`

Page-registry catalogue. System pages have `subscription_id`/`created_by` NULL; subscription-shared have `subscription_id` set; user-custom have both `subscription_id` and `created_by` set. Uniqueness enforced by three partial indexes (see migration 012). **Migration authors:** the `ON CONFLICT … WHERE` clauses in 012 mention `tenant_id` in their original text but were renamed to `subscription_id` by migration 017. Always read the live partial-index columns before writing a new `INSERT … ON CONFLICT` against `pages` (migrations 020 + 022 both shipped with the wrong column name and rolled back at apply).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `key_enum`* | text | no | — | stable string id (e.g. `dashboard`, `entity:product:<uuid>`) |
| `label`* | text | no | — | |
| `href`* | text | no | — | route |
| `icon`* | text | no | — | icon key (see `NavIcon`) |
| `tag_enum`* | text | no | — | → `page_tags.tag_enum` |
| `kind`* | text | no | — | `system`, `entity`, `user_custom`, etc. |
| `pinnable`* | bool | no | `true` | |
| `default_pinned`* | bool | no | `false` | auto-pinned on the next `GET /api/nav/prefs` for any user whose role passes `page_roles`; one-time per (user, page) — subsequent unpins stick. See `nav.Service.GetPrefs` opportunistic backfill. |
| `default_order`* | int | no | `0` | |
| `created_by` | uuid | yes | — | → `users.id` (CASCADE). NULL = system/shared |
| `subscription_id` | uuid | yes | — | → `subscriptions.id` (CASCADE). NULL = global system page |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |

### `page_tags`

Vocabulary of nav buckets/tag groups. Static reference data.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `tag_enum`* | text | no | — | pk |
| `display_name`* | text | no | — | |
| `default_order`* | int | no | — | |
| `is_admin_menu`* | bool | no | `false` | shows under admin section |
| `created_at`* | timestamptz | no | `now()` | |

### `page_roles`

Which roles may see a given page (allow-list).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `page_id`* | uuid | no | — | → `pages.id` (CASCADE). pk part |
| `role`* | enum `user_role` | no | — | pk part |

### `page_entity_refs`

Polymorphic link from a `pages` row to the entity it represents (for `kind='entity'`). `entity_kind` is app-validated.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `page_id`* | uuid | no | — | → `pages.id` (CASCADE). pk part |
| `entity_kind`* | text | no | — | pk part. CHECK against vocabulary |
| `entity_id`* | uuid | no | — | app-enforced FK |

### `user_nav_prefs`

A user's personalised sidebar — pinned items, ordering, optional grouping & nesting.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `user_id`* | uuid | no | — | → `users.id` (CASCADE) |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (CASCADE) |
| `profile_id` | uuid | yes | — | reserved for Phase 5 named profiles; MVP writes NULL |
| `item_key`* | text | no | — | catalogue key (matches `pages.key_enum` or static id) |
| `position`* | int | no | — | order within parent/group/tag |
| `is_start_page`* | bool | no | `false` | at most one TRUE per user (partial unique index) |
| `parent_item_key` | text | yes | — | non-null = nested under another pinned item |
| `group_id` | uuid | yes | — | → `user_nav_groups.id` (SET NULL) |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |

Constraints:
- `UNIQUE (user_id, subscription_id, profile_id, item_key)`
- `UNIQUE (user_id, subscription_id, profile_id, position)` DEFERRABLE INITIALLY DEFERRED
- Partial unique index `(user_id, subscription_id, profile_id) WHERE is_start_page = TRUE`

### `user_nav_groups`

User-defined nav buckets (custom groups). Items live in `user_nav_prefs.group_id`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `user_id`* | uuid | no | — | → `users.id` (CASCADE) |
| `label`* | text | no | — | |
| `position`* | int | no | — | order among the user's groups |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |

### `user_custom_pages`

User-authored container pages (migration 016). Each page owns one or more views (timeline / board / list). The page surfaces in the nav catalogue as `kind="user_custom"` with `item_key="custom:<id>"` and `href="/p/<id>"`. Max 50 pages per user/subscription. No soft-archive; hard delete cascades to views. See [`docs/c_c_custom_pages.md`](c_c_custom_pages.md).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `user_id`* | uuid | no | — | → `users.id` (CASCADE) |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (CASCADE) |
| `label`* | text | no | — | trimmed; CHECK `length > 0` |
| `icon`* | text | no | `'folder'` | icon key |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | trigger-maintained |

Constraints:
- `UNIQUE (user_id, subscription_id, label)` — label unique per owner within subscription.
- Index `idx_user_custom_pages_owner ON (user_id, subscription_id)`.

### `pending_library_cleanup_jobs` — DROPPED (migration 122)

Created by migration 019 as a Postgres-backed work queue for cross-DB cleanup of `mmff_library`-derived entities, but dropped (CASCADE) in migration 122 with zero rows ever in production. The archive-saga design that motivated it has not been built. If a cross-DB cleanup queue is needed in future, build a fresh implementation against the current substrate rather than resurrecting this table.

### `user_custom_page_views`

Render modes within a `user_custom_pages` row. Enum `custom_view_kind` ∈ {`timeline`, `board`, `list`}. The view at `position = 0` is the default; `?vid=<view_id>` selects others. Max 8 views per page.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `page_id`* | uuid | no | — | → `user_custom_pages.id` (CASCADE) |
| `label`* | text | no | — | CHECK `length > 0` |
| `kind`* | custom_view_kind | no | — | `timeline`, `board`, or `list` |
| `position`* | int | no | — | unique per page (DEFERRABLE) |
| `config`* | jsonb | no | `'{}'` | view-level settings |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | trigger-maintained |

Constraints:
- `UNIQUE (page_id, position)` DEFERRABLE INITIALLY DEFERRED.
- `UNIQUE (page_id, label)`.
- Index `idx_user_custom_page_views_page ON (page_id, position)`.

### `subscription_portfolio_model_state`

Per-subscription adoption record for an `mmff_library.portfolio_models` row (migration 026). Tracks the multi-step adoption saga (snapshot → mirror → flip pointer → cross-DB cleanup; see `feature_library_db_and_portfolio_presets_v3.md` §11). One non-terminal row per subscription, enforced by partial unique index. Ships with migration 026; not yet deployed (Phase-4 prep).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `adopted_model_id`* | uuid | no | — | App-enforced FK to `mmff_library.portfolio_models.id` (cross-DB; no real FK). Adoption handler validates at write time. |
| `adopted_by_user_id`* | uuid | no | — | → `users.id` (RESTRICT). Padmin who initiated adoption (role enforced at handler). |
| `adopted_at`* | timestamptz | no | `now()` | |
| `status`* | text | no | — | CHECK in (`pending`, `in_progress`, `completed`, `failed`, `rolled_back`) |
| `archived_at` | timestamptz | yes | — | soft-archive |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | trigger-maintained |

Indexes:
- `idx_subscription_portfolio_model_state_subscription_id ON (subscription_id) WHERE archived_at IS NULL` — hot path "what is subscription X's current adoption?".
- `idx_subscription_portfolio_model_state_status ON (subscription_id, status) WHERE archived_at IS NULL` — operator/UI filter by lifecycle.
- `idx_subscription_portfolio_model_state_active_unique` UNIQUE on `(subscription_id) WHERE archived_at IS NULL AND status NOT IN ('failed','rolled_back')` — at most one non-terminal adoption per subscription; failed/rolled_back rows persist for audit.

### Adoption mirror tables — `subscription_layers` / `subscription_workflows` / `subscription_workflow_transitions` / `subscription_artifacts` / `subscription_terminology`

Five per-subscription mirror tables (migration 029) populated by the adoption orchestrator from a `mmff_library` portfolio-model bundle. Each mirrors one of the library's bundle children verbatim, plus the per-subscription wrappings: `id` UUID PK, `subscription_id` (RESTRICT), `source_library_id` + `source_library_version` (app-enforced cross-DB), `archived_at`, `created_at`, `updated_at` + `set_updated_at()` trigger. Cross-FKs **between mirrors** (e.g. `subscription_workflows.layer_id` → `subscription_layers.id`) use the new mirror UUID PKs — the orchestrator translates `library_id` → `mirror_id` row-by-row at adopt time. Library-derived uniqueness re-shaped per-subscription (e.g. `(subscription_id, name)` partial WHERE `archived_at IS NULL`).

Full column lists, index lists, FK rules (RESTRICT on self/parent layer, CASCADE between workflows ↔ transitions), drop order, and the cross-DB writer-rules pattern: see [`c_c_schema_adoption_mirrors.md`](c_c_schema_adoption_mirrors.md).

### `error_events`

Per-subscription append-only log of reported errors (migration 028). One row per call to `reportError(code, context)`. UPDATE and DELETE are rejected by trigger (matches `item_state_history` pattern from migration 006; stricter than `audit_log` which is convention-only). No `archived_at`, no `updated_at` — append-only audit data.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `user_id` | uuid | yes | — | → `users.id` (SET NULL). Survives user deletion for audit. |
| `code`* | text | no | — | App-enforced FK by value to `mmff_library.error_codes.code` (cross-DB; no real FK). Readers LEFT JOIN across DBs and tolerate missing matches. See TD-LIB-007. |
| `context` | jsonb | yes | — | Optional structured payload from `reportError`. Small (< ~4 KB) JSON of short snake_case keys; link to logs/traces for blobs. |
| `occurred_at`* | timestamptz | no | `now()` | when the error was reported |
| `request_id` | text | yes | — | Correlation handle to logs/traces; matches go-chi `middleware.RequestID` output (TEXT, not UUID). |
| `created_at`* | timestamptz | no | `now()` | |

Indexes:
- `idx_error_events_subscription_code ON (subscription_id, code, occurred_at DESC)` — primary read path: "last N errors of code X for this subscription".
- `idx_error_events_subscription_occurred ON (subscription_id, occurred_at DESC)` — recent errors regardless of code (dashboards / alerts).

Append-only triggers:
- `trg_error_events_no_update BEFORE UPDATE` → `error_events_append_only()` raises `check_violation`.
- `trg_error_events_no_delete BEFORE DELETE` → same function.

---

## Foreign-key map (delete rules)

Reading: `child.col → parent.col (RULE)` means "when parent row is deleted, do RULE to child".

```
audit_log.user_id              → users.id              (SET NULL)
audit_log.subscription_id      → subscriptions.id      (SET NULL)

company_roadmap.subscription_id  → subscriptions.id    (RESTRICT)
company_roadmap.owner_user_id    → users.id            (RESTRICT)

entity_stakeholders.subscription_id → subscriptions.id (RESTRICT)
entity_stakeholders.user_id      → users.id            (RESTRICT)

error_events.subscription_id    → subscriptions.id     (RESTRICT)
error_events.user_id            → users.id             (SET NULL)

execution_item_types.subscription_id → subscriptions.id (RESTRICT)

item_state_history.subscription_id  → subscriptions.id     (RESTRICT)
item_state_history.from_state_id    → item_type_states.id  (RESTRICT)
item_state_history.to_state_id      → item_type_states.id  (RESTRICT)
item_state_history.transitioned_by  → users.id             (RESTRICT)

item_type_states.subscription_id     → subscriptions.id      (RESTRICT)
item_type_states.canonical_code      → canonical_states.code (RESTRICT)

item_type_transition_edges.subscription_id → subscriptions.id    (RESTRICT)
item_type_transition_edges.from_state_id   → item_type_states.id (RESTRICT)
item_type_transition_edges.to_state_id     → item_type_states.id (RESTRICT)

page_entity_refs.page_id       → pages.id              (CASCADE)
page_roles.page_id             → pages.id              (CASCADE)
pages.tag_enum                 → page_tags.tag_enum    (NO ACTION)
pages.created_by               → users.id              (CASCADE)
pages.subscription_id          → subscriptions.id      (CASCADE)

password_resets.user_id        → users.id              (CASCADE)

-- pending_library_cleanup_jobs DROPPED in migration 122

subscription_portfolio_model_state.subscription_id    → subscriptions.id (RESTRICT)
subscription_portfolio_model_state.adopted_by_user_id → users.id         (RESTRICT)
-- adopted_model_id → mmff_library.portfolio_models.id  (APP-ENFORCED; no DB FK, cross-DB)

-- subscription_layers RENAMED to obj_strategy_types_layers in migration 123 — FK shape unchanged
obj_strategy_types_layers.subscription_id    → subscriptions.id              (RESTRICT)
obj_strategy_types_layers.parent_layer_id    → obj_strategy_types_layers.id  (RESTRICT)
-- source_library_id → mmff_library.portfolio_model_layers.id                (APP-ENFORCED cross-DB)

subscription_workflows.subscription_id → subscriptions.id                (RESTRICT)
subscription_workflows.layer_id        → obj_strategy_types_layers.id    (CASCADE)
-- source_library_id → mmff_library.portfolio_model_workflows.id         (APP-ENFORCED cross-DB)

subscription_workflow_transitions.subscription_id  → subscriptions.id        (RESTRICT)
subscription_workflow_transitions.from_state_id    → subscription_workflows.id (CASCADE)
subscription_workflow_transitions.to_state_id      → subscription_workflows.id (CASCADE)
-- source_library_id → mmff_library.portfolio_model_workflow_transitions.id (APP-ENFORCED cross-DB)

subscription_artifacts.subscription_id → subscriptions.id          (RESTRICT)
-- source_library_id → mmff_library.portfolio_model_artifacts.id   (APP-ENFORCED cross-DB)

subscription_terminology.subscription_id → subscriptions.id        (RESTRICT)
-- source_library_id → mmff_library.portfolio_model_terminology.id (APP-ENFORCED cross-DB)

portfolio.subscription_id      → subscriptions.id      (RESTRICT)
portfolio.workspace_id         → workspace.id          (RESTRICT)
portfolio.owner_user_id        → users.id              (RESTRICT)

-- portfolio_item_types RENAMED to obj_strategy_types in migration 123
obj_strategy_types.subscription_id → subscriptions.id (RESTRICT)

product.subscription_id        → subscriptions.id      (RESTRICT)
product.workspace_id           → workspace.id          (RESTRICT)
product.parent_portfolio_id    → portfolio.id          (RESTRICT)
product.owner_user_id          → users.id              (RESTRICT)

sessions.user_id               → users.id              (CASCADE)

subscription_sequence.subscription_id → subscriptions.id (RESTRICT)

user_custom_pages.user_id          → users.id          (CASCADE)
user_custom_pages.subscription_id  → subscriptions.id  (CASCADE)

user_custom_page_views.page_id → user_custom_pages.id  (CASCADE)

user_nav_groups.user_id        → users.id              (CASCADE)

user_nav_prefs.user_id           → users.id              (CASCADE)
user_nav_prefs.subscription_id   → subscriptions.id      (CASCADE)
user_nav_prefs.group_id          → user_nav_groups.id    (SET NULL)

user_workspace_permissions.user_id      → users.id     (CASCADE)
user_workspace_permissions.workspace_id → workspace.id (CASCADE)
user_workspace_permissions.granted_by   → users.id     (SET NULL)

users.subscription_id          → subscriptions.id      (RESTRICT)

workspace.subscription_id      → subscriptions.id      (RESTRICT)
workspace.company_roadmap_id   → company_roadmap.id    (RESTRICT)
workspace.owner_user_id        → users.id              (RESTRICT)

workspaces.subscription_id     → subscriptions.id      (RESTRICT)
workspaces.created_by          → users.id              (RESTRICT)
workspaces.archived_by         → users.id              (RESTRICT)

workspace_roles.subscription_id → subscriptions.id     (RESTRICT)
workspace_roles.workspace_id    → workspaces.id        (RESTRICT)
workspace_roles.user_id         → users.id             (RESTRICT)
workspace_roles.granted_by      → users.id             (RESTRICT)
workspace_roles.revoked_by      → users.id             (RESTRICT)
```

Pattern summary:
- **Auth/session/log/nav/page-children: CASCADE** — when a user, subscription, or page goes, take their dependent rows with them.
- **Portfolio stack: RESTRICT** — never silently drop owners or hierarchy. You must explicitly reassign / archive first.
- **`granted_by`, `audit_log`: SET NULL** — preserve the audit row even after the actor is deleted.

---

## Migration order

```
001_init.sql                       -- pgcrypto, user_role enum, tenants (pre-rename), users, sessions, audit_log
002_auth_permissions.sql           -- user extensions, password_resets, user_project_permissions (pre-rename)
003_mfa_scaffold.sql               -- MFA columns on users (dormant)
004_portfolio_stack.sql            -- tenant_sequence (pre-rename), company_roadmap, workspace, portfolio, product, entity_stakeholders
005_item_types.sql                 -- portfolio_item_types (→ obj_strategy_types in 123), execution_item_types + name-lock trigger
006_states.sql                     -- canonical_states seed, item_type_states, item_type_transition_edges, item_state_history
007_rename_permissions.sql         -- user_project_permissions → user_workspace_permissions + FK
008_user_nav_prefs.sql             -- user_nav_prefs (pinned sidebar items + start page)
009_page_registry.sql              -- pages, page_tags, page_roles, page_entity_refs
010_nav_entity_bookmarks.sql       -- entity-key catalogue support for pinning portfolio entities
011_nav_subpages_custom_groups.sql -- user_nav_groups + parent_item_key/group_id on user_nav_prefs
012_pages_partial_unique.sql       -- 3 partial unique indexes on pages (system / shared / user-custom)
013_polymorphic_dispatch_triggers.sql -- dispatch fn + BEFORE INSERT/UPDATE triggers on entity_stakeholders, page_entity_refs, item_type_states (TD-001 Phase 1 defence-in-depth)
014_page_theme.sql                 -- page-level theme column
015_user_nav_icon_override.sql     -- per-user icon override on user_nav_prefs
016_user_custom_pages.sql          -- user_custom_pages + user_custom_page_views + custom_view_kind enum
017_subscriptions_rename.sql       -- tenants → subscriptions, tenant_id → subscription_id, tenant_sequence → subscription_sequence (TD-LIB-001 Phase 0)
018_subscription_tier.sql          -- subscriptions.tier (free|pro|enterprise) — drives mmff_library entitlements
019_pending_library_cleanup_jobs.sql -- cross-DB cleanup queue (DROPPED in 122)
020_portfolio_model_page.sql       -- pages registry row for /workspace-settings/portfolio-model
021_library_acknowledgements.sql   -- per-subscription acks for library releases
022_library_releases_page.sql      -- pages row for the library releases page
023_backfill_library_releases_pin.sql -- one-time backfill default-pin for the library releases page
024_backfill_portfolio_model_pin.sql  -- one-time backfill default-pin for portfolio-model page
025_nav_group_reorder.sql          -- nav-group reorder helper / index tweaks
026_subscription_portfolio_model_state.sql -- per-subscription adoption-state (TD-LIB-007)
028_error_events.sql               -- append-only error log; cross-DB FK to mmff_library.error_codes by value (TD-LIB-008)
029_adoption_mirror_tables.sql     -- 5 per-subscription adoption mirror tables (TD-LIB-009; see c_c_schema_adoption_mirrors.md)
030_unpin_gadmin_portfolio_model.sql  -- remove gadmin auto-pin for portfolio-model page
031_nav_dev_library.sql            -- /dev library nav entry
032_drop_pre_adoption_item_types.sql  -- cleanup pre-adoption item-type seed rows
033_theme_unpinnable_product_strategic.sql -- theme/pin flags for product+strategic
034_user_nav_profiles.sql          -- user_nav_profiles (named profiles)
035_user_nav_profiles_links.sql    -- profile↔page links
036_backfill_default_profiles.sql  -- backfill default profile for existing users
037_user_nav_prefs_position_per_parent.sql -- partial uniqueness on (parent, position)
038_pin_product_entity_bookmark.sql -- bookmark pin for product entities
039_user_theme_pack.sql            -- user_theme_pack table
040_theme_page_library.sql         -- theme rows for library pages
041_fix_subscription_layer_sort_order.sql -- data fix on subscription_layers
042_theme_pack_drop_check.sql      -- relax theme-pack CHECK constraint
043_user_stories.sql               -- legacy user_stories table (writer at internal/userstories — Phase 3 deferred migration)
044_defects.sql                    -- legacy defects table (writer at internal/defects — Phase 3 deferred migration)
045_item_labels_tags.sql           -- item_labels + item_tags (DROPPED in 122)
046_portfolio_items.sql            -- portfolio_items (→ obj_portfolio_items in 123)
047_custom_fields.sql              -- item_field_definitions (DROPPED in 122)
048_item_field_options.sql         -- item_field_options + item_field_values (DROPPED in 122)
049_artefact_type_registry.sql     -- o_artefact_types_system/_tenant/_overrides (→ obj_execution_types* in 123)
050_artefact_visibility.sql        -- o_artefact_visibility_levels lookup (still live)
051_artefacts_execution_user_stories.sql  -- legacy per-type artefact tables (deferred drop; package retired)
052_artefacts_execution_defects.sql       -- (same — deferred drop)
053_artefacts_execution_tasks.sql         -- (same — deferred drop)
054_artefacts_execution_test_cases.sql    -- (same — deferred drop)
055_artefacts_strategic.sql               -- (same — deferred drop)
056_artefact_notes.sql             -- o_artefact_notes/_note_reads (DROPPED in 122)
057_artefact_versions.sql          -- o_artefact_versions (DROPPED in 122)
058_search_index_outbox.sql        -- o_search_index_outbox (still live; worker at internal/searchworker)
059_artefact_type_registry_seed.sql -- seed system artefact types
060_artefact_schema_tables.sql     -- per-artefact schema tables (most superseded; see 122)
061_artefact_field_values_reshape.sql -- field-value column reshape
062_work_items_page.sql            -- pages row for /work-items
063_work_items_rename_and_epics.sql -- consolidated work_items + epics (epics later dropped in 122)
064_custom_field_library.sql       -- o_execution_custom_field_library (→ obj_custom_field_lib in 123)
065_execution_core_columns.sql     -- core columns on execution work items
066_work_items_expand_types.sql    -- broaden item_type set on work_items
067_icon_catalogue.sql             -- vector_icons table
068_ranking_position_columns.sql   -- ranking position columns (PLA generic ranking)
069_ranking_notify_trigger.sql     -- pg_notify trigger for ranking realtime
070_page_scope.sql                 -- page scope column
071_pane_help.sql                  -- pane_help table (later replaced by page_help — see 075/076)
072_portfolio_items_page.sql       -- pages row for portfolio items
073_planning_canonical_order.sql   -- canonical_states sort_order tweak
074_page_addressables.sql          -- pages.is_addressable + addressable_key columns
075_page_help.sql                  -- page_help (replacement for pane_help)
076_drop_pane_help.sql             -- drop pane_help
077_seed_dev_addressables.sql      -- seed addressables for /dev pages
078_seed_portfolio_addressables.sql  -- seed addressables for portfolio pages
079_seed_work_items_addressables.sql -- seed addressables for work-items
080_seed_library_releases_addressables.sql -- seed addressables for library-releases
081_addressables_helpable.sql      -- helpable flag on addressables
082_org_nodes.sql                  -- org_nodes tree (PLA-0006 topology)
083_org_node_roles.sql             -- org_node_roles
084_org_node_view_state.sql        -- org_node_view_state
085_org_node_id_fk.sql             -- org_node_id FKs / hardening
086_users_profile_fields.sql       -- profile fields on users
087_topology_page.sql              -- pages row for /topology
088_roles_permissions.sql          -- roles + permissions + role_permissions (PLA-0007 RBAC)
089_users_page_roles_role_id.sql   -- role_id on users + page_roles wiring
090_org_levels.sql                 -- org_levels lookup
091_org_nodes_level_id.sql         -- level_id FK on org_nodes
092_subscriptions_topology_committed.sql -- subscriptions.topology_committed flag
093_org_nodes_description_not_null.sql   -- enforce description NOT NULL
094_admin_roles_page.sql           -- pages row for admin/roles
095_seed_team_lead_account.sql     -- seed team-lead test account
096_org_nodes_drop_name_unique.sql -- drop unique(name) constraint on org_nodes
097_page_help_rich_content.sql     -- page_help body becomes rich content
098_workspaces.sql                 -- workspaces tier above org_nodes (PLA-0006)
099_org_nodes_workspace_id.sql     -- workspace_id FK on org_nodes
100_workspace_permissions_seed.sql -- seed workspace.* permission codes
101_workspace_roles_backfill.sql   -- backfill workspace_roles
102_seed_page_summary_help.sql     -- seed help summaries
103_page_help_seeded_from_placeholder.sql -- mark seeded rows
104_extend_permission_catalogue.sql -- library/portfolio/work-items permissions
105_artefact_flow_states.sql       -- artefact flow-state rows
106_artefact_types_naming_and_tenant.sql -- naming + tenant additions on artefact types
107_flow_tables_rename.sql         -- o_flow_* names (renamed again to obj_flow_* in 123)
108_canonical_states_rename.sql    -- canonical_states rename pass (still live)
109_seed_defects_flow.sql          -- seed defects flow
110_seed_remaining_flows.sql       -- seed remaining flows
111_portfolio_item_type_flow_seed_trigger.sql -- trigger to seed flow when type added
112_grant_gadmin_portfolio_model_edit.sql -- grant portfolio.model.edit to gadmin
113_grant_gadmin_portfolio_model_page_role.sql -- page_roles row
114_remove_portfolio_model_from_sidebar.sql -- nav cleanup
115_user_tab_order.sql             -- user_tab_order
117_flows_manage_permission.sql    -- flows.manage permission code
118_backfill_system_flows_to_tenants.sql -- per-tenant flow backfill
119_artefact_flow_state_fk.sql     -- FK hardening on flow states
120_api_keys.sql                   -- api_keys table
121_work_items_due_date.sql        -- due_date column on work_items
122_drop_orphaned_tables.sql       -- DROP 11 orphan tables (notes, versions, epics, item_field_*, item_labels, item_tags, pending_library_cleanup_jobs)
123_rename_tables_to_obj_family.sql -- RENAME 13 live tables to obj_* family (catalog-only; zero rewrites). See Phase 1+2 callout above.
124_drop_empty_legacy_artefact_tables.sql -- Drop 6 empty per-type artefact tables (test_cases*, *_field_values for defects/tasks, strategic*). Defects + tasks parents retained — hold seed data.
125_drop_remaining_legacy_artefact_tables.sql -- Drop the last 2 (o_artefacts_execution_defects, _tasks). Their 6 rows were dummy payload — obj_work_items seed (db/seed/002_work_items_poc.sql) already holds canonical fixtures.
```

> Gaps: migration **027** and **116** are not present on disk (numbers reserved/skipped during planning).

## Naming conventions

- Tables: singular (`workspace`, `portfolio`) — but `subscriptions` is plural for historical reasons (renamed from `tenants` in migration 017; the singular form `subscription` reads as a column reference).
- FKs: `<target>_id` (e.g. `subscription_id`, `workspace_id`, `owner_user_id`).
- Unique key-num constraints: `<table>_key_unique UNIQUE (subscription_id, key_num)`.
- Indexes: `idx_<table>_<columns>`; active-row partials: `idx_<table>_active`.
- Update triggers: `trg_<table>_updated_at`.

## Not yet in the schema

Deferred until item-level work begins:

- Work-item tables (`user_story`, `task`, `feature`, …) — deferred; not in current scope. `item_state_history.item_id` has no FK yet for this reason.
- `item_key_alias` table for rename grace-period redirects (see [c_url-routing.md](c_url-routing.md)). Deferred until the first tag rename ships.
- Multi-division config root (SoW §12 paid tier) — planned as a nullable `config_root_id` addition on item-type and state tables; non-breaking.
- `nav_icons` catalogue + per-user icon override on `user_nav_prefs` (planned, not yet built).

## Go model mirrors

Go structs for these tables live in `backend/internal/models/models.go`. The Go layer is the authoritative map for the read/write API; when a column is added in SQL, the struct grows too.

---

## Refresh this snapshot

When the schema drifts, regenerate columns + FKs from the live DB and update this file:

```bash
# Columns
PGPASSWORD=… /opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d mmff_vector -At -F '|' -c "
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
ORDER BY table_name, ordinal_position;"

# Foreign keys + delete rules
PGPASSWORD=… /opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d mmff_vector -At -F '|' -c "
SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu USING (constraint_schema, constraint_name)
JOIN information_schema.referential_constraints rc USING (constraint_schema, constraint_name)
JOIN information_schema.constraint_column_usage ccu USING (constraint_schema, constraint_name)
WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
ORDER BY tc.table_name, kcu.ordinal_position;"
```
