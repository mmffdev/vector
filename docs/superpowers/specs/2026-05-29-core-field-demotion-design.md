# Core-field demotion + custom-fields catalogue cleanup — Design

**Date:** 2026-05-29
**Branch:** `main` (autonomous mode; user is off-platform but monitoring)
**Status:** Spec drafted from Rally + FE audit findings; baked-in design choices documented per section
**Origin:** User flagged that `blocked` + `blocked_reason` are core artefact fields appearing as catalogue entries; the catalogue has accumulated 44 active rows of which only 1 is legitimate custom.

---

## 1. Synopsis

The `artefacts_fields_library` catalogue accumulated 44 active rows over time, of which **39 are dead** (zero `artefacts_fields_values` references) and most are CORE artefact fields that drifted into the catalogue instead of being modelled as columns on the `artefacts` table. Rally cross-reference confirms 23 rows belong as core, only 1 is legitimately custom, 1 is a duplicate, and 14 are CORE-CANDIDATE / KEEP-CUSTOM pending more design.

This spec drives the cleanup in three migrations + a backend column-spec extension + a UI toggle for an "Include core fields" overview on the existing custom-fields grid. Test cruft is purged in a separate workstream with a test-helper fix so it stops accumulating.

---

## 2. Scope (baked-in decisions)

### What ships this round

1. **Archive (soft-delete) of 5 rows** that already have a matching core column on `artefacts`:
   - `blocked` → `artefacts_is_blocked` (bool, exists)
   - `blocked_reason` → `artefacts_blocked_reason` (text, exists)
   - `lidentifier_colour` → `artefacts_colour` (text, exists)
   - `us_estimate_points` → `artefacts_story_points` (int, exists)
   - `pi_strategic_item_type` → redundant with the `artefacts_types` registry (no new column; archive only — type discriminator already exists)

2. **Add 14 new core columns** to `artefacts` + archive the catalogue rows:
   - `defect_severity` → `artefacts_defect_severity` (text, nullable, CHECK constraint for allowed values)
   - `environment` → `artefacts_environment` (text, nullable)
   - `estimate_hours` → `artefacts_estimate_hours` (numeric, nullable)
   - `estimate_remaining` → `artefacts_estimate_remaining` (numeric, nullable)
   - `expedite` → `artefacts_is_expedite` (bool, not null, default false, indexed)
   - `notes` → `artefacts_notes` (text, nullable) + `artefacts_notes_doc` (jsonb, nullable) — mirrors description/description_doc pair
   - `pi_date_work_planned_finish` → `artefacts_planned_finish_date` (date, nullable)
   - `pi_date_work_planned_start` → `artefacts_planned_start_date` (date, nullable)
   - `pi_date_work_started` → `artefacts_actual_start_date` (date, nullable)
   - `pi_estimate_initial` → `artefacts_estimate_initial` (numeric, nullable)
   - `pi_estimate_updated` → `artefacts_estimate_updated` (numeric, nullable)
   - `pi_flow_state_change_date` → `artefacts_flow_state_changed_at` (timestamptz, nullable)
   - `pi_strategic_investment_group` → `artefacts_strategic_investment_group` (text, nullable)
   - `ready` → `artefacts_is_ready` (bool, not null, default false, indexed)
   - `us_affects_doc` → `artefacts_affects_doc` (bool, not null, default false)
   - `us_count_child_test_cases` → `artefacts_count_child_test_cases` (int, not null, default 0)
   - `us_defect_status` → `artefacts_defect_status` (text, nullable, CHECK constraint)

3. **Drop the duplicate:** `acceptance_criteria2` (textbox) gets archived. The richtext `acceptance_criteria` remains as the only legitimate custom field.

4. **Backend column-spec extension** in `backend/internal/artefactitems/columns.go` — add ColumnSpec entries for all 14 new columns so the column-picker surfaces them and the wire shape includes them.

5. **UI toggle "Custom only / All including core"** on `/workspace-admin/custom-fields`. Adds a Source column (CUSTOM / CORE). Default state is "Custom only" (matches today's view + Rick's "we need a table to also show the core fields" ask).

6. **Test cruft purge:** archive 19 `test_field_*` + `test_typechange_*` rows in the migration; fix `bindings_integration_test.go` test helper to clean up.

### What's deferred

- **Risk fields** (`risk_impact`, `risk_probability`, `risk_score`) — wait for PLA-0052 Risk artefact type. Stay as KEEP-CUSTOM in catalogue for now. File as **TD-RISKS-PROMOTE-WITH-PLA052**.
- **CORE-CANDIDATE rows** that need Rick's call before committing: `pi_date_work_accepted`, `pi_flow_state_change_owner` (needs user-id FK), `pi_lidentifier_labels` / `pi_lidentifier_tags` (join-table modelling), `pi_strategic_investment_weight`, `pi_value_stream_identifier`. File as **TD-CORE-CANDIDATE-FIELDS-PENDING-DESIGN**.
- **Genuinely custom** (per Rally audit): `browser`, `lidentifier_type`, `regression`, `steps_to_reproduce`, `us_count_child_defects`, `us_count_child_tasks` stay in the catalogue as legitimate custom fields. (Note: `us_count_*` ought to be derived/rolled up — flagged as TD if so.)
- **Inline-form wiring + grid renderers** for the 14 new columns — separate workstream. This spec ships the schema + ColumnSpec + the catalogue cleanup; the visual surfaces follow.
- **Custom-fields-in-grid (TD-OBJECTTREE-PICKER-CUSTOM-FIELDS)** — unchanged.

---

## 3. Domain rules

1. **Soft-delete only on the catalogue side.** Archive sets `artefacts_fields_library_archived_at = now()`. No hard DELETE — project pattern.
2. **The two acceptance_criteria rows differ by type** (richtext vs textbox). The label-collision unique constraint allows both because it keys on (subscription_id, label, field_type) WHERE scope='tenant'. Acceptable for the design — the constraint is doing what it's designed for, but the duplicate signal is the existence of a textbox `acceptance_criteria2` row that nobody intended. Archive it.
3. **No backfill of `artefacts_fields_values` to core columns** — there are ZERO values to migrate. Verified via the per-row `values_count` in the catalogue inventory.
4. **Indexes on new boolean core columns** — `is_expedite`, `is_ready`, `affects_doc` get partial WHERE indexes for "find expedited / ready / affects-doc" queries, mirroring the existing `idx_artefacts_id_subscription_blocked` pattern.
5. **CHECK constraints on new enums:** `defect_severity` and `defect_status` get CHECK constraints listing allowed values (mirror existing `artefacts_fields_library_field_type_chk`).
6. **Backend ColumnSpec parity required.** Every new core column gets a row in `columns.go::WorkItemColumnSpecs`. Without this, the column-picker won't surface them and the wire shape stays as-is.
7. **Service is the gate for write authorization** — workspace admin to manage catalogue; tenant admin for core schema. The migrations themselves don't change auth.

---

## 4. Architecture

### 4.1 Data model

Migration 146 — archive demoted catalogue rows (idempotent):

```sql
-- 146_demote_core_fields_archive_catalogue.sql
BEGIN;
UPDATE artefacts_fields_library
   SET artefacts_fields_library_archived_at = now(),
       artefacts_fields_library_updated_at  = now()
 WHERE artefacts_fields_library_archived_at IS NULL
   AND artefacts_fields_library_field_name IN (
     -- DEMOTE-EXISTING (5)
     'blocked', 'blocked_reason', 'lidentifier_colour',
     'us_estimate_points', 'pi_strategic_item_type',
     -- DEMOTE-NEW-COL (14)
     'defect_severity', 'environment', 'estimate_hours', 'estimate_remaining',
     'expedite', 'notes',
     'pi_date_work_planned_finish', 'pi_date_work_planned_start',
     'pi_date_work_started', 'pi_estimate_initial', 'pi_estimate_updated',
     'pi_flow_state_change_date', 'pi_strategic_investment_group',
     'ready', 'us_affects_doc', 'us_count_child_test_cases', 'us_defect_status',
     -- DROP (1)
     'acceptance_criteria2'
   );
COMMIT;
```

Migration 147 — add core columns to `artefacts`:

```sql
-- 147_artefacts_core_fields_from_demotion.sql
BEGIN;
ALTER TABLE artefacts
  ADD COLUMN IF NOT EXISTS artefacts_defect_severity            text,
  ADD COLUMN IF NOT EXISTS artefacts_environment                text,
  ADD COLUMN IF NOT EXISTS artefacts_estimate_hours             numeric,
  ADD COLUMN IF NOT EXISTS artefacts_estimate_remaining         numeric,
  ADD COLUMN IF NOT EXISTS artefacts_is_expedite                boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS artefacts_notes                      text,
  ADD COLUMN IF NOT EXISTS artefacts_notes_doc                  jsonb,
  ADD COLUMN IF NOT EXISTS artefacts_planned_finish_date        date,
  ADD COLUMN IF NOT EXISTS artefacts_planned_start_date         date,
  ADD COLUMN IF NOT EXISTS artefacts_actual_start_date          date,
  ADD COLUMN IF NOT EXISTS artefacts_estimate_initial           numeric,
  ADD COLUMN IF NOT EXISTS artefacts_estimate_updated           numeric,
  ADD COLUMN IF NOT EXISTS artefacts_flow_state_changed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS artefacts_strategic_investment_group text,
  ADD COLUMN IF NOT EXISTS artefacts_is_ready                   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS artefacts_affects_doc                boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS artefacts_count_child_test_cases     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS artefacts_defect_status              text;

-- Partial indexes for the new boolean flags (mirror idx_artefacts_id_subscription_blocked).
CREATE INDEX IF NOT EXISTS idx_artefacts_id_subscription_expedite
  ON artefacts (artefacts_id_subscription) WHERE artefacts_is_expedite = true AND artefacts_archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_artefacts_id_subscription_ready
  ON artefacts (artefacts_id_subscription) WHERE artefacts_is_ready    = true AND artefacts_archived_at IS NULL;

-- CHECK constraints on enum-shaped text columns.
ALTER TABLE artefacts
  ADD CONSTRAINT artefacts_defect_severity_chk
    CHECK (artefacts_defect_severity IS NULL OR artefacts_defect_severity = ANY (ARRAY['low','medium','high','critical']));
ALTER TABLE artefacts
  ADD CONSTRAINT artefacts_defect_status_chk
    CHECK (artefacts_defect_status   IS NULL OR artefacts_defect_status   = ANY (ARRAY['open','triaged','in_progress','fixed','verified','closed','wontfix','duplicate']));

COMMIT;
```

Migration 148 — purge test cruft (only the catalogue rows; values table is empty so no cascade concern):

```sql
-- 148_archive_integration_test_field_cruft.sql
BEGIN;
UPDATE artefacts_fields_library
   SET artefacts_fields_library_archived_at = now(),
       artefacts_fields_library_updated_at  = now()
 WHERE artefacts_fields_library_archived_at IS NULL
   AND (artefacts_fields_library_field_name LIKE 'test_field_%'
        OR artefacts_fields_library_field_name LIKE 'test_typechange_%');
COMMIT;
```

DOWN scripts mirror each mig but inverted: 146 DOWN sets archived_at back to NULL for the listed names; 147 DOWN drops the new columns; 148 DOWN sets archived_at back to NULL for the test_* names.

### 4.2 Backend

`backend/internal/artefactitems/columns.go` gets new `ColumnSpec` entries for each new core column. The ColumnSpec drives both `/work-items/columns` (read-side) and the wire DTO (write-side). New entries mirror the existing pattern for `blocked` / `blocked_reason` at lines 116-117 of that file (per FE audit).

`backend/internal/artefactitems/types.go` and `sql.go` need column additions in the SELECT list and the WorkItem struct so the wire shape carries the new fields. This is the largest backend surface change and is the bulk of the build work.

**Tests** for the backend changes mirror the existing column-coverage tests in `backend/internal/artefactitems/` — add cases asserting each new column is read/written via PATCH.

`backend/internal/fields/bindings_integration_test.go` gets the test-helper fix so future test runs don't accumulate zombie rows: at `t.Cleanup()` time, the helper deletes its own seed.

### 4.3 Frontend

**No new inline-form controls in this spec.** Wiring the 14 new core columns into the inline edit panel is its own workstream (the FE audit's "Need both inline-form AND grid" line). This spec ships the catalogue cleanup + schema + ColumnSpec, and the UI overview surface. Inline form wiring follows in a separate plan.

**Custom-fields overview UI** — minimal change. The existing `CustomFieldsAdapter` gets a new filter chip "Source" with options All / Custom / Core. When "All" or "Core" is selected, the adapter's `fetchPage` includes core-field rows synthesised from `backend/internal/artefactitems/columns.go::WorkItemColumnSpecs` (already on the wire via `/work-items/columns`). Source column renders a small pill.

The synthesised CORE rows are read-only — the adapter's `buildRowButtons` returns an empty array (no Edit / Archive) when `row.scope === '_core'` (a synthetic discriminator the adapter applies in `fetchPage`).

### 4.4 SY003 regen

REQUIRED post-migration (HARD RULE — substrate changed). Use the `<report> -sy` skill or POST directly to `/_site/admin/dev/reporting/`.

---

## 5. I/O contract — minimal change

No new endpoints. `/workspaces/{id}/fields` returns the same shape; the synthesised CORE rows are merged client-side by the adapter rather than wire-side. (Alternative: have the backend merge — cleaner but adds endpoint coupling. Client-side merge keeps the catalogue API pure-catalogue.)

`/work-items/columns` already returns the column-spec list; the new columns appear naturally.

---

## 6. Components (file plan)

### New
- `db/vector_artefacts/schema/146_demote_core_fields_archive_catalogue.sql` + DOWN
- `db/vector_artefacts/schema/147_artefacts_core_fields_from_demotion.sql` + DOWN
- `db/vector_artefacts/schema/148_archive_integration_test_field_cruft.sql` + DOWN

### Modified
- `backend/internal/artefactitems/columns.go` — 14 new `ColumnSpec` entries
- `backend/internal/artefactitems/types.go` — `WorkItem` struct fields for new columns
- `backend/internal/artefactitems/sql.go` — SELECT list + PATCH whitelists for new columns
- `backend/internal/artefactitems/service.go` — patch validation if the new columns have any business rules (most don't)
- `backend/internal/fields/bindings_integration_test.go` — `t.Cleanup()` purges seeded rows
- `app/components/ObjectTreeV2/adapters/customFieldsAdapter.tsx` — Source filter chip + synthesised core rows + readonly disposition
- `app/globals.css` — minor: `.source-pill--core` / `.source-pill--custom` if pills used

### Unchanged
- ResourceTree, OTV2 generic surface, inline edit form (those are separate workstreams)
- All test files for savedviews + fields service unit tests (catalogue-row archives don't break them)

---

## 7. Tests required

- `backend/internal/artefactitems/columns_test.go` — assert each new column appears in `WorkItemColumnSpecs` and round-trips via the wire DTO
- `backend/internal/artefactitems/service_test.go` — patch round-trip for each boolean + each text column
- Migration smoke: post-apply, query `\d artefacts` and assert each new column exists; query archived count and assert =20 (5 + 14 + 1)
- Frontend: no new tests (matches saved-views pattern — UI tested via smoke)

---

## 8. Constraints

- HARD RULE — never assume DB. All psql goes through `localhost:5435` tunnel on `vector_artefacts` only.
- HARD RULE — no destructive git.
- HARD RULE — SY003 regen post-migration.
- HARD RULE — Inspect git index before every commit.
- HARD RULE — "commit all = group them all" workstream rule.
- Soft-delete only; never hard-delete catalogue rows.

---

## 9. Backlog (TDs to file as part of this work)

- **TD-RISKS-PROMOTE-WITH-PLA052** — risk_impact/probability/score wait for PLA-0052 Risk artefact type; revisit when PLA-0052 ships.
- **TD-CORE-CANDIDATE-FIELDS-PENDING-DESIGN** — 6 candidates need Rick's call before promotion (pi_date_work_accepted, pi_flow_state_change_owner, pi_lidentifier_labels/tags, pi_strategic_investment_weight, pi_value_stream_identifier).
- **TD-DEFECT-CHILD-COUNT-DERIVED** — `us_count_child_defects` / `us_count_child_tasks` should likely be derived/rolled-up, not stored. Verify and decide.
- **TD-INLINE-FORM-NEW-CORE-COLUMNS** — wire the 14 new core columns into `<ArtefactInlineForm>` (next workstream after this lands).
- **TD-GRID-RENDERERS-CORE-BOOLEANS** — `<BlockedToggle>` is bespoke; generalise to a `<BooleanCell>` for ready/expedite/affects_doc grid renderers.

---

## 10. Change Log

- 2026-05-29 — Initial spec, autonomous-mode (user off-platform but watching).
