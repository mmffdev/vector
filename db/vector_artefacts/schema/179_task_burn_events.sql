-- ============================================================
-- 179_task_burn_events.sql
--
-- Append-only event ledger for the TASK-count burndown
-- (engineering-team view). Records task lifecycle events
-- (added / removed / done / undone) against sprints, with a
-- remaining-count delta and a scope-count delta. A task's "size"
-- is always 1 — this ledger counts tasks, it does not weigh them.
--
-- WHY:
--   Sibling of sprint_burn_events (177). The task burndown is a
--   standalone engine (backend/internal/taskmetrics) replaying THIS
--   ledger. Tasks inherit sprint membership from their parent story;
--   a task burns at the engineer-owned "done" kind, NOT the
--   PO-owned "accepted" kind that drives sprint_burn_events.
--
-- IDEMPOTENCY:
--   CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
--
-- ROLLBACK:
--   Forward-only — drop task_burn_events manually if needed.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS task_burn_events (
  task_burn_events_id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_burn_events_id_sprint        uuid NOT NULL,
  task_burn_events_id_artefact      uuid NOT NULL,
  task_burn_events_event_type       text NOT NULL
    CHECK (task_burn_events_event_type IN
      ('added','removed','done','undone')),
  task_burn_events_remaining_delta  integer NOT NULL DEFAULT 0,
  task_burn_events_scope_delta      integer NOT NULL DEFAULT 0,
  task_burn_events_occurred_at      timestamptz NOT NULL DEFAULT now(),
  task_burn_events_id_actor         uuid,
  task_burn_events_id_workspace     uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_burn_events_sprint_time
  ON task_burn_events (task_burn_events_id_sprint, task_burn_events_occurred_at);

COMMIT;
