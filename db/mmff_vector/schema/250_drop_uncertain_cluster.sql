-- ============================================================
-- MMFFDev - Vector: Drop UNCERTAIN cluster — obj_* + sprints (PLA064 CUT1.1.2)
-- Migration 250 — applied on top of 249_drop_placeholder_tables.sql
--
-- Drops the 4 tables flagged UNCERTAIN/PROBABLY-DEAD in SY003.
-- Pre-flight investigation results (all confirmed via live DB query):
--
--   obj_custom_field_lib (2 rows):
--     Rows are dev-seed debt from mig 064 / db/seed/002_work_items_poc.sql.
--     Zero live Go SQL queries touch this table (only doc comments in
--     backend/internal/artefactitems/types.go:354). The field library
--     concept migrated to vector_artefacts.artefacts_fields_library
--     (66 rows, fully wired). 'environment' field_name exists there;
--     'repro_steps' does not but has zero consumers. SAFE TO DROP.
--
--   obj_field_templates (1 row):
--     Dev-seed debt referencing obj_custom_field_lib. Zero live refs.
--     The work-item-template concept was never ported to vector_artefacts.
--     SAFE TO DROP.
--
--   obj_field_template_fields (2 rows):
--     Child of both obj_field_templates and obj_custom_field_lib.
--     Zero live refs. Must be dropped first (FK dependency). SAFE TO DROP.
--
--   sprints (10 rows):
--     Schema diverges completely from vector_artefacts.timeboxes_sprints
--     (column prefix convention, different field set). Zero ID overlap —
--     none of the 10 old rows appear in timeboxes_sprints by UUID.
--     Zero live Go SQL queries hit this table; the artefacts.sprint_id
--     FK has pointed to artefacts_id_timebox_sprint (timeboxes_sprints)
--     since the PLA-0023/PLA-0027 cutover. Zero artefacts in
--     vector_artefacts carry artefacts_id_timebox_sprint values
--     matching any old sprint UUID. The 10 rows are abandoned dev-session
--     artifacts (9 named "S-1", created 2026-05-06/07 in rapid succession).
--     No ETL needed — the data has no consumers. SAFE TO DROP.
--
-- Doc-comment drift in backend/internal/artefactitems/types.go (lines 321,
-- 354, 386, 400) left intentionally — comment cleanup is a separate story
-- (TD-ARTEFACTITEMS-LEGACY-COMMENTS). Out of scope for a substrate migration.
--
-- db/seed/002_work_items_poc.sql is retired alongside this migration.
-- The seed referenced sprints, o_execution_custom_field_library,
-- o_execution_work_item_templates, and o_execution_work_item_template_fields
-- (pre-mig-123 names) + o_artefacts_execution_work_items (pre-mig-123 name
-- for the table that became obj_work_items, then moved to vector_artefacts
-- as artefacts). The file was already fully broken before this migration.
-- ============================================================

BEGIN;

-- ── 1. Drop obj_field_template_fields first (FK references both sibling
--        tables — cascade would handle it but explicit ordering is clear) ──
DROP TABLE IF EXISTS obj_field_template_fields;

-- ── 2. Drop obj_field_templates (referenced by obj_field_template_fields) ──
DROP TABLE IF EXISTS obj_field_templates;

-- ── 3. Drop obj_custom_field_lib (referenced by obj_field_template_fields) ─
DROP TABLE IF EXISTS obj_custom_field_lib;

-- ── 4. Drop sprints (no FK dependents in mmff_vector) ────────────────────
DROP TABLE IF EXISTS sprints;

-- ── 5. Record in schema_migrations ───────────────────────────────────────
INSERT INTO schema_migrations (filename) VALUES ('250_drop_uncertain_cluster.sql')
ON CONFLICT DO NOTHING;

COMMIT;
