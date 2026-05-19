-- ============================================================
-- 068 — Generic ranking: position columns convention
--
-- Establishes the standard position-column shape used by every
-- orderable resource in the platform (work items, defects,
-- portfolio levels, library items, future ones).
--
-- Convention (memorise this — every adopter follows it):
--   • Two nullable INT columns per resource:
--       backlog_position  — populated when the row is unassigned
--                           to a sprint (lives in the org backlog)
--       sprint_position   — populated when the row IS in a sprint
--   • Exactly one of the two is non-NULL at any time. Enforced
--     by a CHECK constraint scoped to the row's sprint_id.
--   • Gap-based integers (gap = 100). Rebalance triggered when
--     any neighbour gap drops below 2.
--   • Indexes on (subscription_id, sprint_id, sprint_position)
--     and (subscription_id, backlog_position) for ordered scans.
--
-- This migration is the FIRST ADOPTER (work items). The rank
-- service / move endpoint / publish hook arrive in later
-- migrations and Go code (see story 00204+ in c_story_index.md).
-- ============================================================

BEGIN;

ALTER TABLE o_artefacts_execution_work_items
    ADD COLUMN backlog_position INT NULL,
    ADD COLUMN sprint_position  INT NULL;

-- One-of-two invariant: backlog_position iff sprint_id IS NULL,
-- sprint_position iff sprint_id IS NOT NULL. Allow both NULL on
-- legacy rows pre-backfill (migration 069 will populate); the
-- final NOT NULL tightening happens after backfill.
ALTER TABLE o_artefacts_execution_work_items
    ADD CONSTRAINT o_wi_position_scope CHECK (
        (sprint_id IS NULL     AND sprint_position IS NULL)
     OR (sprint_id IS NOT NULL AND backlog_position IS NULL)
    );

-- Ordered-scan indexes. Sprint-scope index includes sprint_id so
-- the planner can satisfy "list one sprint in order" with one
-- index range scan; backlog-scope skips sprint_id (always NULL).
CREATE INDEX idx_o_wi_sprint_position
    ON o_artefacts_execution_work_items (subscription_id, sprint_id, sprint_position)
    WHERE archived_at IS NULL AND sprint_id IS NOT NULL;

CREATE INDEX idx_o_wi_backlog_position
    ON o_artefacts_execution_work_items (subscription_id, backlog_position)
    WHERE archived_at IS NULL AND sprint_id IS NULL;

COMMIT;
