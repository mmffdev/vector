-- backfill_sprint_burn_added.sql
--
-- One-time, idempotent backfill of the sprint-metrics ledger
-- (vector_artefacts.sprint_burn_events) for STORY-TIER artefacts that were
-- assigned to a sprint BEFORE the tier-gate fix landed (2026-06-06).
--
-- Why this is needed
-- ------------------
-- The burn-event capture in artefactitems originally gated emission on
-- "IsAuthoritative = !hasLiveChildren". A Story with Task children was
-- therefore treated as non-authoritative and emitted NO `added` event when it
-- joined a sprint — leaving the burndown empty (Sprint 1 — Red: 8 stories /
-- 34 pts in-sprint, only 1 event captured). The fix replaces that gate with a
-- tier gate (Story / Defect / Risk are the sprint units; Epic + Task are not),
-- but it only affects writes made AFTER the restart. This script synthesises
-- the missing `added` events for items already in a sprint.
--
-- Semantics (mirror sprintmetrics.DeriveBurnEvents, the "added" branch)
-- --------------------------------------------------------------------
--   event_type   = 'added'
--   points_delta = scope_delta = points_after = artefacts_story_points (>=0)
--   occurred_at  = the SPRINT START date — these items are the committed
--                  baseline, so the burndown must show their scope from day 0,
--                  NOT as a mid-sprint scope bump at "today".
--   id_actor     = NULL (system backfill; the column is nullable)
--   id_workspace = the artefact's workspace (clamp parity with live capture)
--
-- Scope of rows
-- -------------
--   • Only slots wrk_story / wrk_defect / wrk_risk (the sprint units). Epics
--     and Tasks are intentionally excluded — they carry no committed scope.
--   • Only artefacts currently in a sprint and not archived.
--   • Only where NO event already exists for that (artefact, sprint) pair —
--     so re-running is a no-op (idempotent).
--
-- Run order: BEGIN; <dry-run SELECT>; <INSERT>; verify; COMMIT/ROLLBACK.
-- This file contains the INSERT only; run the dry-run SELECT separately first.

INSERT INTO sprint_burn_events (
  sprint_burn_events_id_sprint,
  sprint_burn_events_id_artefact,
  sprint_burn_events_event_type,
  sprint_burn_events_points_delta,
  sprint_burn_events_points_after,
  sprint_burn_events_scope_delta,
  sprint_burn_events_occurred_at,
  sprint_burn_events_id_actor,
  sprint_burn_events_id_workspace
)
SELECT
  a.artefacts_id_timebox_sprint,
  a.artefacts_id,
  'added',
  COALESCE(a.artefacts_story_points, 0),
  COALESCE(a.artefacts_story_points, 0),
  COALESCE(a.artefacts_story_points, 0),
  -- Sprint start at 00:00 UTC. dayOffset() buckets by whole days from start,
  -- so any time on the start date lands on day 0.
  (s.timeboxes_sprints_date_start::timestamptz),
  NULL,
  a.artefacts_id_workspace
FROM artefacts a
JOIN artefacts_types t
  ON t.artefacts_types_id = a.artefacts_id_artefact_type
JOIN timeboxes_sprints s
  ON s.timeboxes_sprints_id = a.artefacts_id_timebox_sprint
WHERE a.artefacts_id_timebox_sprint IS NOT NULL
  AND a.artefacts_archived_at IS NULL
  AND t.artefacts_types_slot IN ('wrk_story', 'wrk_defect', 'wrk_risk')
  AND NOT EXISTS (
    SELECT 1 FROM sprint_burn_events e
    WHERE e.sprint_burn_events_id_artefact = a.artefacts_id
      AND e.sprint_burn_events_id_sprint   = a.artefacts_id_timebox_sprint
  );
