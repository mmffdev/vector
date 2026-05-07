-- ============================================================
-- MMFFDev - vector_artefacts: timebox_sprints (replaces sprints)
-- Migration 025 — applied on top of 024_artefact_types_placeholder.sql
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 025_timebox_sprints.sql
--
-- Drops the minimal sprints table (013) and rebuilds as timebox_sprints
-- with the full Sprint Setup column set: owner, suffix, cadence, scope,
-- velocity, estimate, creep counters, and the team-level org_node binding.
--
-- artefacts.sprint_id is renamed to artefacts.timebox_sprint_id and
-- repointed at the new table.
--
-- Sequencing invariant (Sprint B.start = Sprint A.end + 1 day, no overlaps)
-- is enforced at the DB level via an EXCLUDE constraint on
-- (workspace_id, org_node_id, daterange(start_date, end_date, '[]')).
-- The adjacent-day rule and naming/cadence logic live in the writer service.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- artefacts.sprint_id was wired in 012/013. Drop the FK + index, drop the
-- old sprints table, then we'll rename the column and repoint at the new one.
ALTER TABLE artefacts
    DROP CONSTRAINT IF EXISTS artefacts_sprint_id_fkey;

DROP INDEX IF EXISTS artefacts_sprint;

DROP TABLE IF EXISTS sprints;

CREATE TABLE timebox_sprints (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id             UUID        NOT NULL,
    workspace_id                UUID        NOT NULL,
    org_node_id                 UUID,

    sprint_name                 TEXT        NOT NULL,
    sprint_suffix               TEXT,
    sprint_owner                UUID,

    sprint_cadence_days         INTEGER     NOT NULL,
    sprint_date_start           DATE        NOT NULL,
    sprint_date_end             DATE        NOT NULL,

    sprint_scope                INTEGER     NOT NULL DEFAULT 0,
    sprint_velocity             INTEGER     NOT NULL DEFAULT 0,
    sprint_estimate             INTEGER     NOT NULL DEFAULT 0,
    sprint_creep_by_count       INTEGER     NOT NULL DEFAULT 0,
    sprint_creep_by_estimate    INTEGER     NOT NULL DEFAULT 0,

    status                      TEXT        NOT NULL DEFAULT 'planned',

    sprint_date_added           TIMESTAMPTZ NOT NULL DEFAULT now(),
    sprint_date_updated         TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at                 TIMESTAMPTZ,

    CONSTRAINT timebox_sprints_name_nonempty
        CHECK (length(btrim(sprint_name)) > 0),
    CONSTRAINT timebox_sprints_cadence_positive
        CHECK (sprint_cadence_days > 0),
    CONSTRAINT timebox_sprints_dates_valid
        CHECK (sprint_date_end >= sprint_date_start),
    CONSTRAINT timebox_sprints_status_valid
        CHECK (status IN ('planned','active','completed')),
    CONSTRAINT timebox_sprints_scope_nonneg
        CHECK (sprint_scope >= 0),
    CONSTRAINT timebox_sprints_velocity_nonneg
        CHECK (sprint_velocity >= 0),
    CONSTRAINT timebox_sprints_estimate_nonneg
        CHECK (sprint_estimate >= 0),

    -- No two live sprints in the same (workspace, team) may overlap on dates.
    -- archived_at IS NULL guards keep retired sprints out of the check.
    CONSTRAINT timebox_sprints_no_overlap
        EXCLUDE USING gist (
            workspace_id WITH =,
            org_node_id  WITH =,
            daterange(sprint_date_start, sprint_date_end, '[]') WITH &&
        ) WHERE (archived_at IS NULL AND org_node_id IS NOT NULL)
);

CREATE INDEX timebox_sprints_subscription
    ON timebox_sprints (subscription_id)
    WHERE archived_at IS NULL;

CREATE INDEX timebox_sprints_workspace
    ON timebox_sprints (workspace_id)
    WHERE archived_at IS NULL;

CREATE INDEX timebox_sprints_workspace_status
    ON timebox_sprints (workspace_id, status)
    WHERE archived_at IS NULL;

CREATE INDEX timebox_sprints_org_node
    ON timebox_sprints (org_node_id)
    WHERE archived_at IS NULL AND org_node_id IS NOT NULL;

CREATE INDEX timebox_sprints_dates
    ON timebox_sprints (workspace_id, sprint_date_start, sprint_date_end)
    WHERE archived_at IS NULL;

-- Reuse the shared trigger but bind it to sprint_date_updated.
CREATE OR REPLACE FUNCTION timebox_sprints_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.sprint_date_updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER timebox_sprints_set_updated_at
    BEFORE UPDATE ON timebox_sprints
    FOR EACH ROW EXECUTE FUNCTION timebox_sprints_set_updated_at();

-- Rename the artefacts column and repoint at the new table.
ALTER TABLE artefacts
    RENAME COLUMN sprint_id TO timebox_sprint_id;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_timebox_sprint_id_fkey
        FOREIGN KEY (timebox_sprint_id)
        REFERENCES timebox_sprints(id) ON DELETE SET NULL;

CREATE INDEX artefacts_timebox_sprint
    ON artefacts (timebox_sprint_id)
    WHERE archived_at IS NULL AND timebox_sprint_id IS NOT NULL;

COMMIT;
