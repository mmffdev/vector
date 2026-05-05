-- ============================================================
-- DOWN: 105_artefact_flow_states.sql
-- Drops both flow tables and removes the UUID column from
-- o_artefact_type_registry. Safe to run idempotently.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS o_subscription_artefact_flow CASCADE;
DROP TABLE IF EXISTS o_artefact_flow_default      CASCADE;

ALTER TABLE o_artefact_type_registry
    DROP CONSTRAINT IF EXISTS o_artefact_type_registry_id_unique;

ALTER TABLE o_artefact_type_registry
    DROP COLUMN IF EXISTS id;

COMMIT;
