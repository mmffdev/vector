# Schema — item type catalogues

> Parent: [c_schema.md](c_schema.md)
> Last verified: 2026-04-21

Two parallel catalogues defined in migration 005. Work-item rows reference a type by UUID only — renaming a tag is a single-row update, not a migration. Human keys like `US-00000347` re-render with the new tag automatically.

## `portfolio_item_types` (migration 005)

Portfolio-layer types (Portfolio Runway, Product, Business Objective, Theme, Feature). **Both `name` and `tag` are editable.**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | referenced by `portfolio.type_id`, `product.type_id` |
| `tenant_id` | UUID → tenants | |
| `name` | TEXT NOT NULL | unique with `tenant_id` |
| `tag` | TEXT NOT NULL | CHECK `length(tag) BETWEEN 2 AND 4`, unique with `tenant_id` |
| `sort_order` | INT NOT NULL | default 0 |
| `archived_at` | TIMESTAMPTZ | |
| `created_at`, `updated_at` | TIMESTAMPTZ | trigger-maintained |

**Unique constraints:** `(tenant_id, tag)` and `(tenant_id, name)`.

**Indexes:** `idx_portfolio_item_types_tenant_id`, `idx_portfolio_item_types_active` (partial).

## `execution_item_types` (migration 005)

Execution-space types (Epic Story, User Story, Defect, Task). **`name` is LOCKED** — a User Story is always a User Story. Only `tag` is editable (e.g. `US` → `STORY`).

Same column shape as `portfolio_item_types`. The name-lock is enforced by trigger:

```sql
CREATE TRIGGER trg_execution_item_types_lock_name
    BEFORE UPDATE ON execution_item_types
    FOR EACH ROW EXECUTE FUNCTION execution_item_types_lock_name();
```

The function raises `check_violation` with message `execution_item_types.name is immutable (id=…, old=…, new=…)`. Inserts are unaffected; tag updates pass through.

## Tag semantics

- Tag length: 2–4 characters (SoW §9).
- Default tags: `TA` Task, `US` User Story, `ES` Epic Story, `FE` Feature, `TH` Theme, `BO` Business Objective, `PR` Product.
- Tags are unique per tenant — the same tenant cannot have two types with tag `US`.
- Renaming a tag does NOT migrate historical keys; `US-00000347` stops resolving after rename, `STORY-00000347` starts. See [c_url-routing.md](c_url-routing.md) for the grace-period story.

## Scope — today and later

MVP is tenant-scoped: one catalogue per tenant. The paid-tier **Multi-Division Config** (SoW §12) will add a nullable `config_root_id` column to both tables so sub-divisions can own independent catalogues. That is a non-breaking migration — leave the door open, don't build the door.

## Cross-table references

- Both `portfolio.type_id` and `product.type_id` point at `portfolio_item_types.id` — nullable in the schema; the application validates.
- `item_type_states.item_type_id` + `item_type_kind` discriminator resolves into whichever catalogue matches the kind. See [c_c_schema_states.md](c_c_schema_states.md).
- `tenant_sequence.scope` can hold an `item_type.id` UUID (as text) — that's how per-type work-item counters are scoped.
