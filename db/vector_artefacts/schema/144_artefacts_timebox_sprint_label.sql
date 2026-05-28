-- ============================================================
-- 144_artefacts_timebox_sprint_label.sql
--
-- Add denormalised sprint label column on artefacts + one-shot
-- backfill from the timeboxes_sprints join.
--
-- WHY:
--   The work-items grid renders a Sprint column per row. Today
--   every row pays for a LEFT JOIN against timeboxes_sprints to
--   resolve `<name> — <suffix>`; multiplied across List + Get +
--   ListChildren that's three live JOIN sites for one piece of
--   denormalised display text. Storing the full label on the
--   artefact row collapses the read-path to a single column read
--   and lets the per-artefact form render the same label without
--   a second round-trip. Writers (Patch sprint_id, Sprint rename,
--   Sprint suffix edit) update the label in lockstep — covered
--   by the Go service-layer fan-out, not this migration.
--
--   Format: '<name> — <suffix>' when suffix is non-empty after
--   trimming; '<name>' otherwise. Em-dash separator matches the
--   project's title-separator convention (used by the parent
--   summary cell, the duplicate-of suffix, etc.).
--
-- IDEMPOTENCY:
--   ADD COLUMN IF NOT EXISTS — re-run is a no-op even if the
--   column already exists. The backfill UPDATE rewrites the
--   column from current sprint state every run, so it's also
--   safe to re-apply — the result converges on the live JOIN.
--
-- ROLLBACK:
--   Forward-only. Reverting would require either dropping the
--   column (reversible) or restoring it to NULL across every row.
--   Drop is straightforward and lossless because the source data
--   still lives in timeboxes_sprints — see paired DOWN script
--   under schema/down/.
-- ============================================================

BEGIN;

ALTER TABLE artefacts
  ADD COLUMN IF NOT EXISTS artefacts_timebox_sprint_label TEXT NULL;

-- Backfill from the JOIN. Trim the suffix so a whitespace-only
-- value doesn't render as "Sprint 1 —  ". NULL stays NULL when
-- the artefact has no sprint assigned (LEFT JOIN drops to NULL,
-- the CASE preserves it).
UPDATE artefacts a
SET artefacts_timebox_sprint_label = CASE
    WHEN s.timeboxes_sprints_suffix IS NOT NULL
         AND length(btrim(s.timeboxes_sprints_suffix)) > 0
    THEN s.timeboxes_sprints_name || ' — ' || btrim(s.timeboxes_sprints_suffix)
    ELSE s.timeboxes_sprints_name
END
FROM timeboxes_sprints s
WHERE s.timeboxes_sprints_id = a.artefacts_id_timebox_sprint
  AND s.timeboxes_sprints_archived_at IS NULL;

-- Index — every read path filters/sorts on this implicitly via
-- the sprint_id; the label itself isn't a filter column, so no
-- index is added. (If/when sort-by-sprint-label lands, revisit.)

COMMIT;
