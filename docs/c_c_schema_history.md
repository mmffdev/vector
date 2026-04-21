# Schema — history & audit

> Parent: [c_schema.md](c_schema.md)
> Last verified: 2026-04-21

Append-only records. Never UPDATE, never DELETE — mutating these breaks metrics and the audit trail.

## `audit_log` (migration 001)

Free-form action log for auth and admin events. Append-only by convention (no trigger enforcement yet — writer code must not mutate rows).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID → users | ON DELETE SET NULL (anonymised if the user is later deleted) |
| `tenant_id` | UUID → tenants | ON DELETE SET NULL |
| `action` | TEXT NOT NULL | dotted string, e.g. `auth.login`, `auth.logout`, `auth.token_refresh`, `auth.login_failed` |
| `resource` | TEXT | e.g. `session`, `user` |
| `resource_id` | TEXT | UUID of affected row, stored as text for flexibility |
| `metadata` | JSONB | arbitrary context (browser, OS, request info) |
| `ip_address` | INET | |
| `created_at` | TIMESTAMPTZ NOT NULL | |

**Indexes:** `idx_audit_log_user_id`, `idx_audit_log_tenant_id`, `idx_audit_log_action`, `idx_audit_log_created`.

## `item_state_history` (migration 006)

Source of truth for cycle time, lead time, WIP, and cumulative flow charts. Append-only **by trigger** — UPDATE and DELETE raise exceptions.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID → tenants | |
| `item_id` | UUID NOT NULL | **No FK** — points at whatever item table is relevant (user_story, task, feature, …). Item tables don't exist yet; referential integrity is app-enforced. |
| `item_type_id` | UUID NOT NULL | |
| `item_type_kind` | TEXT NOT NULL | CHECK in (`portfolio`, `execution`) |
| `from_state_id` | UUID → item_type_states | nullable — first-ever transition has no `from` |
| `to_state_id` | UUID → item_type_states | NOT NULL |
| `transitioned_by` | UUID → users | ON DELETE RESTRICT |
| `transitioned_at` | TIMESTAMPTZ NOT NULL | |

**Check:** `from_state_id IS NULL OR from_state_id <> to_state_id` (no self-loops).

**Indexes:**
- `idx_history_tenant_id`
- `idx_history_item_timeline` (item_id, transitioned_at) — timeline-per-item queries
- `idx_history_wip` (tenant_id, to_state_id, transitioned_at) — WIP snapshots
- `idx_history_type` (item_type_id, item_type_kind)

### Append-only enforcement

Two triggers call the shared `item_state_history_append_only()` function:

```sql
CREATE TRIGGER trg_item_state_history_no_update BEFORE UPDATE …
CREATE TRIGGER trg_item_state_history_no_delete BEFORE DELETE …
```

Both raise `check_violation` with `op=<TG_OP>` and the row id. Bypass requires a DBA to `ALTER TABLE … DISABLE TRIGGER` — do not do this from app code.

## Why these are separate from the entity tables

The audit trail survives data cleanup. If a user is deleted, their `audit_log` rows keep the action but nullify `user_id`; `item_state_history` rows retain `transitioned_by`'s SET RESTRICT behaviour so you cannot delete a user who has transitioned items without first reassigning. Metrics queries run against `item_state_history` directly — never reconstruct history from `updated_at` stamps on the item tables.
