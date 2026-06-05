-- ============================================================
-- 177_sprint_burn_events.sql
--
-- Append-only event ledger for the sprint-metrics engine: records
-- artefact lifecycle events (added / removed / accepted / unaccepted /
-- points_changed) against sprints, with point + scope deltas.
--
-- WHY:
--   First substrate piece of the sprint-metrics engine
--   (feature/sprint-metrics-engine). Burndown / scope-change metrics
--   are derived by replaying this ledger per sprint over time.
--
-- IDEMPOTENCY:
--   CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS — safe to
--   re-run. The table is append-only; the migration only creates
--   structure, no data writes.
--
-- ROLLBACK:
--   Forward-only — drop sprint_burn_events manually if needed
--   (no rows are load-bearing at creation time).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sprint_burn_events (
  sprint_burn_events_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_burn_events_id_sprint     uuid NOT NULL,
  sprint_burn_events_id_artefact   uuid NOT NULL,
  sprint_burn_events_event_type    text NOT NULL
    CHECK (sprint_burn_events_event_type IN
      ('added','removed','accepted','unaccepted','points_changed')),
  sprint_burn_events_points_delta  integer NOT NULL DEFAULT 0,
  sprint_burn_events_points_after  integer,
  sprint_burn_events_scope_delta   integer NOT NULL DEFAULT 0,
  sprint_burn_events_occurred_at   timestamptz NOT NULL DEFAULT now(),
  sprint_burn_events_id_actor      uuid,
  sprint_burn_events_id_workspace  uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sprint_burn_events_sprint_time
  ON sprint_burn_events (sprint_burn_events_id_sprint, sprint_burn_events_occurred_at);

COMMIT;
