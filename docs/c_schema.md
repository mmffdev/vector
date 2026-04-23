# Database schema — golden source

> Last verified live: 2026-04-23 against `mmff_vector` (snapshot taken via tunnel). Doc updated 2026-04-23 post-PR-3 to add migration 013 and update invariant 7.

This is the canonical map of every table in `mmff_vector`. Read here first instead of running blind `\d` queries — every column, FK, and delete rule below was dumped from the live DB.

If you find drift, re-run the snapshot at the bottom of this file and update.

## Engine

- **Postgres 16** in Docker container `mmff-ops-postgres` on `mmffdev.com`.
- **Database:** `mmff_vector`.
- **App role:** `mmff_dev`. Password in `backend/.env.local` (`DB_PASSWORD`).
- **Local access:** SSH tunnel `localhost:5434` → server `:5432`. See [c_postgresql.md](c_postgresql.md).
- **Schema migrations:** `db/schema/NNN_*.sql`, applied in number order. Each file wraps its DDL in `BEGIN; … COMMIT;`.

## Invariants that span tables

These rules are the contract; every query/handler/migration honours them.

1. **Tenant isolation by row.** Every business table carries `tenant_id UUID NOT NULL REFERENCES tenants(id)`. Every read path MUST filter by the session's tenant. A query that forgets `WHERE tenant_id = $1` is a data leak.
2. **Soft-archive only.** Business rows expose `archived_at TIMESTAMPTZ` and are never hard-deleted (SoW §7 audit-trail requirement). `WHERE archived_at IS NULL` is the live-row predicate; partial indexes (`… WHERE archived_at IS NULL`) accelerate it.
3. **UUIDs are the identity.** Primary keys are `UUID DEFAULT gen_random_uuid()` (`pgcrypto`). Human-readable references (`US-00000347`) are rendered at display time from `key_num` + the current tag on `*_item_types`; they are NOT stored on work items.
4. **Per-tenant key counters.** `tenant_sequence(tenant_id, scope)` hands out monotonic `key_num` values. Gaps are permitted (archived numbers never reused). Lock pattern: `SELECT next_num … FOR UPDATE; UPDATE … SET next_num = next_num + 1`.
5. **`updated_at` is trigger-maintained.** Tables with an `updated_at` column have a `BEFORE UPDATE` trigger calling `set_updated_at()`. Handlers never set it explicitly.
6. **Append-only history.** `item_state_history` rejects UPDATE and DELETE via trigger. `audit_log` is append-only by convention.
7. **Polymorphic FKs — layered enforcement.** `entity_stakeholders.entity_id`, `item_type_states.item_type_id`, `item_state_history.item_id`, and `page_entity_refs.entity_id` point at different tables depending on a `*_kind` discriminator. The DB enforces the vocabulary (CHECK); migration 013 dispatch triggers enforce parent existence + tenant match + non-archived parent on INSERT/UPDATE for three of the four tables (`item_state_history` deferred — parent tables not yet built). The Go `entityrefs` service is the required writer path for the other three. See [`c_polymorphic_writes.md`](c_polymorphic_writes.md).

---

## Domain → tables index

| Domain | Tables |
|---|---|
| Tenancy & auth | `tenants`, `users`, `sessions`, `password_resets` |
| ACL | `user_workspace_permissions` |
| Audit & history | `audit_log`, `item_state_history` |
| Numbering | `tenant_sequence` |
| Portfolio stack | `company_roadmap`, `workspace`, `portfolio`, `product`, `entity_stakeholders` |
| Item type catalogues | `portfolio_item_types`, `execution_item_types` |
| Workflow states | `canonical_states`, `item_type_states`, `item_type_transition_edges` |
| Page registry | `pages`, `page_tags`, `page_roles`, `page_entity_refs` |
| User navigation | `user_nav_prefs`, `user_nav_groups` |

---

## Tables (live snapshot)

Notation: `pk` = primary key. `→ table.col (rule)` = FK target with ON DELETE rule. `*` after a column name = NOT NULL.

### `tenants`

The root of multi-tenancy. Every business row pivots off a `tenant_id`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `name`* | text | no | — | |
| `slug`* | text | no | — | |
| `is_active`* | bool | no | `true` | |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | trigger-maintained |

### `users`

Identity. One row per human; tied to one tenant.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `tenant_id`* | uuid | no | — | → `tenants.id` (RESTRICT) |
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
| `tenant_id` | uuid | yes | — | → `tenants.id` (SET NULL) |
| `action`* | text | no | — | e.g. `auth.login`, `user.created` |
| `resource` | text | yes | — | e.g. `user`, `workspace` |
| `resource_id` | text | yes | — | uuid or other id, free-form |
| `metadata` | jsonb | yes | — | per-action payload |
| `ip_address` | inet | yes | — | |
| `created_at`* | timestamptz | no | `now()` | |

### `tenant_sequence`

Per-tenant monotonic counters keyed by `scope` (e.g. `'workspace'`, `'portfolio'`).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `tenant_id`* | uuid | no | — | → `tenants.id` (RESTRICT). pk part. |
| `scope`* | text | no | — | pk part |
| `next_num`* | bigint | no | `1` | next allocation |
| `updated_at`* | timestamptz | no | `now()` | |

### `company_roadmap`

The top of the portfolio stack. Owner user is RESTRICT-protected.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `tenant_id`* | uuid | no | — | → `tenants.id` (RESTRICT) |
| `key_num`* | bigint | no | — | unique within tenant |
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
| `tenant_id`* | uuid | no | — | → `tenants.id` (RESTRICT) |
| `company_roadmap_id`* | uuid | no | — | → `company_roadmap.id` (RESTRICT) |
| `key_num`* | bigint | no | — | unique within tenant |
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
| `tenant_id`* | uuid | no | — | → `tenants.id` (RESTRICT) |
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
| `tenant_id`* | uuid | no | — | → `tenants.id` (RESTRICT) |
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
| `tenant_id`* | uuid | no | — | → `tenants.id` (RESTRICT) |
| `entity_kind`* | text | no | — | CHECK against vocabulary |
| `entity_id`* | uuid | no | — | app-enforced FK |
| `user_id`* | uuid | no | — | → `users.id` (RESTRICT) |
| `role`* | text | no | `'stakeholder'` | e.g. `owner`, `stakeholder` |
| `created_at`* | timestamptz | no | `now()` | |

### `portfolio_item_types`

Per-tenant catalogue of portfolio-stack node types (the catalogue, not instances).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `tenant_id`* | uuid | no | — | → `tenants.id` (RESTRICT) |
| `name`* | text | no | — | display name |
| `tag`* | text | no | — | short tag (e.g. `WS`, `PT`); used in human IDs |
| `sort_order`* | int | no | `0` | |
| `archived_at` | timestamptz | yes | — | |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |

### `execution_item_types`

Per-tenant catalogue of work-item types (user-story, task, …). Same shape as portfolio_item_types.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `tenant_id`* | uuid | no | — | → `tenants.id` (RESTRICT) |
| `name`* | text | no | — | |
| `tag`* | text | no | — | |
| `sort_order`* | int | no | `0` | |
| `archived_at` | timestamptz | yes | — | |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |

### `canonical_states`

Global vocabulary of workflow state semantics. Seeded once; not per-tenant.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `code`* | text | no | — | pk (`backlog`, `in_progress`, `done`, …) |
| `label`* | text | no | — | |
| `clock_role`* | text | no | — | `unstarted`/`active`/`terminal` |
| `sort_order`* | int | no | — | |
| `created_at`* | timestamptz | no | `now()` | |

### `item_type_states`

Per-(tenant, item-type) state instances. `item_type_kind` ∈ {`portfolio`, `execution`}.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id`* | uuid | no | `gen_random_uuid()` | pk |
| `tenant_id`* | uuid | no | — | → `tenants.id` (RESTRICT) |
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
| `tenant_id`* | uuid | no | — | → `tenants.id` (RESTRICT) |
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
| `tenant_id`* | uuid | no | — | → `tenants.id` (RESTRICT) |
| `item_id`* | uuid | no | — | app-enforced FK to item table |
| `item_type_id`* | uuid | no | — | |
| `item_type_kind`* | text | no | — | |
| `from_state_id` | uuid | yes | — | → `item_type_states.id` (RESTRICT). NULL on first state. |
| `to_state_id`* | uuid | no | — | → `item_type_states.id` (RESTRICT) |
| `transitioned_by` | uuid | yes | — | → `users.id` (RESTRICT) |
| `transitioned_at`* | timestamptz | no | `now()` | |

### `pages`

Page-registry catalogue. System pages have `tenant_id`/`created_by` NULL; tenant-shared have `tenant_id` set; user-custom have both `tenant_id` and `created_by` set. Uniqueness enforced by three partial indexes (see migration 012).

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
| `default_pinned`* | bool | no | `false` | |
| `default_order`* | int | no | `0` | |
| `created_by` | uuid | yes | — | → `users.id` (CASCADE). NULL = system/shared |
| `tenant_id` | uuid | yes | — | → `tenants.id` (CASCADE). NULL = global system page |
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
| `tenant_id`* | uuid | no | — | → `tenants.id` (CASCADE) |
| `profile_id` | uuid | yes | — | reserved for Phase 5 named profiles; MVP writes NULL |
| `item_key`* | text | no | — | catalogue key (matches `pages.key_enum` or static id) |
| `position`* | int | no | — | order within parent/group/tag |
| `is_start_page`* | bool | no | `false` | at most one TRUE per user (partial unique index) |
| `parent_item_key` | text | yes | — | non-null = nested under another pinned item |
| `group_id` | uuid | yes | — | → `user_nav_groups.id` (SET NULL) |
| `created_at`* | timestamptz | no | `now()` | |
| `updated_at`* | timestamptz | no | `now()` | |

Constraints:
- `UNIQUE (user_id, tenant_id, profile_id, item_key)`
- `UNIQUE (user_id, tenant_id, profile_id, position)` DEFERRABLE INITIALLY DEFERRED
- Partial unique index `(user_id, tenant_id, profile_id) WHERE is_start_page = TRUE`

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

---

## Foreign-key map (delete rules)

Reading: `child.col → parent.col (RULE)` means "when parent row is deleted, do RULE to child".

```
audit_log.user_id              → users.id              (SET NULL)
audit_log.tenant_id            → tenants.id            (SET NULL)

company_roadmap.tenant_id      → tenants.id            (RESTRICT)
company_roadmap.owner_user_id  → users.id              (RESTRICT)

entity_stakeholders.tenant_id  → tenants.id            (RESTRICT)
entity_stakeholders.user_id    → users.id              (RESTRICT)

execution_item_types.tenant_id → tenants.id            (RESTRICT)

item_state_history.tenant_id        → tenants.id            (RESTRICT)
item_state_history.from_state_id    → item_type_states.id   (RESTRICT)
item_state_history.to_state_id      → item_type_states.id   (RESTRICT)
item_state_history.transitioned_by  → users.id              (RESTRICT)

item_type_states.tenant_id           → tenants.id            (RESTRICT)
item_type_states.canonical_code      → canonical_states.code (RESTRICT)

item_type_transition_edges.tenant_id      → tenants.id          (RESTRICT)
item_type_transition_edges.from_state_id  → item_type_states.id (RESTRICT)
item_type_transition_edges.to_state_id    → item_type_states.id (RESTRICT)

page_entity_refs.page_id       → pages.id              (CASCADE)
page_roles.page_id             → pages.id              (CASCADE)
pages.tag_enum                 → page_tags.tag_enum    (NO ACTION)
pages.created_by               → users.id              (CASCADE)
pages.tenant_id                → tenants.id            (CASCADE)

password_resets.user_id        → users.id              (CASCADE)

portfolio.tenant_id            → tenants.id            (RESTRICT)
portfolio.workspace_id         → workspace.id          (RESTRICT)
portfolio.owner_user_id        → users.id              (RESTRICT)

portfolio_item_types.tenant_id → tenants.id            (RESTRICT)

product.tenant_id              → tenants.id            (RESTRICT)
product.workspace_id           → workspace.id          (RESTRICT)
product.parent_portfolio_id    → portfolio.id          (RESTRICT)
product.owner_user_id          → users.id              (RESTRICT)

sessions.user_id               → users.id              (CASCADE)

tenant_sequence.tenant_id      → tenants.id            (RESTRICT)

user_nav_groups.user_id        → users.id              (CASCADE)

user_nav_prefs.user_id         → users.id              (CASCADE)
user_nav_prefs.tenant_id       → tenants.id            (CASCADE)
user_nav_prefs.group_id        → user_nav_groups.id    (SET NULL)

user_workspace_permissions.user_id      → users.id     (CASCADE)
user_workspace_permissions.workspace_id → workspace.id (CASCADE)
user_workspace_permissions.granted_by   → users.id     (SET NULL)

users.tenant_id                → tenants.id            (RESTRICT)

workspace.tenant_id            → tenants.id            (RESTRICT)
workspace.company_roadmap_id   → company_roadmap.id    (RESTRICT)
workspace.owner_user_id        → users.id              (RESTRICT)
```

Pattern summary:
- **Auth/session/log/nav/page-children: CASCADE** — when a user, tenant, or page goes, take their dependent rows with them.
- **Portfolio stack: RESTRICT** — never silently drop owners or hierarchy. You must explicitly reassign / archive first.
- **`granted_by`, `audit_log`: SET NULL** — preserve the audit row even after the actor is deleted.

---

## Migration order

```
001_init.sql                       -- pgcrypto, user_role enum, tenants, users, sessions, audit_log
002_auth_permissions.sql           -- user extensions, password_resets, user_project_permissions (pre-rename)
003_mfa_scaffold.sql               -- MFA columns on users (dormant)
004_portfolio_stack.sql            -- tenant_sequence, company_roadmap, workspace, portfolio, product, entity_stakeholders
005_item_types.sql                 -- portfolio_item_types, execution_item_types + name-lock trigger
006_states.sql                     -- canonical_states seed, item_type_states, item_type_transition_edges, item_state_history
007_rename_permissions.sql         -- user_project_permissions → user_workspace_permissions + FK
008_user_nav_prefs.sql             -- user_nav_prefs (pinned sidebar items + start page)
009_page_registry.sql              -- pages, page_tags, page_roles, page_entity_refs
010_nav_entity_bookmarks.sql       -- entity-key catalogue support for pinning portfolio entities
011_nav_subpages_custom_groups.sql -- user_nav_groups + parent_item_key/group_id on user_nav_prefs
012_pages_partial_unique.sql       -- 3 partial unique indexes on pages (system / shared / user-custom)
013_polymorphic_dispatch_triggers.sql -- dispatch fn + BEFORE INSERT/UPDATE triggers on entity_stakeholders, page_entity_refs, item_type_states (TD-001 Phase 1 defence-in-depth)
```

## Naming conventions

- Tables: singular (`workspace`, `portfolio`) — rows are entities, not collections.
- FKs: `<target>_id` (e.g. `tenant_id`, `workspace_id`, `owner_user_id`).
- Unique key-num constraints: `<table>_key_unique UNIQUE (tenant_id, key_num)`.
- Indexes: `idx_<table>_<columns>`; active-row partials: `idx_<table>_active`.
- Update triggers: `trg_<table>_updated_at`.

## Not yet in the schema

Deferred until item-level work begins:

- Work-item tables (`user_story`, `task`, `feature`, …) — blocked on OKR placement decision (SoW §11). `item_state_history.item_id` has no FK yet for this reason.
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
