-- ============================================================
-- MMFFDev - Vector: Execution core columns + Sprints
-- Migration 065 — applied on top of 064_custom_field_library.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 065_execution_core_columns.sql
--
-- Adds first-class filterable/sortable columns to all execution
-- artefact tables. These fields are universal — every team uses
-- them in list views, filter bars, and sort controls — so they
-- belong as core columns, not in field_values.
--
-- New table:
--   sprints — workspace iteration container
--
-- Core columns added:
--   work_items: status, priority, story_points, sprint_id
--   defects:    status, priority, severity, sprint_id
--   tasks:      status, priority, estimated_hours, sprint_id
--
-- Status enums per type:
--   work_items/epics: open | in_progress | done | cancelled
--   defects:          open | in_progress | resolved | closed | wont_fix
--   tasks:            open | in_progress | done | blocked
--
-- Priority (shared): critical | high | medium | low
-- Severity (defects only): blocker | major | minor | trivial
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Sprints
-- ============================================================

CREATE TABLE sprints (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    goal            TEXT,
    start_date      DATE,
    end_date        DATE,
    status          TEXT        NOT NULL DEFAULT 'planned',
    created_by      UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,

    CONSTRAINT sp_name_nonempty CHECK (length(btrim(name)) > 0),
    CONSTRAINT sp_status_valid  CHECK (status IN ('planned','active','completed')),
    CONSTRAINT sp_dates_valid   CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX idx_sp_sub
    ON sprints (subscription_id)
    WHERE archived_at IS NULL;

CREATE INDEX idx_sp_sub_status
    ON sprints (subscription_id, status)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_sp_updated_at
    BEFORE UPDATE ON sprints
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2. work_items core columns
--    Covers both stories and epics (item_type discriminator).
--    story_points is nullable — epics typically don't have points.
-- ============================================================

ALTER TABLE o_artefacts_execution_work_items
    ADD COLUMN status        TEXT     NOT NULL DEFAULT 'open',
    ADD COLUMN priority      TEXT,
    ADD COLUMN story_points  INTEGER,
    ADD COLUMN sprint_id     UUID     REFERENCES sprints(id) ON DELETE SET NULL;

ALTER TABLE o_artefacts_execution_work_items
    ADD CONSTRAINT o_wi_status_valid CHECK (
        status IN ('open','in_progress','done','cancelled')
    ),
    ADD CONSTRAINT o_wi_priority_valid CHECK (
        priority IS NULL OR priority IN ('critical','high','medium','low')
    ),
    ADD CONSTRAINT o_wi_story_points_nonneg CHECK (
        story_points IS NULL OR story_points >= 0
    );

CREATE INDEX idx_o_wi_status
    ON o_artefacts_execution_work_items (subscription_id, status)
    WHERE archived_at IS NULL;

CREATE INDEX idx_o_wi_sprint
    ON o_artefacts_execution_work_items (sprint_id)
    WHERE sprint_id IS NOT NULL;

CREATE INDEX idx_o_wi_priority
    ON o_artefacts_execution_work_items (subscription_id, priority)
    WHERE priority IS NOT NULL AND archived_at IS NULL;

-- ============================================================
-- 3. defects core columns
-- ============================================================

ALTER TABLE o_artefacts_execution_defects
    ADD COLUMN status    TEXT NOT NULL DEFAULT 'open',
    ADD COLUMN priority  TEXT,
    ADD COLUMN severity  TEXT,
    ADD COLUMN sprint_id UUID REFERENCES sprints(id) ON DELETE SET NULL;

ALTER TABLE o_artefacts_execution_defects
    ADD CONSTRAINT o_de_status_valid CHECK (
        status IN ('open','in_progress','resolved','closed','wont_fix')
    ),
    ADD CONSTRAINT o_de_priority_valid CHECK (
        priority IS NULL OR priority IN ('critical','high','medium','low')
    ),
    ADD CONSTRAINT o_de_severity_valid CHECK (
        severity IS NULL OR severity IN ('blocker','major','minor','trivial')
    );

CREATE INDEX idx_o_de_status
    ON o_artefacts_execution_defects (subscription_id, status)
    WHERE archived_at IS NULL;

CREATE INDEX idx_o_de_sprint
    ON o_artefacts_execution_defects (sprint_id)
    WHERE sprint_id IS NOT NULL;

CREATE INDEX idx_o_de_severity
    ON o_artefacts_execution_defects (subscription_id, severity)
    WHERE severity IS NOT NULL AND archived_at IS NULL;

-- ============================================================
-- 4. tasks core columns
--    estimated_hours as NUMERIC to allow half-hour precision.
-- ============================================================

ALTER TABLE o_artefacts_execution_tasks
    ADD COLUMN status           TEXT         NOT NULL DEFAULT 'open',
    ADD COLUMN priority         TEXT,
    ADD COLUMN estimated_hours  NUMERIC(6,1),
    ADD COLUMN sprint_id        UUID         REFERENCES sprints(id) ON DELETE SET NULL;

ALTER TABLE o_artefacts_execution_tasks
    ADD CONSTRAINT o_ta_status_valid CHECK (
        status IN ('open','in_progress','done','blocked')
    ),
    ADD CONSTRAINT o_ta_priority_valid CHECK (
        priority IS NULL OR priority IN ('critical','high','medium','low')
    ),
    ADD CONSTRAINT o_ta_estimated_hours_nonneg CHECK (
        estimated_hours IS NULL OR estimated_hours >= 0
    );

CREATE INDEX idx_o_ta_status
    ON o_artefacts_execution_tasks (subscription_id, status)
    WHERE archived_at IS NULL;

CREATE INDEX idx_o_ta_sprint
    ON o_artefacts_execution_tasks (sprint_id)
    WHERE sprint_id IS NOT NULL;

COMMIT;
