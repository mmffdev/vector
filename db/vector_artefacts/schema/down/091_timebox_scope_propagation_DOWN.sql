-- DOWN: 091_timebox_scope_propagation.sql
--
-- Drops the scope_propagation columns + their partial indexes on
-- timeboxes_sprints and timeboxes_releases. Idempotent.
--
-- Note: this is destructive — any row that was set to
-- 'this_node_and_descendants' loses that designation. The column is
-- recreatable from 091 UP but the per-row propagation choice is
-- not. Run this only when intentionally reverting the heartbeat
-- feature.

BEGIN;

DROP INDEX IF EXISTS idx_timeboxes_sprints_propagating;
DROP INDEX IF EXISTS idx_timeboxes_releases_propagating;

ALTER TABLE timeboxes_sprints
    DROP COLUMN IF EXISTS timeboxes_sprints_scope_propagation;

ALTER TABLE timeboxes_releases
    DROP COLUMN IF EXISTS timeboxes_releases_scope_propagation;

COMMIT;
