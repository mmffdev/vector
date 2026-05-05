-- ============================================================
-- MMFFDev - Vector: canonical_states rename + flow seed update
-- Migration 108 — applied on top of 107_flow_tables_rename.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 108_canonical_states_rename.sql
--
-- WHY ----------------------------------------------------------
-- The previous canonical_states vocabulary (defined / ready /
-- in_progress / completed / accepted) read close to Rally's Schedule
-- State language. To keep Vector's own voice we move to:
--   backlog / ready / doing / completed / accepted
--
-- This migration:
--   1. Renames two canonical_states rows in place
--      - defined     → backlog
--      - in_progress → doing
--   2. Reseeds o_flow_system rows for execution_work_items so the
--      bespoke names match the new vocabulary
--      (Defined → Backlog, Doing stays "Doing", To Do → Ready)
--
-- FK BEHAVIOUR --------------------------------------------------
-- The FKs from o_flow_system / o_flow_tenant to canonical_states
-- are ON DELETE RESTRICT, no ON UPDATE clause — Postgres defaults
-- ON UPDATE to NO ACTION. Because we don't have ON UPDATE CASCADE,
-- we update the children FIRST (or in the same transaction so the
-- deferred check passes). All FK constraints in this DB are
-- IMMEDIATE, so we update canonical_states first then update the
-- referencing rows in the same statement order using a CTE-style
-- pattern, with the constraint temporarily set to DEFERRABLE-style
-- behaviour via a single transaction.
--
-- Simpler approach used here: since there are only two canonical
-- code changes and they're in a single transaction, update the
-- child tables FIRST (mapping old → new), then update canonical_states.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Insert the new canonical codes alongside the old ones
-- (FK is ON UPDATE NO ACTION so we can't rename codes in place
--  while children reference them. Instead: add new, repoint
--  children, then drop old.)
-- ============================================================

INSERT INTO canonical_states (code, label, clock_role, sort_order)
VALUES
    ('backlog', 'Backlog', 'none',         10),
    ('doing',   'Doing',   'cycle_active', 30)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2. Repoint child rows from old codes to new codes
-- ============================================================

UPDATE o_flow_system SET canonical_code = 'backlog' WHERE canonical_code = 'defined';
UPDATE o_flow_system SET canonical_code = 'doing'   WHERE canonical_code = 'in_progress';

UPDATE o_flow_tenant SET canonical_code = 'backlog' WHERE canonical_code = 'defined';
UPDATE o_flow_tenant SET canonical_code = 'doing'   WHERE canonical_code = 'in_progress';

-- ============================================================
-- 3. Drop the old canonical codes now that no children reference them
-- ============================================================

DELETE FROM canonical_states WHERE code IN ('defined', 'in_progress');

-- Bump sort_order on the kept rows so the final ordering is:
--   10 backlog | 20 ready | 30 doing | 40 completed | 50 accepted
-- (already true; no-op sort fix here.)

-- ============================================================
-- 3. Reseed the execution_work_items default flow names
-- Position 2 was "To Do" — rename to "Ready" so the flow name
-- matches the canonical label. Position 1 ("Defined") becomes
-- "Backlog". Position 3 ("Doing") already matches.
-- ============================================================

UPDATE o_flow_system f
SET    name = 'Backlog',
       description = 'Captured but not yet ready to start.'
FROM   o_artefact_types_system t
WHERE  f.system_artefact_type_id = t.id
  AND  t.scope_key = 'execution_work_items'
  AND  f.flow_position = 1;

UPDATE o_flow_system f
SET    name = 'Ready',
       description = 'Acceptance criteria met; ready for someone to pick up.'
FROM   o_artefact_types_system t
WHERE  f.system_artefact_type_id = t.id
  AND  t.scope_key = 'execution_work_items'
  AND  f.flow_position = 2;

-- Position 3 (Doing), 4 (Completed), 5 (Accepted) already match.

-- ============================================================
-- 4. Seed default flow for execution_tasks
-- Tasks have a shorter 3-state flow:
--   1. Ready     → ready
--   2. Doing     → doing
--   3. Completed → completed
-- (No backlog because tasks are usually created already-ready;
--  no acceptance step because tasks are internal work units.)
-- ============================================================
INSERT INTO o_flow_system
    (system_artefact_type_id, flow_position, name, canonical_code, description)
SELECT t.id, v.flow_position, v.name, v.canonical_code, v.description
FROM   o_artefact_types_system t
CROSS  JOIN (VALUES
    (1, 'Ready',     'ready',     'Ready for someone to pick up.'),
    (2, 'Doing',     'doing',     'Actively being worked on.'),
    (3, 'Completed', 'completed', 'Task finished.')
) AS v(flow_position, name, canonical_code, description)
WHERE  t.scope_key = 'execution_tasks'
ON CONFLICT (system_artefact_type_id, flow_position) DO NOTHING;

COMMIT;
