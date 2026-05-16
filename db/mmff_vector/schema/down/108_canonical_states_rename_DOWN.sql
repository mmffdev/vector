-- ============================================================
-- DOWN: 108_canonical_states_rename.sql
-- Restores canonical_states to defined/in_progress and reverts
-- the execution_work_items flow names. Drops the seeded
-- execution_tasks flow.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Drop seeded execution_tasks flow rows
-- ============================================================
DELETE FROM o_flow_system f
USING       o_artefact_types_system t
WHERE       f.system_artefact_type_id = t.id
  AND       t.scope_key = 'execution_tasks';

-- ============================================================
-- 2. Restore old canonical codes alongside new ones
-- ============================================================
INSERT INTO canonical_states (code, label, clock_role, sort_order)
VALUES
    ('defined',     'Defined',     'none',         10),
    ('in_progress', 'In Progress', 'cycle_active', 30)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 3. Repoint flow rows back to the old codes
-- ============================================================
UPDATE o_flow_system SET canonical_code = 'defined'     WHERE canonical_code = 'backlog';
UPDATE o_flow_system SET canonical_code = 'in_progress' WHERE canonical_code = 'doing';

UPDATE o_flow_tenant SET canonical_code = 'defined'     WHERE canonical_code = 'backlog';
UPDATE o_flow_tenant SET canonical_code = 'in_progress' WHERE canonical_code = 'doing';

-- ============================================================
-- 4. Drop the new canonical codes
-- ============================================================
DELETE FROM canonical_states WHERE code IN ('backlog', 'doing');

-- ============================================================
-- 5. Restore execution_work_items flow names
-- ============================================================
UPDATE o_flow_system f
SET    name = 'Defined',
       description = 'Captured but not yet ready to start.'
FROM   o_artefact_types_system t
WHERE  f.system_artefact_type_id = t.id
  AND  t.scope_key = 'execution_work_items'
  AND  f.flow_position = 1;

UPDATE o_flow_system f
SET    name = 'To Do',
       description = 'Acceptance criteria met; ready for someone to pick up.'
FROM   o_artefact_types_system t
WHERE  f.system_artefact_type_id = t.id
  AND  t.scope_key = 'execution_work_items'
  AND  f.flow_position = 2;

COMMIT;
