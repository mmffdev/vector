-- ============================================================
-- MMFFDev - vector_artefacts: TD-SEED-FN-DRIFT pay-down
-- Migration 078 — drop dead seed_system_artefact_types() function
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 078_drop_dead_seed_system_artefact_types_function.sql
--
-- The function was created in mig 010 referencing pre-RF1.4.4 column names
-- (artefact_types, flow_states, flow_transitions, flows.is_default, plus
-- the original 4-state shape To Do/In Progress/Done/Cancelled). Migrations
-- 041 (state shape correction), 042 (kind-aligned pills), and 066 (column-
-- prefix sweep) corrected the data via direct INSERT/UPDATE but never
-- updated this function definition. The function is still resident in
-- Postgres but would fail on its next call (refs `artefact_types` which no
-- longer exists; the live table is `artefacts_types`, plural + prefixed
-- columns).
--
-- Verified 2026-05-16 (PLA-0052 Story 1 + this pay-down):
--   - grep across backend/, app/, dev/ finds only COMMENT references — no
--     Go or TS code calls the function at runtime.
--   - portfoliomodels.adopt_work_types reads system rows via
--     loadSystemWorkTypes() and mirrors them per workspace; tenant
--     provisioning uses migration-style direct inserts.
--   - The two SQL scripts that DO invoke the function
--     (014_seed_dev_artefact_types.sql + seed/01_work_items_fixture.sql)
--     are forward-only one-shots that already ran during dev setup.
--
-- DROP is the correct fix (per TD-SEED-FN-DRIFT pay-down option (a)). Any
-- future tenant provisioning that needs a seed should use the direct-INSERT
-- pattern established by migrations 041, 071, 073-077.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS seed_system_artefact_types(UUID);

-- Sanity check: function is gone.
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
      FROM pg_proc
     WHERE proname = 'seed_system_artefact_types';

    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Migration 078: expected 0 seed_system_artefact_types functions, found %', v_count;
    END IF;
END
$$;

COMMIT;
