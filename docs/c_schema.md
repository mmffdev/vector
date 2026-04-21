# Database schema — overview

> Last verified: 2026-04-21

The canonical map of what's in `mmff_vector`. Read this to orient yourself before touching any table; drill into a depth-2 leaf for per-table detail.

## Engine

- **Postgres 16** in Docker container `mmff-ops-postgres`
- **Database:** `mmff_vector`
- **Role used by the app:** `mmff_dev`
- **Schema migrations:** `db/schema/NNN_*.sql`, applied in number order. Each file wraps its DDL in a `BEGIN; … COMMIT;` block.

## Invariants that span tables

These rules are the contract; every query/handler/migration honours them.

1. **Tenant isolation by row.** Every business table carries a `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT`. Every read path MUST filter by the session's tenant. No exception — a query that forgets `WHERE tenant_id = $1` is a data leak.
2. **Soft-archive only.** Business rows expose `archived_at TIMESTAMPTZ` and are never hard-deleted (SoW §7 audit-trail requirement). `WHERE archived_at IS NULL` is the live-row predicate; partial indexes (`… WHERE archived_at IS NULL`) accelerate it.
3. **UUIDs are the identity.** Primary keys are `UUID DEFAULT gen_random_uuid()` (`pgcrypto`). Human-readable references (`US-00000347`) are rendered at display time from `key_num` + the current tag on `*_item_types`; they are NOT stored on work items.
4. **Per-tenant key counters.** `tenant_sequence(tenant_id, scope)` hands out monotonic `key_num` values. Gaps are permitted (archived numbers never reused). Lock pattern: `SELECT next_num … FOR UPDATE; UPDATE … SET next_num = next_num + 1`.
5. **`updated_at` is trigger-maintained.** Tables with an `updated_at` column have a `BEFORE UPDATE` trigger calling `set_updated_at()`. Handlers never set it explicitly.
6. **Append-only history.** `item_state_history` rejects UPDATE and DELETE via trigger. `audit_log` is append-only by convention (no trigger yet, but no writer code mutates it).
7. **Polymorphic FKs are app-enforced.** `entity_stakeholders.entity_id`, `item_type_states.item_type_id`, and `item_state_history.item_id` point at different tables depending on a `*_kind` discriminator. The database enforces the vocabulary (CHECK); the application enforces referential integrity.

## Table catalogue — where each lives

| Domain | Tables | Leaf |
|---|---|---|
| Auth & permissions | `tenants`, `users`, `sessions`, `password_resets`, `user_workspace_permissions` | [c_c_schema_auth.md](c_c_schema_auth.md) |
| History & audit | `audit_log`, `item_state_history` (append-only) | [c_c_schema_history.md](c_c_schema_history.md) |
| Portfolio stack | `tenant_sequence`, `company_roadmap`, `workspace`, `portfolio`, `product`, `entity_stakeholders` | [c_c_schema_portfolio_stack.md](c_c_schema_portfolio_stack.md) |
| Item type catalogues | `portfolio_item_types`, `execution_item_types` | [c_c_schema_item_types.md](c_c_schema_item_types.md) |
| Workflow states | `canonical_states`, `item_type_states`, `item_type_transition_edges` | [c_c_schema_states.md](c_c_schema_states.md) |

## Migration order

```
001_init.sql                 -- pgcrypto, user_role enum, tenants, users, sessions, audit_log
002_auth_permissions.sql     -- user extensions, password_resets, user_project_permissions (pre-rename)
003_mfa_scaffold.sql         -- MFA columns on users (dormant)
004_portfolio_stack.sql      -- tenant_sequence, company_roadmap, workspace, portfolio, product, entity_stakeholders
005_item_types.sql           -- portfolio_item_types, execution_item_types + name-lock trigger
006_states.sql               -- canonical_states seed, item_type_states, item_type_transition_edges, item_state_history
007_rename_permissions.sql   -- user_project_permissions → user_workspace_permissions + FK
```

## Naming conventions

- Tables: singular (`workspace`, `portfolio`) — intentional; rows are entities, not collections.
- FKs: `<target>_id` (e.g. `tenant_id`, `workspace_id`, `owner_user_id`).
- Unique key-num constraints: `<table>_key_unique UNIQUE (tenant_id, key_num)`.
- Indexes: `idx_<table>_<columns>`; active-row partials: `idx_<table>_active`.
- Update triggers: `trg_<table>_updated_at`.

## Not yet in the schema

Deferred until item-level work begins:

- Work-item tables (`user_story`, `task`, `feature`, …) — blocked on OKR placement decision (SoW §11). `item_state_history.item_id` has no FK yet for this reason.
- `item_key_alias` table for rename grace-period redirects (see [c_url-routing.md](c_url-routing.md)). Deferred until the first tag rename ships.
- Multi-division config root (SoW §12 paid tier) — planned as a nullable `config_root_id` addition on item-type and state tables; non-breaking.

## Go model mirrors

Go structs for these tables live in `backend/internal/models/models.go`. The Go layer is the authoritative map for the read/write API; when a column is added in SQL, the struct grows too.
