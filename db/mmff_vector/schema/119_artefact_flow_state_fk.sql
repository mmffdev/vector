-- ============================================================
-- MMFFDev - Vector: Artefact flow_state_id + defect_state_id FKs
-- Migration 119 — applied on top of 118_backfill_system_flows_to_tenants.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 119_artefact_flow_state_fk.sql
--
-- WHY ----------------------------------------------------------
-- Artefact tables (work_items, defects, tasks) carry a flat `status`
-- TEXT column with a per-table CHECK constraint (migration 065). The
-- frontend Status dropdown is hardcoded and disconnected from the flow
-- editor gadmins use in Workspace Settings.
--
-- The flow tables (o_flow_system, o_flow_tenant) already exist and are
-- seeded per subscription × artefact-type (migrations 105–118). This
-- migration adds the FK columns that make artefact rows point at them.
--
-- DEFECTS: TWO FLOWS -------------------------------------------
-- Defects have two distinct state machines, owned by different roles:
--
--   flow_state_id    → execution lifecycle (Backlog → Accepted)
--                      owned by the dev / engineer working the defect
--                      uses scope_key 'execution_defects' (existing)
--
--   defect_state_id  → QA / business lifecycle (Open → Closed)
--                      owned by QA and the business stakeholder
--                      uses scope_key 'execution_defect_state' (NEW)
--
-- Keeping these separate means:
--   - Gadmins can edit the two flows independently in Workspace Settings
--   - The UI can display/edit them in separate dropdowns
--   - Metrics can track QA cycle time independently of dev throughput
--   - Neither role's state machine is contaminated by the other's steps
--
-- The new 'execution_defect_state' type is flow-only — it has no
-- separate artefact table; it points at o_artefacts_execution_defects
-- as its host table (same physical rows, second flow dimension).
--
-- WHAT THIS DOES NOT DO ----------------------------------------
-- - Does NOT drop `status` TEXT column — kept as shadow for one release
--   while backend handlers and frontend move to flow_state_id.
--   Migration 120 will drop status once readers are migrated.
-- - Does NOT add transition-edge constraints per flow step.
-- - Does NOT wire subscription-create hook for new tenants.
--
-- SAFETY -------------------------------------------------------
-- Backfill uses position-1 ("Backlog" / "Open") for all rows.
-- An inline sanity check aborts if any row remains NULL.
-- A subscription-scope trigger guards against cross-tenant FK.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Register 'execution_defect_state' system type
--    Flow-only: same artefact_table as execution_defects but a
--    distinct scope_key so the two flows are independently editable.
-- ============================================================
INSERT INTO o_artefact_types_system
    (scope_key, artefact_table, default_prefix, display_label, display_label_plural, description, phase)
VALUES (
    'execution_defect_state',
    'o_artefacts_execution_defects',
    'DE',
    'Defect State',
    'Defect States',
    'QA and business-owner lifecycle for a defect (Open → Reproduced → Fixed → Verified → Closed / Won''t Fix). Separate from the dev execution flow.',
    'PH-0005'
)
ON CONFLICT (scope_key) DO NOTHING;

-- ============================================================
-- 2. Seed default defect_state flow into o_flow_system
-- ============================================================
INSERT INTO o_flow_system
    (system_artefact_type_id, flow_position, name, canonical_code, description)
SELECT t.id, v.flow_position, v.name, v.canonical_code, v.description
FROM   o_artefact_types_system t
CROSS  JOIN (VALUES
    (1, 'Open',       'backlog',   'Defect raised and awaiting triage.'),
    (2, 'Reproduced', 'ready',     'QA has confirmed the defect can be reproduced.'),
    (3, 'Fixed',      'doing',     'Developer has landed a fix; awaiting QA verification.'),
    (4, 'Verified',   'completed', 'QA has verified the fix is correct.'),
    (5, 'Closed',     'accepted',  'Defect formally closed after verification.'),
    (6, 'Won''t Fix', 'accepted',  'Accepted as a known issue; will not be fixed.')
) AS v(flow_position, name, canonical_code, description)
WHERE  t.scope_key = 'execution_defect_state'
ON CONFLICT (system_artefact_type_id, flow_position) DO NOTHING;

-- ============================================================
-- 3. Backfill o_flow_tenant with defect_state flow for every
--    existing subscription (mirrors migration 118 pattern).
-- ============================================================
INSERT INTO o_flow_tenant
    (subscription_id, system_artefact_type_id, flow_position, name, canonical_code, description)
SELECT s.id, fs.system_artefact_type_id, fs.flow_position, fs.name, fs.canonical_code, fs.description
FROM   subscriptions s
CROSS  JOIN o_flow_system fs
JOIN   o_artefact_types_system ats ON ats.id = fs.system_artefact_type_id
WHERE  ats.scope_key = 'execution_defect_state'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. Add flow_state_id to work_items + backfill to position 1
--    (epics and stories share this flow via item_type discriminator)
-- ============================================================
ALTER TABLE o_artefacts_execution_work_items
    ADD COLUMN flow_state_id UUID
        REFERENCES o_flow_tenant(id) ON DELETE RESTRICT;

UPDATE o_artefacts_execution_work_items wi
SET    flow_state_id = ft.id
FROM   o_flow_tenant ft
JOIN   o_artefact_types_system ats ON ats.id = ft.system_artefact_type_id
WHERE  ats.scope_key      = 'execution_work_items'
  AND  ft.subscription_id = wi.subscription_id
  AND  ft.flow_position   = 1
  AND  ft.archived_at     IS NULL;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT COUNT(*) INTO n FROM o_artefacts_execution_work_items WHERE flow_state_id IS NULL;
    IF n > 0 THEN
        RAISE EXCEPTION 'Migration 119: % work_item rows have NULL flow_state_id after backfill', n;
    END IF;
END $$;

ALTER TABLE o_artefacts_execution_work_items
    ALTER COLUMN flow_state_id SET NOT NULL;

CREATE INDEX idx_o_wi_flow_state
    ON o_artefacts_execution_work_items (flow_state_id);

-- ============================================================
-- 5. Add flow_state_id + defect_state_id to defects + backfill both
-- ============================================================
ALTER TABLE o_artefacts_execution_defects
    ADD COLUMN flow_state_id   UUID REFERENCES o_flow_tenant(id) ON DELETE RESTRICT,
    ADD COLUMN defect_state_id UUID REFERENCES o_flow_tenant(id) ON DELETE RESTRICT;

-- 5a. flow_state_id (dev execution lifecycle)
UPDATE o_artefacts_execution_defects de
SET    flow_state_id = ft.id
FROM   o_flow_tenant ft
JOIN   o_artefact_types_system ats ON ats.id = ft.system_artefact_type_id
WHERE  ats.scope_key      = 'execution_defects'
  AND  ft.subscription_id = de.subscription_id
  AND  ft.flow_position   = 1
  AND  ft.archived_at     IS NULL;

-- 5b. defect_state_id (QA / business lifecycle)
UPDATE o_artefacts_execution_defects de
SET    defect_state_id = ft.id
FROM   o_flow_tenant ft
JOIN   o_artefact_types_system ats ON ats.id = ft.system_artefact_type_id
WHERE  ats.scope_key      = 'execution_defect_state'
  AND  ft.subscription_id = de.subscription_id
  AND  ft.flow_position   = 1
  AND  ft.archived_at     IS NULL;

DO $$
DECLARE nf BIGINT; nd BIGINT;
BEGIN
    SELECT COUNT(*) INTO nf FROM o_artefacts_execution_defects WHERE flow_state_id   IS NULL;
    SELECT COUNT(*) INTO nd FROM o_artefacts_execution_defects WHERE defect_state_id IS NULL;
    IF nf > 0 THEN
        RAISE EXCEPTION 'Migration 119: % defect rows have NULL flow_state_id after backfill', nf;
    END IF;
    IF nd > 0 THEN
        RAISE EXCEPTION 'Migration 119: % defect rows have NULL defect_state_id after backfill', nd;
    END IF;
END $$;

ALTER TABLE o_artefacts_execution_defects
    ALTER COLUMN flow_state_id   SET NOT NULL,
    ALTER COLUMN defect_state_id SET NOT NULL;

CREATE INDEX idx_o_de_flow_state
    ON o_artefacts_execution_defects (flow_state_id);

CREATE INDEX idx_o_de_defect_state
    ON o_artefacts_execution_defects (defect_state_id);

-- ============================================================
-- 6. Add flow_state_id to tasks + backfill to position 1
-- ============================================================
ALTER TABLE o_artefacts_execution_tasks
    ADD COLUMN flow_state_id UUID
        REFERENCES o_flow_tenant(id) ON DELETE RESTRICT;

UPDATE o_artefacts_execution_tasks ta
SET    flow_state_id = ft.id
FROM   o_flow_tenant ft
JOIN   o_artefact_types_system ats ON ats.id = ft.system_artefact_type_id
WHERE  ats.scope_key      = 'execution_tasks'
  AND  ft.subscription_id = ta.subscription_id
  AND  ft.flow_position   = 1
  AND  ft.archived_at     IS NULL;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT COUNT(*) INTO n FROM o_artefacts_execution_tasks WHERE flow_state_id IS NULL;
    IF n > 0 THEN
        RAISE EXCEPTION 'Migration 119: % task rows have NULL flow_state_id after backfill', n;
    END IF;
END $$;

ALTER TABLE o_artefacts_execution_tasks
    ALTER COLUMN flow_state_id SET NOT NULL;

CREATE INDEX idx_o_ta_flow_state
    ON o_artefacts_execution_tasks (flow_state_id);

-- ============================================================
-- 7. Subscription-scope guard trigger (shared function)
--    Prevents a row in subscription A from pointing at a flow
--    state that belongs to subscription B.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_check_flow_state_subscription()
RETURNS TRIGGER AS $$
DECLARE
    fs_sub UUID;
BEGIN
    SELECT subscription_id INTO fs_sub
    FROM   o_flow_tenant
    WHERE  id = NEW.flow_state_id;

    IF fs_sub IS DISTINCT FROM NEW.subscription_id THEN
        RAISE EXCEPTION
            'flow_state_id % belongs to subscription %, but artefact is in subscription %',
            NEW.flow_state_id, fs_sub, NEW.subscription_id;
    END IF;

    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_check_defect_state_subscription()
RETURNS TRIGGER AS $$
DECLARE
    ds_sub UUID;
BEGIN
    SELECT subscription_id INTO ds_sub
    FROM   o_flow_tenant
    WHERE  id = NEW.defect_state_id;

    IF ds_sub IS DISTINCT FROM NEW.subscription_id THEN
        RAISE EXCEPTION
            'defect_state_id % belongs to subscription %, but artefact is in subscription %',
            NEW.defect_state_id, ds_sub, NEW.subscription_id;
    END IF;

    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_o_wi_flow_state_sub_guard
    BEFORE INSERT OR UPDATE OF flow_state_id, subscription_id
    ON o_artefacts_execution_work_items
    FOR EACH ROW EXECUTE FUNCTION fn_check_flow_state_subscription();

CREATE TRIGGER trg_o_de_flow_state_sub_guard
    BEFORE INSERT OR UPDATE OF flow_state_id, subscription_id
    ON o_artefacts_execution_defects
    FOR EACH ROW EXECUTE FUNCTION fn_check_flow_state_subscription();

CREATE TRIGGER trg_o_de_defect_state_sub_guard
    BEFORE INSERT OR UPDATE OF defect_state_id, subscription_id
    ON o_artefacts_execution_defects
    FOR EACH ROW EXECUTE FUNCTION fn_check_defect_state_subscription();

CREATE TRIGGER trg_o_ta_flow_state_sub_guard
    BEFORE INSERT OR UPDATE OF flow_state_id, subscription_id
    ON o_artefacts_execution_tasks
    FOR EACH ROW EXECUTE FUNCTION fn_check_flow_state_subscription();

-- Legacy `status` column retained — see header. Migration 120 drops it.

-- schema_migrations is managed by the Go runner; no manual insert needed.

COMMIT;
