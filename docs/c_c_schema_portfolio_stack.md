# Schema — portfolio stack

> Parent: [c_schema.md](c_schema.md)
> Last verified: 2026-04-21

The tenant-scoped hierarchy above work items: **Tenant → Company Roadmap → Workspace → Portfolio → Product**. All tables land in migration 004.

## `tenant_sequence` (migration 004)

Per-(tenant, scope) monotonic counter. Hands out `key_num` values for every namespaced entity in the tenant.

| Column | Type | Notes |
|---|---|---|
| `tenant_id` | UUID → tenants | composite PK |
| `scope` | TEXT | composite PK |
| `next_num` | BIGINT NOT NULL | CHECK `next_num > 0`, default 1 |
| `updated_at` | TIMESTAMPTZ | trigger-maintained |

**Lock pattern** (always use this — no other increment path):

```sql
BEGIN;
SELECT next_num FROM tenant_sequence
    WHERE tenant_id=$1 AND scope=$2 FOR UPDATE;
-- returned value is the key_num you use
UPDATE tenant_sequence SET next_num = next_num + 1
    WHERE tenant_id=$1 AND scope=$2;
-- insert the new entity row using the captured key_num
COMMIT;
```

**Scope vocabulary:**
- `roadmap`, `workspace`, `portfolio`, `product` — stack-layer counters.
- The UUID of a `portfolio_item_types` or `execution_item_types` row — work-item counters (TA-*, US-*, …), introduced from migration 005 onwards.

**Gaps are permitted by design.** Archived or aborted numbers are never reused.

## `company_roadmap` (migration 004)

One row per tenant — a pseudo-container above workspaces representing "the entire company offering". Auto-created, never deletable by users.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID UNIQUE → tenants | one-to-one with tenant |
| `key_num` | BIGINT NOT NULL | CHECK `> 0`, unique with `tenant_id` |
| `name` | TEXT NOT NULL | |
| `owner_user_id` | UUID → users | ON DELETE RESTRICT |
| `archived_at` | TIMESTAMPTZ | soft-archive |
| `created_at`, `updated_at` | TIMESTAMPTZ | trigger-maintained |

## `workspace` (migration 004)

Top-level customer-facing container. gadmin creates these. `SPACE-00000001` is seeded per tenant.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID → tenants | |
| `company_roadmap_id` | UUID → company_roadmap | ON DELETE RESTRICT |
| `key_num` | BIGINT NOT NULL | unique with `tenant_id` |
| `name` | TEXT NOT NULL | |
| `owner_user_id` | UUID → users | |
| `archived_at` | TIMESTAMPTZ | |
| `created_at`, `updated_at` | TIMESTAMPTZ | trigger-maintained |

**Indexes:** `idx_workspace_tenant_id`, `idx_workspace_company_roadmap_id`, `idx_workspace_active` (partial, `WHERE archived_at IS NULL`).

## `portfolio` (migration 004)

The Portfolio Runway layer. padmin creates under a workspace. `type_id` resolves into `portfolio_item_types` (migration 005) — stays nullable in 004 for migration ordering.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id`, `workspace_id` | UUID | both NOT NULL, FK to respective tables |
| `type_id` | UUID | nullable; FK is app-enforced into portfolio_item_types |
| `key_num` | BIGINT NOT NULL | unique with `tenant_id` |
| `name` | TEXT NOT NULL | |
| `owner_user_id` | UUID → users | |
| `archived_at` | TIMESTAMPTZ | |
| `created_at`, `updated_at` | TIMESTAMPTZ | trigger-maintained |

**Indexes:** `idx_portfolio_tenant_id`, `idx_portfolio_workspace_id`, `idx_portfolio_active`.

## `product` (migration 004)

`PROD-00000001` auto-seeded under the default workspace per tenant. A product can be a child of a portfolio, or sit directly under the workspace when the customer isn't using portfolios.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id`, `workspace_id` | UUID NOT NULL | |
| `parent_portfolio_id` | UUID → portfolio | nullable — `NULL` means direct-under-workspace |
| `type_id` | UUID | nullable; app-enforced FK into portfolio_item_types |
| `key_num` | BIGINT NOT NULL | unique with `tenant_id` |
| `name` | TEXT NOT NULL | |
| `owner_user_id` | UUID → users | |
| `archived_at` | TIMESTAMPTZ | |
| `created_at`, `updated_at` | TIMESTAMPTZ | trigger-maintained |

**Indexes:** `idx_product_tenant_id`, `idx_product_workspace_id`, `idx_product_parent_portfolio_id`, `idx_product_active`.

## `entity_stakeholders` (migration 004)

Polymorphic stakeholder list separate from `owner_user_id` — prevents bulk stakeholder updates from overwriting ownership.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID → tenants | |
| `entity_kind` | TEXT NOT NULL | CHECK in (`company_roadmap`, `workspace`, `portfolio`, `product`); item-kinds added in 005+ |
| `entity_id` | UUID NOT NULL | app-enforced FK into the entity table matching `entity_kind` |
| `user_id` | UUID → users | |
| `role` | TEXT NOT NULL | default `stakeholder`; free-form |
| `created_at` | TIMESTAMPTZ | |

**Unique:** `(entity_kind, entity_id, user_id, role)` — same user can hold multiple roles on an entity, but not the same role twice.

**Indexes:** `idx_stakeholders_tenant_id`, `idx_stakeholders_entity`, `idx_stakeholders_user`.

## Invariants specific to this domain

- Every layer carries its own `tenant_id` — do not rely on parent FKs for tenant filtering, filter explicitly.
- `ON DELETE RESTRICT` on parent FKs means you cannot delete a workspace that has portfolios/products; archive instead.
- `owner_user_id` is a RESTRICT — you cannot delete a user who still owns anything without reassigning.
- The three `*.type_id` columns (portfolio, product, and later item tables) are **nullable with no FK** in the schema; the application must validate them against `portfolio_item_types` / `execution_item_types` before insert.
