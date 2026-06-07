-- Migration 181 DOWN: revert scoped parent-link columns on artefacts_types.
BEGIN;

ALTER TABLE artefacts_types
    DROP COLUMN IF EXISTS artefacts_types_execution_parent_slots;

ALTER INDEX IF EXISTS idx_artefacts_types_strategy_parent_id
    RENAME TO idx_artefacts_types_id_parent_type;

ALTER TABLE artefacts_types
    RENAME COLUMN artefacts_types_strategy_parent_id TO artefacts_types_id_parent_type;

COMMIT;
