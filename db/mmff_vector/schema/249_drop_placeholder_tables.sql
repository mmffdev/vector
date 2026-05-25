-- ============================================================
-- MMFFDev - Vector: Drop 6 placeholder/dead tables (PLA064 CUT1.1.1)
-- Migration 249 — applied on top of 248_nav_prefs_cascade_on_page_delete.sql
--
-- Drops the 6 PLACEHOLDER/DEAD tables flagged in SY003 (mmff_dev
-- dev_reports). All 6 have ZERO rows and were never wired into the
-- live data path. The remaining Go + SQL refs were cleaned up in
-- the same PR; see PLA064 CUT1.1.1 for the full audit.
--
-- Tables dropped:
--   workspace, portfolio, product, company_roadmap,
--   execution_item_types, subscriptions_item_type_icons
--
-- Order of operations:
--   1. Drop triggers dependent on the dispatch procs.
--   2. Drop the dispatch proc trigger functions.
--   3. Drop the dispatch procs (dispatch_polymorphic_parent,
--      dispatch_item_type_parent).
--   4. Drop the helper proc only used by execution_item_types.
--   5. Drop the 6 tables leaf → root (FK direction).
--
-- The dispatch procs (dispatch_polymorphic_parent +
-- dispatch_item_type_parent) and their trigger function
-- (trg_page_entity_refs_dispatch) were defined by mig 013 +
-- re-CREATE-OR-REPLACEd by mig 017 + mig 183. Their bodies
-- SELECT FROM the dead tables. Dropping the tables without
-- dropping the procs first would not error at table-drop time
-- (SQL function bodies are stored as text and only validated on
-- call) but would produce runtime errors on any write to
-- page_entity_refs — which is why the trigger must be removed.
--
-- The trg_entity_stakeholders_dispatch trigger mentioned in mig 013
-- was NOT installed in the live DB (pg_trigger shows no row for it);
-- only trg_page_entity_refs_dispatch exists. The DROP TRIGGER is
-- guarded with IF EXISTS.
--
-- execution_item_types_lock_name() is only called by a trigger on
-- execution_item_types itself — dropping that table drops its
-- triggers automatically, so the function can then be dropped
-- separately to clean up pg_proc.
-- ============================================================

BEGIN;

-- ── 1. Drop triggers that call the dispatch procs ────────────────────
DROP TRIGGER IF EXISTS trg_page_entity_refs_dispatch ON page_entity_refs;
DROP TRIGGER IF EXISTS trg_entity_stakeholders_dispatch ON entity_stakeholders;
DROP TRIGGER IF EXISTS trg_item_type_states_dispatch ON item_type_states;

-- ── 2. Drop trigger functions ─────────────────────────────────────────
-- trg_page_entity_refs_dispatch() is the trigger function (no args).
-- The two-arg dispatch_polymorphic_parent / dispatch_item_type_parent
-- are called FROM the trigger function body, not as triggers themselves.
DROP FUNCTION IF EXISTS trg_page_entity_refs_dispatch();
DROP FUNCTION IF EXISTS trg_item_type_states_dispatch();

-- ── 3. Drop the dispatch procs ────────────────────────────────────────
-- Match exact signatures from pg_proc.
DROP FUNCTION IF EXISTS dispatch_polymorphic_parent(text, uuid, OUT uuid, OUT timestamptz);
DROP FUNCTION IF EXISTS dispatch_item_type_parent(text, uuid, OUT uuid, OUT timestamptz);

-- ── 4. Drop the execution_item_types helper ───────────────────────────
-- This function is called by trg_execution_item_types_lock_name on
-- execution_item_types. We use CASCADE to drop the dependent trigger;
-- the table itself is dropped in step 5.
DROP FUNCTION IF EXISTS execution_item_types_lock_name() CASCADE;

-- ── 5. Drop the 6 placeholder tables (leaf → root per FK direction) ───
-- subscriptions_item_type_icons and execution_item_types have no
-- cross-dependencies with the portfolio stack, so they can go first.
DROP TABLE IF EXISTS subscriptions_item_type_icons;
DROP TABLE IF EXISTS execution_item_types;
-- product → portfolio, product → workspace; drop product before both.
DROP TABLE IF EXISTS product;
-- portfolio → workspace; drop portfolio before workspace.
DROP TABLE IF EXISTS portfolio;
-- workspace → company_roadmap; drop workspace before company_roadmap.
DROP TABLE IF EXISTS workspace;
DROP TABLE IF EXISTS company_roadmap;

-- ── 6. Record in schema_migrations ───────────────────────────────────
INSERT INTO schema_migrations (filename) VALUES ('249_drop_placeholder_tables.sql')
ON CONFLICT DO NOTHING;

COMMIT;
