# Schema — workflow states

> Parent: [c_schema.md](c_schema.md)
> Last verified: 2026-04-21

Three-table state model from migration 006. The history table that records transitions lives in [c_c_schema_history.md](c_c_schema_history.md) — they are cross-cutting, not co-located.

## Model shape

```
canonical_states (seed)
      ↑ canonical_code FK
item_type_states (per tenant, per item-type)
      ↑ from_state_id, to_state_id FK
item_type_transition_edges (explicit legal moves)
```

## `canonical_states` (migration 006)

Tenant-independent vocabulary (SoW §3). Seeded once by the migration; the application never writes to this table.

| Column | Type | Notes |
|---|---|---|
| `code` | TEXT PK | |
| `label` | TEXT NOT NULL | display name |
| `clock_role` | TEXT NOT NULL | CHECK in (`none`, `lead_start`, `cycle_active`, `cycle_stop`, `lead_stop`) |
| `sort_order` | INT NOT NULL | |
| `created_at` | TIMESTAMPTZ | |

**Seeded rows:**

| code | label | clock_role | sort |
|---|---|---|---|
| `defined` | Defined | none | 10 |
| `ready` | Ready | lead_start | 20 |
| `in_progress` | In Progress | cycle_active | 30 |
| `completed` | Completed | cycle_stop | 40 |
| `accepted` | Accepted | lead_stop | 50 |

### Clock roles — what metrics read

| Metric | From | To |
|---|---|---|
| Lead time | `lead_start` (ready) | `lead_stop` (accepted) |
| Cycle time | `cycle_active` (in_progress) | `cycle_stop` (completed) |
| Per-column cycle time | sum of time spent in each non-`defined` bespoke state (per user spec) | |

## `item_type_states` (migration 006)

Per-(tenant, item_type) bespoke states. This is where a team adds UX / UI / Dev / Testing columns that all roll up to the canonical `in_progress`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID → tenants | |
| `item_type_id` | UUID NOT NULL | no FK; resolves via `item_type_kind` |
| `item_type_kind` | TEXT NOT NULL | CHECK in (`portfolio`, `execution`) |
| `name` | TEXT NOT NULL | display name of the bespoke state |
| `canonical_code` | TEXT → canonical_states | NOT NULL, ON DELETE RESTRICT |
| `sort_order` | INT NOT NULL | default 0 |
| `archived_at` | TIMESTAMPTZ | |
| `created_at`, `updated_at` | TIMESTAMPTZ | trigger-maintained |

**Unique:** `(tenant_id, item_type_id, item_type_kind, name)`.

**Indexes:** `idx_item_type_states_tenant_id`, `idx_item_type_states_type`, `idx_item_type_states_canonical`, `idx_item_type_states_active`.

## `item_type_transition_edges` (migration 006)

Explicit directed graph of legal `(from, to)` moves. Nothing implicit — a team chooses which transitions they permit.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID → tenants | |
| `item_type_id`, `item_type_kind` | UUID, TEXT | same discriminator pattern |
| `from_state_id` | UUID → item_type_states | ON DELETE RESTRICT |
| `to_state_id` | UUID → item_type_states | ON DELETE RESTRICT |
| `created_at` | TIMESTAMPTZ | |

**Checks & uniques:**
- `edge_no_self_loop`: `from_state_id <> to_state_id`.
- `edge_unique`: `(tenant_id, item_type_id, item_type_kind, from_state_id, to_state_id)`.

**App-enforced invariant** (not in DB): both endpoints must share the same `(item_type_id, item_type_kind)`. Cross-type edges are nonsensical and the handler rejects them.

**Indexes:** `idx_transition_edges_tenant_id`, `idx_transition_edges_type`, `idx_transition_edges_from`, `idx_transition_edges_to`.

## Reading this with history

- `item_state_history` records every transition; it is append-only and lives at [c_c_schema_history.md](c_c_schema_history.md).
- Current state of an item = the `to_state_id` of its most recent `item_state_history` row.
- "Is this move legal?" = existence check against `item_type_transition_edges` before inserting into history.
