# Adoption mirror tables — leaf

> Parent: [c_schema.md](c_schema.md)
> Last verified live: 2026-04-25 against `mmff_vector` (migration 029 applied via SSH+docker; verified with `\d` on all five tables).

The five per-subscription mirror tables created by migration 029. They hold a subscription's editable copy of an `mmff_library` portfolio-model bundle's children. The orchestrator (Wave 1 card 00008) populates them at adopt time; this leaf documents only the destination schema.

## How they relate

```
mmff_library                                  mmff_vector
─────────────                                 ──────────────────────────────
portfolio_models (spine)
  └ portfolio_model_layers                    subscription_layers
  └ portfolio_model_workflows                 subscription_workflows
  └ portfolio_model_workflow_transitions      subscription_workflow_transitions
  └ portfolio_model_artifacts                 subscription_artifacts
  └ portfolio_model_terminology               subscription_terminology
```

A subscription's "current adoption" is tracked in `subscription_portfolio_model_state` (migration 026). That row's `adopted_model_id` is the library spine row; the mirror tables below are its child snapshot.

## Per-subscription wrappings (every mirror table)

| Column | Type | Notes |
|---|---|---|
| `id`* | uuid | pk, `gen_random_uuid()` — replaces the library row's id |
| `subscription_id`* | uuid | → `subscriptions.id` (RESTRICT) |
| `source_library_id`* | uuid | App-enforced cross-DB ref to the library row this was mirrored from |
| `source_library_version`* | int | Snapshot of `mmff_library.portfolio_models.version` at adopt time. CHECK > 0 |
| `archived_at` | timestamptz | soft-archive |
| `created_at`* | timestamptz | `now()` |
| `updated_at`* | timestamptz | `now()`, trigger-maintained via `set_updated_at()` |

`source_library_id` and `source_library_version` are not enforced by Postgres (no cross-DB FKs). The adoption handler validates against `mmff_library` before INSERT; the nightly reconciler (see `feature_library_db_and_portfolio_presets_v3.md` §8) sweeps for orphans. Same pattern as `subscription_portfolio_model_state.adopted_model_id` (migration 026).

## Cross-FK chain (within mirrors)

| Child | Column | → | Parent | Rule | Mirrors library |
|---|---|---|---|---|---|
| `subscription_layers` | `parent_layer_id` | → | `subscription_layers.id` | RESTRICT | `portfolio_model_layers.parent_layer_id` (RESTRICT) |
| `subscription_workflows` | `layer_id` | → | `subscription_layers.id` | CASCADE | `portfolio_model_workflows.layer_id` (CASCADE) |
| `subscription_workflow_transitions` | `from_state_id` | → | `subscription_workflows.id` | CASCADE | `portfolio_model_workflow_transitions.from_state_id` (CASCADE) |
| `subscription_workflow_transitions` | `to_state_id` | → | `subscription_workflows.id` | CASCADE | `portfolio_model_workflow_transitions.to_state_id` (CASCADE) |

These are mirror→mirror FKs, NOT mirror→library. The orchestrator translates `library_id → mirror_id` row-by-row during adopt (see card 00008).

## Per-mirror payload + indexes

### `subscription_layers`

Mirrors `portfolio_model_layers`. Hierarchical (self-FK).

Payload columns (verbatim from library):
- `name`* TEXT, `tag`* TEXT (CHECK length 2–4), `sort_order`* INT default 0
- `parent_layer_id` UUID nullable, → self (RESTRICT)
- `icon`, `colour`, `description_md`, `help_md` TEXT
- `allows_children`* BOOL default TRUE, `is_leaf`* BOOL default FALSE

Indexes (all WHERE `archived_at IS NULL` unless noted):
- `idx_subscription_layers_subscription_id` on `(subscription_id)`
- `idx_subscription_layers_source` on `(subscription_id, source_library_id)`
- `idx_subscription_layers_parent` on `(parent_layer_id)` WHERE `parent_layer_id IS NOT NULL AND archived_at IS NULL`
- `idx_subscription_layers_name_unique` UNIQUE on `(subscription_id, name)`
- `idx_subscription_layers_tag_unique` UNIQUE on `(subscription_id, tag)`

### `subscription_workflows`

Mirrors `portfolio_model_workflows` — workflow states per layer.

Payload:
- `layer_id`* UUID → `subscription_layers.id` (CASCADE)
- `state_key`* TEXT, `state_label`* TEXT, `sort_order`* INT default 0
- `is_initial`* BOOL default FALSE, `is_terminal`* BOOL default FALSE
- `colour` TEXT

Indexes:
- `idx_subscription_workflows_subscription_id` on `(subscription_id)` partial
- `idx_subscription_workflows_source` on `(subscription_id, source_library_id)` partial
- `idx_subscription_workflows_layer` on `(layer_id)` partial
- `idx_subscription_workflows_state_unique` UNIQUE on `(subscription_id, layer_id, state_key)` partial

### `subscription_workflow_transitions`

Mirrors `portfolio_model_workflow_transitions`. Edge between two workflow states.

Payload:
- `from_state_id`* UUID → `subscription_workflows.id` (CASCADE)
- `to_state_id`* UUID → `subscription_workflows.id` (CASCADE)
- CHECK `from_state_id <> to_state_id`

Indexes:
- `idx_subscription_workflow_transitions_subscription_id` on `(subscription_id)` partial
- `idx_subscription_workflow_transitions_source` on `(subscription_id, source_library_id)` partial
- `idx_subscription_workflow_transitions_pair_unique` UNIQUE on `(subscription_id, from_state_id, to_state_id)` partial

### `subscription_artifacts`

Mirrors `portfolio_model_artifacts`. Per-bundle artifact toggles + config.

Payload:
- `artifact_key`* TEXT
- `enabled`* BOOL default TRUE
- `config`* JSONB default `'{}'`

Indexes:
- `idx_subscription_artifacts_subscription_id` on `(subscription_id)` partial
- `idx_subscription_artifacts_source` on `(subscription_id, source_library_id)` partial
- `idx_subscription_artifacts_key_unique` UNIQUE on `(subscription_id, artifact_key)` partial

### `subscription_terminology`

Mirrors `portfolio_model_terminology`. Label overrides.

Payload:
- `key`* TEXT
- `value`* TEXT

Indexes:
- `idx_subscription_terminology_subscription_id` on `(subscription_id)` partial
- `idx_subscription_terminology_source` on `(subscription_id, source_library_id)` partial
- `idx_subscription_terminology_key_unique` UNIQUE on `(subscription_id, key)` partial

## Drop order (rollback)

CASCADE makes drop order strict — children before parents:

```sql
DROP TABLE subscription_workflow_transitions;
DROP TABLE subscription_workflows;
DROP TABLE subscription_layers;
DROP TABLE subscription_artifacts;     -- independent
DROP TABLE subscription_terminology;   -- independent
```

Verified clean drop in a `BEGIN; … ROLLBACK;` block on 2026-04-25.

## Triggers

Each table has `BEFORE UPDATE` trigger calling `set_updated_at()`:

- `trg_subscription_layers_updated_at`
- `trg_subscription_workflows_updated_at`
- `trg_subscription_workflow_transitions_updated_at`
- `trg_subscription_artifacts_updated_at`
- `trg_subscription_terminology_updated_at`

## Cross-DB tech debt

Tracked under TD-LIB-005 in [c_tech_debt.md](c_tech_debt.md). Same shape as TD-LIB-003 (cross-DB cleanup queue) and the `subscription_portfolio_model_state.adopted_model_id` reference in migration 026 — Postgres has no cross-DB FK so the writer-rules pattern + nightly reconciler are the contract.
