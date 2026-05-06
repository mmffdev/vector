# Vector artefacts — production cutover & backfill plan

> Status: **PoC complete, cutover not started.** The `vector_artefacts` database is
> populated with seed types/flows and proven through three v2 pages
> (`/v2/work-items`, `/v2/portfolio-model`, `/v2/custom-fields`) wired to
> Next.js route handlers. This doc describes how the **production Go handlers**
> in `backend/internal/{workitems,portfolioitems,portfoliomodels,flows,...}`
> migrate off the renamed `obj_*` family in `mmff_vector` and onto
> `vector_artefacts`. No code in this plan has shipped yet — open it when you
> sit down to do the cutover; otherwise this is a sealed reference.

Cross-refs: [`c_schema.md`](c_schema.md) (live `mmff_vector` map),
[`c_polymorphic_writes.md`](c_polymorphic_writes.md) (writer-rules pattern),
[`c_c_schema_adoption_mirrors.md`](c_c_schema_adoption_mirrors.md) (the
analogous cross-DB mirror Phase-4 already built for `mmff_library`).

---

## What changed in the schema (Phase 1+2 recap)

The DB cleanup completed in `db/schema/122_drop_orphaned_tables.sql` and
`db/schema/123_rename_tables_to_obj_family.sql`:

- 11 zero-ref empty tables dropped (epics, item_field_*, notes, versions, …).
- 13 live tables renamed `o_*` / `portfolio_*` / `subscription_layers` →
  `obj_*` family. Catalog-only `ALTER TABLE … RENAME TO` — no rows rewritten.
- Backend Go and frontend TS swept against the rename map (~141 refs).
- `permissions.catalogue.go` retains the original permission **codes**
  (`portfolio_items.view`, `work_items.settings.edit`, etc.) — those are
  user-facing strings and were intentionally not renamed.

Tables now in scope of this cutover (production `mmff_vector`):

| `mmff_vector` (post-rename)       | What it stores                  |
|-----------------------------------|---------------------------------|
| `obj_work_items`                  | Stories / tasks / defects (work scope) |
| `obj_work_items_field_values`     | EAV custom-field values, work scope |
| `obj_field_templates`             | Bundles of fields per work-item type |
| `obj_field_template_fields`       | Slots in a template            |
| `obj_custom_field_lib`            | Workspace-wide custom-field catalogue |
| `obj_execution_types`             | System work-item types (US, DE, TA, TC) |
| `obj_execution_types_tenant`      | Tenant-defined work-item types  |
| `obj_execution_types_overrides`   | Tenant display overrides        |
| `obj_strategy_types`              | Strategy types (Theme, BO, Feature) |
| `obj_strategy_types_layers`       | Library-adopted strategy layers |
| `obj_portfolio_items`             | Strategy-scope artefacts        |
| `obj_flow_system`                 | Seeded flow definitions         |
| `obj_flow_tenant`                 | Tenant flow definitions         |

Seven discrete shapes — work items, field values, templates, library, type
registries (work + strategy), and flows.

---

## Target shape (`vector_artefacts`)

All seven shapes collapse onto **one polymorphic registry** (Jira pattern):

```
artefact_types (scope = work | strategy, source = system | tenant)
  ├── flows ─ flow_states ─ flow_transitions
  └── artefacts (id, type_id, parent, flow_state_id, core columns only)
        └── artefact_field_values (typed EAV: string/text/number/date/boolean)

field_library (workspace-wide catalogue — no per-type binding)
artefact_type_fields (binds field_library row → artefact_type, with required/position/default)

strategy_layers_adopted (audit lineage back to mmff_library.portfolio_model_layers)
```

Cross-DB references to `mmff_vector` (`subscription_id`, `workspace_id`,
`user_id`, `created_by`) are **soft FKs** validated at the application layer —
the same pattern already used by `subscription_layers` ↔ `mmff_library`.

---

## Old → new table map

| `mmff_vector.obj_*`               | `vector_artefacts`                                        | Notes |
|-----------------------------------|-----------------------------------------------------------|-------|
| `obj_work_items`                  | `artefacts` (filter: `artefact_types.scope = 'work'`)    | One row per work item; `parent_id` keeps hierarchy |
| `obj_portfolio_items`             | `artefacts` (filter: `artefact_types.scope = 'strategy'`)| Same table, `scope` discriminator |
| `obj_work_items_field_values`     | `artefact_field_values`                                   | Typed EAV — pivot value into the right `*_value` column |
| `obj_execution_types`             | `artefact_types` (`scope='work', source='system'`)        | US, DE, TA, TC |
| `obj_execution_types_tenant`      | `artefact_types` (`scope='work', source='tenant'`)        |  |
| `obj_strategy_types`              | `artefact_types` (`scope='strategy', source='tenant'`)    | Library-adopted rows have `source='tenant'` until system pre-seeds land |
| `obj_strategy_types_layers`       | `strategy_layers_adopted`                                 | Lineage to `mmff_library.portfolio_model_layers` |
| `obj_execution_types_overrides`   | (deferred — no equivalent yet)                            | Per-tenant display label overrides — bake into `artefact_types.name` at adoption time, or build later |
| `obj_custom_field_lib`            | `field_library`                                           | Identical shape; `field_name` slug + `field_type` |
| `obj_field_templates`             | (collapsed)                                               | The "template" concept disappears — a binding lives directly in `artefact_type_fields` |
| `obj_field_template_fields`       | `artefact_type_fields`                                    | One row per (artefact_type, field) binding with position/required/default |
| `obj_flow_system`                 | `flows` (+ `flow_states` + `flow_transitions`)            | Flatten into the 3-table flow model |
| `obj_flow_tenant`                 | `flows` (+ children)                                      | Same |

---

## Per-handler migration

Order is bottom-up in dependency: types & flows first (so artefacts can FK them),
then artefacts, then field plumbing.

### 1. `backend/internal/artefacttypes/`
Reads/writes `obj_execution_types`, `obj_execution_types_tenant`,
`obj_execution_types_overrides`. New target: `artefact_types` in
`vector_artefacts`, filter by `scope='work'`.

- Sole-writer rule: keep `artefacttypes.Service` as the only path; pivot the
  internal SQL string layer onto the new pool.
- `source='system'` rows replace `obj_execution_types`.
- `source='tenant'` rows replace `obj_execution_types_tenant`.
- Overrides: simplest cutover keeps the Go service surface but the persisted
  override goes onto `artefact_types.name` directly (no separate table).
  Document the loss of "see original system label" — it survives in
  `description` if needed.

### 2. `backend/internal/portfoliomodels/`
Currently writes `obj_strategy_types` + `obj_strategy_types_layers` (the
adoption mirror of an `mmff_library.portfolio_model` bundle).

- New target: `artefact_types` (`scope='strategy'`) + `strategy_layers_adopted`.
- The adoption-saga writer (`portfoliomodels.Adopt`) gains one extra step:
  for every adopted layer it inserts both the `artefact_types` row AND a
  `strategy_layers_adopted` row pointing back to the library layer id.
- Existing pending-cleanup-job pattern (`pending_library_cleanup_jobs`)
  unchanged — it still drives un-adoption rollback.

### 3. `backend/internal/flows/`
Reads/writes `obj_flow_system`, `obj_flow_tenant`. The current schema embeds
states + transitions inside the same `flows` row (jsonb). The new schema
splits them into `flows` + `flow_states` + `flow_transitions`.

- Cutover requires re-shaping: every flow becomes 1 row + N state rows + M
  transition rows.
- `flows.is_default` (PoC schema) replaces the older "default flow per type"
  convention captured by a separate column on `obj_execution_types`.
- Sole writer: `flows.Service` (already the boundary).

### 4. `backend/internal/portfolioitems/`
Reads/writes `obj_portfolio_items`. New target: `artefacts` (`scope='strategy'`
via `artefact_type_id`).

- Hierarchy column was `obj_portfolio_items.parent_id` (uuid) — same column
  exists on `artefacts.parent_artefact_id`.
- Type registry FK switches from `obj_strategy_types` to `artefact_types`.
- Ranking/position column survives unchanged.

### 5. `backend/internal/workitems/`
Reads/writes `obj_work_items`. New target: `artefacts` (`scope='work'`).

- Largest handler footprint (43 refs originally). Methods to migrate:
  Create, Get, List (with filters: `?owner_id=`, `?sort=`, `?status=`),
  Patch, Archive, Bulk operations.
- Sub-feature work in PLA-0021 (work-items tree, owner filter, sort
  whitelist) is built against the renamed `obj_work_items` — that work does
  NOT need to be redone after cutover; the SQL just retargets the new pool.
- Field-value reads currently join `obj_work_items_field_values` →
  `obj_custom_field_lib`. New join: `artefact_field_values` →
  `field_library`.

### 6. `backend/internal/customfields/` (and `app/(user)/workspace-settings/custom-fields/`)
Reads/writes `obj_custom_field_lib`, `obj_field_templates`,
`obj_field_template_fields`.

- New target: `field_library` + `artefact_type_fields`.
- The "template" concept disappears. UX implication: the existing template
  picker either becomes a multi-type picker or a thin grouping shim. Decide
  before cutover.
- Adoption count surfaced in the v2 PoC (`adoption_count` LEFT JOIN on
  `artefact_type_fields`) becomes the canonical metric — the production
  template-based equivalent (`template_field_count`) is dropped.

### 7. `backend/internal/searchworker/`
Currently registers the per-type artefact tables (`o_artefacts_execution_*`)
for indexing. After cutover those tables are empty and the registry can
collapse to one entry: `artefacts` with type-aware projection.

- The package's `worker.go` still references the legacy per-type tables; the
  Phase 1 drop list deferred them precisely because of this.
- Cutover step: rewrite the indexer to walk `artefacts` once, reading
  `artefact_types.scope/name` to decide the index document type.

---

## Backfill (one-shot ETL)

Per-table ETL scripts live as numbered files under
`db/artefacts_schema/cutover/` (does not exist yet — create when starting):

```
cutover/001_types_and_layers.sql
cutover/002_flows.sql
cutover/003_field_library.sql
cutover/004_artefact_type_fields.sql
cutover/005_artefacts_work.sql
cutover/006_artefacts_strategy.sql
cutover/007_field_values.sql
cutover/008_verify_counts.sql
```

Each is `INSERT INTO vector_artefacts.<target> SELECT … FROM
mmff_vector.obj_<source>` via `dblink` or `postgres_fdw`. Postgres does NOT
support cross-DB FKs, so:

- Run inside a **single Postgres session** with `dblink_connect` to
  `mmff_vector` and `vector_artefacts`.
- Or use `postgres_fdw` foreign tables for read-only mirrors of the source
  side, then plain `INSERT … SELECT`.

Recommended approach: `postgres_fdw`. It's already a project-known pattern
(`mmff_library` integration) and the INSERTs read like ordinary SQL.

ID handling: keep source UUIDs verbatim — every `mmff_vector.obj_*` row is
already keyed by `gen_random_uuid()` and there is no collision risk against
fresh `vector_artefacts` rows. This means downstream search indexes,
external integrations, and clipboard URLs all keep working post-cutover.

---

## Cutover modes (best → riskiest)

1. **Read-only freeze + one-shot copy + flip** *(safest, recommended)*
   - Set `mmff_vector` to read-only (revoke INSERT/UPDATE on the 13 tables
     for `mmff_dev`).
   - Run all 8 ETL files in sequence.
   - Verify with `008_verify_counts.sql` — row counts must match between
     source and target per (subscription_id, type) tuple.
   - Swap Go handlers' DB pool to `vector_artefacts`.
   - Restart backend.
   - Smoke-test through the (user) shell.
   - **If broken:** flip Go pool back, re-grant write to `obj_*`. Recovery is
     instant because no data moved.
   - **Window:** ~10 minutes of read-only.

2. **Dual-write + lazy cutover** *(more complex, no downtime)*
   - Add a writer shim in every Service that writes to both `obj_*` AND
     `artefacts/*` for every mutation.
   - Backfill in the background.
   - Switch readers over once verified.
   - Drop dual-write.
   - **Risk:** N×2 surface area for bugs; transactional consistency across
     two databases requires `dblink` or 2-phase commit. Not recommended for a
     hobby-funded project.

3. **Dual-database read fan-out** *(rejected)*
   - Read from both, merge in Go. Adds permanent complexity for no gain over
     option 1.

**Recommendation: option 1.** A 10-minute read-only window during a quiet
hour is acceptable; rollback is trivial; no permanent code shim.

---

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Cross-DB FK lost — `subscription_id`/`workspace_id` are soft pointers in `vector_artefacts` | Application-layer validation at every Service entry point; mirror the `subscription_layers` ↔ `mmff_library` writer-rules pattern |
| Search index drift — old per-type tables empty but registered | Update `searchworker.worker.go` registry in lockstep with cutover |
| Permission codes still reference old surface (`work_items.*`, `portfolio_items.*`) | These are user-facing strings, intentionally untouched; no action |
| Active sessions in flight during cutover | Read-only freeze visible to users only as 503 on writes for 10 min — acceptable |
| Library adoption rollback (pending_library_cleanup_jobs) targets `obj_strategy_types_layers` | New cleanup-job kind for `strategy_layers_adopted` rows; existing pending jobs at cutover time must be drained first |
| Custom-field templates UX disappears | Decide replacement UX (multi-type picker) **before** cutover, not during |
| Per-type artefact tables (`o_artefacts_execution_{defects,tasks,test_cases}*`) still compile-referenced by the deprecated `backend/internal/artefacts/` package | Delete that package + its routes + Samantha SDK entries in the same change; the tables are confirmed empty |

---

## Pre-cutover checklist

- [ ] Re-read this doc against the live state (it WILL drift).
- [ ] Verify `vector_artefacts` schema matches what the production Go would
      expect — diff `db/artefacts_schema/0*.sql` against the live DB.
- [ ] Pick the cutover window (low traffic; no overlap with other migrations).
- [ ] Snapshot `mmff_vector` (full pg_dump). Cheap insurance.
- [ ] Drain `pending_library_cleanup_jobs` to zero rows.
- [ ] Branch off `main` for the cutover work; keep the diff to:
      handlers (~7 packages), search worker, drop migration for `obj_*`.
- [ ] Decide custom-field templates UX replacement; ship it ahead of cutover
      so users don't notice the swap.
- [ ] Delete `backend/internal/artefacts/` package (now-orphan per-type
      handlers) — clears the last blocker for dropping per-type tables.

---

## Post-cutover

- Drop the 13 `obj_*` tables in a follow-up migration once the production
  pool has been on `vector_artefacts` for ≥7 days with no rollback signals.
- Drop the per-type tables (`o_artefacts_execution_{defects,tasks,test_cases}*`,
  `o_artefacts_strategic*`) at the same time.
- Update `c_schema.md` — remove the dropped tables, add a one-line pointer
  to the `vector_artefacts` schema doc (which lives in
  `db/artefacts_schema/`).
- Retire this file once the cutover is complete and verified.

---

## Appendix — what the v2 PoC pages already proved

Three v2 surfaces hit `vector_artefacts` directly via Next.js route handlers
(`/api/v2/*`) — they bypass the Go backend entirely and prove the schema is
sufficient for the production read/write surface.

| v2 surface           | API route                       | Tables touched                          |
|----------------------|---------------------------------|-----------------------------------------|
| `/v2/work-items`     | `/api/v2/work-items`            | `artefacts`, `artefact_types`, `flow_states` |
| `/v2/portfolio-model`| `/api/v2/strategy-types`        | `artefact_types`, `strategy_layers_adopted`  |
| `/v2/custom-fields`  | `/api/v2/field-library/[id]`    | `field_library`, `artefact_type_fields` |
| `/v2/compare`        | (iframe rig)                    | n/a — A/B comparison only |

The three pages collectively cover CRUD on every `vector_artefacts` table
that has user-facing semantics. What they do NOT cover (and the Go cutover
must build):

- Sprint / iteration fields on `artefacts` (currently work-items-only in
  PLA-0021 work).
- The ranking/position writer (`backend/internal/ranking/`) — its registry
  needs an entry for `artefacts` keyed by `(subscription_id, workspace_id,
  artefact_type_id)`.
- Bulk operations.
- The `entityrefs` cross-cutting service — currently keyed off the
  `*_kind` discriminator vocabulary; needs new vocabulary entries
  `'artefact_work'` and `'artefact_strategy'` (or one shared `'artefact'`
  with type-id resolution).
