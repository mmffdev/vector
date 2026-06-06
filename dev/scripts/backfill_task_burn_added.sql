-- backfill_task_burn_added.sql
--
-- One-time, idempotent backfill of the TASK-count burndown ledger
-- (vector_artefacts.task_burn_events) for TASK-tier artefacts whose parent
-- story is in a sprint. Sibling of backfill_sprint_burn_added.sql.
--
-- Why this is needed
-- ------------------
-- The task-count burndown (engineering-team view) emits its ledger only on
-- writes made AFTER the emission landed. Tasks already sitting under a sprinted
-- story emitted nothing, so the task burndown would start empty. This script
-- synthesises the missing `added` events (and `done` events for tasks already
-- completed) so the chart reflects current reality from day one.
--
-- Membership inheritance
-- ----------------------
-- A task's EFFECTIVE sprint is its PARENT STORY's sprint, never the task's own
-- sprint column. So the join is child task -> parent -> parent's sprint.
--
-- Semantics (mirror taskmetrics.DeriveTaskEvents)
-- ----------------------------------------------
--   'added'  : remaining_delta = scope_delta = 1, at the sprint START date
--              (committed baseline, visible from day 0).
--   'done'   : remaining_delta = -1, scope_delta = 0, at the task's
--              updated_at (best-effort done-date — flow_state_changed_at is
--              unpopulated in this substrate, so updated_at is the live signal;
--              falls back to sprint start only if updated_at is null).
--   id_actor = NULL (system backfill; column is nullable).
--
-- Idempotent: each INSERT skips tasks that already have the matching event.
-- Run order: BEGIN; <dry-run SELECTs>; <INSERTs>; verify; COMMIT/ROLLBACK.

-- ── 1. 'added' — one per task under a sprinted, non-archived story. ──────────
INSERT INTO task_burn_events (
  task_burn_events_id_sprint,
  task_burn_events_id_artefact,
  task_burn_events_event_type,
  task_burn_events_remaining_delta,
  task_burn_events_scope_delta,
  task_burn_events_occurred_at,
  task_burn_events_id_actor,
  task_burn_events_id_workspace
)
SELECT
  parent.artefacts_id_timebox_sprint,
  child.artefacts_id,
  'added',
  1,
  1,
  (s.timeboxes_sprints_date_start::timestamptz),
  NULL,
  child.artefacts_id_workspace
FROM artefacts child
JOIN artefacts parent
  ON parent.artefacts_id = child.artefacts_id_parent
JOIN artefacts_types t
  ON t.artefacts_types_id = child.artefacts_id_artefact_type
JOIN timeboxes_sprints s
  ON s.timeboxes_sprints_id = parent.artefacts_id_timebox_sprint
WHERE t.artefacts_types_slot = 'wrk_task'
  AND child.artefacts_archived_at IS NULL
  AND parent.artefacts_id_timebox_sprint IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM task_burn_events e
    WHERE e.task_burn_events_id_artefact = child.artefacts_id
      AND e.task_burn_events_event_type  = 'added'
  );

-- ── 2. 'done' — one per task currently at flow kind 'done'. ──────────────────
INSERT INTO task_burn_events (
  task_burn_events_id_sprint,
  task_burn_events_id_artefact,
  task_burn_events_event_type,
  task_burn_events_remaining_delta,
  task_burn_events_scope_delta,
  task_burn_events_occurred_at,
  task_burn_events_id_actor,
  task_burn_events_id_workspace
)
SELECT
  parent.artefacts_id_timebox_sprint,
  child.artefacts_id,
  'done',
  -1,
  0,
  COALESCE(child.artefacts_updated_at, s.timeboxes_sprints_date_start::timestamptz),
  NULL,
  child.artefacts_id_workspace
FROM artefacts child
JOIN artefacts parent
  ON parent.artefacts_id = child.artefacts_id_parent
JOIN artefacts_types t
  ON t.artefacts_types_id = child.artefacts_id_artefact_type
JOIN flows_states fs
  ON fs.flows_states_id = child.artefacts_id_flow_state
JOIN timeboxes_sprints s
  ON s.timeboxes_sprints_id = parent.artefacts_id_timebox_sprint
WHERE t.artefacts_types_slot = 'wrk_task'
  AND child.artefacts_archived_at IS NULL
  AND parent.artefacts_id_timebox_sprint IS NOT NULL
  AND fs.flows_states_kind = 'done'
  AND NOT EXISTS (
    SELECT 1 FROM task_burn_events e
    WHERE e.task_burn_events_id_artefact = child.artefacts_id
      AND e.task_burn_events_event_type  = 'done'
  );
