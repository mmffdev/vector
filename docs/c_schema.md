# Database schema — golden source

> Last verified live: 2026-04-24 against `mmff_vector` (snapshot taken via tunnel). Doc updated 2026-04-25 post Phase-1 (`mmff_library` scaffolding: bundle tables + roles + grants + MMFF seed). Phase-0 covered migrations 017 (`tenants → subscriptions`), 018 (`subscriptions.tier`), 019 (`pending_library_cleanup_jobs`).

This is the canonical map of every table in `mmff_vector`. Read here first instead of running blind `\d` queries — every column, FK, and delete rule below was dumped from the live DB.

> **`mmff_library` (second database)** — Phase 1 created the read-only library DB on the same Postgres cluster: `portfolio_models` spine + 6 bundle children + `portfolio_model_shares` + four roles (`mmff_library_admin`/`_ro`/`_publish`/`_ack`) + grant matrix. Schema files live at `db/library_schema/NNN_*.sql`; the MMFF seed bundle is at `db/library_schema/seed/001_mmff_model.sql`. CI canary: `backend/internal/librarydb/grants_test.go` enforces the role/table grant matrix. Connection pools: `backend/internal/librarydb/db.go` (3 pools — RO, Publish, Ack). **Phase 2** added the bundle fetcher (`bundle.go`/`fetch.go`) — see [`c_c_librarydb_fetch.md`](c_c_librarydb_fetch.md). **Phase 3** added the release-notification channel: 3 tables in `mmff_library` (`library_releases`, `library_release_actions`, `library_release_log`) + 1 table in `mmff_vector` (`library_acknowledgements`) + grants extension (`006_grants_release_channel.sql`) + page-registry row (vector migration `022_library_releases_page.sql`) — see [`c_c_library_release_channel.md`](c_c_library_release_channel.md). Plan: `dev/planning/feature_library_db_and_portfolio_presets_v3.md`.

If you find drift, re-run the snapshot at the bottom of this file and update.

## Engine

- **Postgres 16** in Docker container `mmff-ops-postgres` on `mmffdev.com`.
- **Database:** `mmff_vector`.
- **App role:** `mmff_dev`. Password in `backend/.env.local` (`DB_PASSWORD`).
- **Local access:** SSH tunnel `localhost:5434` → server `:5432`. See [c_postgresql.md](c_postgresql.md).
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
| Subscription & auth | `subscriptions`, `users`, `sessions`, `password_resets` |
| ACL | `user_workspace_permissions` |
| Audit & history | `audit_log`, `item_state_history` |
| Numbering | `subscription_sequence` |
| Portfolio stack | `company_roadmap`, `workspace`, `portfolio`, `product`, `entity_stakeholders` |
| Item type catalogues | `portfolio_item_types`, `execution_item_types` |
| Workflow states | `canonical_states`, `item_type_states`, `item_type_transition_edges` |
| Page registry | `pages`, `page_tags`, `page_roles`, `page_entity_refs` |
| User navigation | `user_nav_prefs`, `user_nav_groups` |
| User custom pages | `user_custom_pages`, `user_custom_page_views` |
| Library reconciliation | `pending_library_cleanup_jobs` |
| Library release acks | `library_acknowledgements` |

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

### `portfolio_item_types`

Per-subscription catalogue of portfolio-stack node types (the catalogue, not instances).

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

### `pending_library_cleanup_jobs`

Postgres-backed work queue for cross-DB cleanup of `mmff_library`-derived entities (migration 019). The archive saga can't span two Postgres databases atomically, so writers enqueue here in the same txn as the archive UPDATE; a worker drains via `SELECT ... FOR UPDATE SKIP LOCKED` and DELETE-on-success / retry-with-backoff on failure (see `dev/planning/feature_library_db_and_portfolio_presets_v3.md` §4).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `subscription_id`* | uuid | no | — | → `subscriptions.id` (RESTRICT) |
| `job_kind`* | text | no | — | CHECK in (`preset_archive_propagation`, `template_instance_unlink`, `library_mirror_purge`) |
| `payload`* | jsonb | no | — | worker-specific (entity ids, library refs) |
| `status`* | text | no | `'pending'` | CHECK in (`pending`, `dead`) |
| `attempts`* | int | no | `0` | CHECK ≥ 0 |
| `max_attempts`* | int | no | `8` | CHECK > 0; row moves to `dead` once exceeded |
| `last_error` | text | yes | — | populated on failed claim |
| `visible_at`* | timestamptz | no | `now()` | claim gate; bumped on retry with exp backoff |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | trigger-maintained |

Indexes:
- `idx_pending_library_cleanup_jobs_claimable ON (visible_at) WHERE status = 'pending'` — hot path for worker poll.
- `idx_pending_library_cleanup_jobs_dead ON (subscription_id, updated_at DESC) WHERE status = 'dead'` — ops dead-letter view.

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

pending_library_cleanup_jobs.subscription_id → subscriptions.id (RESTRICT)

portfolio.subscription_id      → subscriptions.id      (RESTRICT)
portfolio.workspace_id         → workspace.id          (RESTRICT)
portfolio.owner_user_id        → users.id              (RESTRICT)

portfolio_item_types.subscription_id → subscriptions.id (RESTRICT)

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
005_item_types.sql                 -- portfolio_item_types, execution_item_types + name-lock trigger
006_states.sql                     -- canonical_states seed, item_type_states, item_type_transition_edges, item_state_history
007_rename_permissions.sql         -- user_project_permissions → user_workspace_permissions + FK
008_user_nav_prefs.sql             -- user_nav_prefs (pinned sidebar items + start page)
009_page_registry.sql              -- pages, page_tags, page_roles, page_entity_refs
010_nav_entity_bookmarks.sql       -- entity-key catalogue support for pinning portfolio entities
011_nav_subpages_custom_groups.sql -- user_nav_groups + parent_item_key/group_id on user_nav_prefs
012_pages_partial_unique.sql       -- 3 partial unique indexes on pages (system / shared / user-custom)
013_polymorphic_dispatch_triggers.sql -- dispatch fn + BEFORE INSERT/UPDATE triggers on entity_stakeholders, page_entity_refs, item_type_states (TD-001 Phase 1 defence-in-depth)
014_page_theme.sql                    -- page-level theme column (details in migration file)
015_user_nav_icon_override.sql        -- per-user icon override on user_nav_prefs
016_user_custom_pages.sql             -- user_custom_pages + user_custom_page_views + custom_view_kind enum
017_subscriptions_rename.sql          -- tenants → subscriptions, tenant_id → subscription_id, tenant_sequence → subscription_sequence; FKs/indexes/triggers/dispatch fns updated in same tx (TD-LIB-001 Phase 0)
018_subscription_tier.sql             -- subscriptions.tier TEXT NOT NULL DEFAULT 'pro' CHECK in (free,pro,enterprise) — drives mmff_library entitlements (TD-LIB-002)
019_pending_library_cleanup_jobs.sql  -- cross-DB cleanup work queue for the archive saga (TD-LIB-003)
```

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
PGPASSWORD=… /opt/homebrew/opt/libpq/bin/psql -h localhost -p 5434 -U mmff_dev -d mmff_vector -At -F '|' -c "
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
ORDER BY table_name, ordinal_position;"

# Foreign keys + delete rules
PGPASSWORD=… /opt/homebrew/opt/libpq/bin/psql -h localhost -p 5434 -U mmff_dev -d mmff_vector -At -F '|' -c "
SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu USING (constraint_schema, constraint_name)
JOIN information_schema.referential_constraints rc USING (constraint_schema, constraint_name)
JOIN information_schema.constraint_column_usage ccu USING (constraint_schema, constraint_name)
WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
ORDER BY tc.table_name, kcu.ordinal_position;"
```
