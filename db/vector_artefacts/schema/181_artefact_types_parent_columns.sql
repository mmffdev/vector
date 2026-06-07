-- ============================================================
-- Migration 181: scoped parent-link columns on artefacts_types
--
-- WHY: the parent-nesting rule is split across an awkwardly-named DB column
-- (artefacts_types_id_parent_type — named for mechanism, not meaning) and a
-- hard-coded frontend constant (PARENT_PREFIX_MAP). This migration makes the
-- two parallel + scope-declaring:
--   strategy ladder  -> artefacts_types_strategy_parent_id      (rename; FK kept)
--   execution rule   -> artefacts_types_execution_parent_slots  (new TEXT[])
-- Spec: docs/superpowers/specs/2026-06-07-add-artefact-type-design.md §5.
--
-- The rename is behaviour-neutral (FK + ON DELETE RESTRICT retained). The new
-- column is backfilled from PARENT_PREFIX_MAP translated prefix->slot so the
-- resolver's behaviour is byte-for-byte unchanged for system work types.
--
-- IDEMPOTENCY: guarded with IF EXISTS / IF NOT EXISTS so a re-run is safe.
-- ROLLBACK: db/vector_artefacts/schema/down/181_artefact_types_parent_columns_DOWN.sql
-- ============================================================

BEGIN;

-- 1. Rename the strategy parent self-FK column (FK + constraint carry over).
ALTER TABLE artefacts_types
    RENAME COLUMN artefacts_types_id_parent_type TO artefacts_types_strategy_parent_id;

-- 2. Rename the supporting partial index to match (actual name verified
--    against pg_indexes 2026-06-07: idx_artefacts_types_id_parent_type).
ALTER INDEX IF EXISTS idx_artefacts_types_id_parent_type
    RENAME TO idx_artefacts_types_strategy_parent_id;

-- 3. Add the execution-scope allowed-parent slots column.
ALTER TABLE artefacts_types
    ADD COLUMN IF NOT EXISTS artefacts_types_execution_parent_slots TEXT[];

COMMENT ON COLUMN artefacts_types.artefacts_types_strategy_parent_id IS
    'Strategy ladder parent type (self-FK). One parent per strategy type. NULL for work types and the top-of-ladder strategy type.';
COMMENT ON COLUMN artefacts_types.artefacts_types_execution_parent_slots IS
    'Work-scope allowed-parent rule: list of parent type SLOTS (wrk_story, wrk_epic, ...) this work type may nest under. NULL/empty for strategy types. Soft refs, app-validated.';

-- 4. Backfill execution_parent_slots from the retired PARENT_PREFIX_MAP,
--    translated prefix->slot. Keyed by the canonical work slots so a gadmin
--    rename of a type's name/prefix cannot break the rule.
--    Feature is a strategy type; resolve its slot if present, else fall back
--    to prefix 'FE' (documented fallback — TD-RISK-WORK-PARENT-SLOTS sibling).
WITH feature_slot AS (
    SELECT COALESCE(
        (SELECT artefacts_types_slot FROM artefacts_types
          WHERE artefacts_types_scope = 'strategy'
            AND artefacts_types_prefix = 'FE'
            AND artefacts_types_archived_at IS NULL
          LIMIT 1),
        'FE'
    ) AS slot
)
UPDATE artefacts_types t SET artefacts_types_execution_parent_slots =
    CASE t.artefacts_types_slot
        WHEN 'wrk_task'   THEN ARRAY['wrk_defect','wrk_story']
        WHEN 'wrk_story'  THEN ARRAY[(SELECT slot FROM feature_slot),'wrk_epic']
        WHEN 'wrk_defect' THEN ARRAY['wrk_epic','wrk_story']
        WHEN 'wrk_epic'   THEN ARRAY[(SELECT slot FROM feature_slot)]
        ELSE t.artefacts_types_execution_parent_slots
    END
WHERE t.artefacts_types_scope = 'work'
  AND t.artefacts_types_slot IN ('wrk_task','wrk_story','wrk_defect','wrk_epic');

COMMIT;
