-- DOWN for 025_timebox_sprints.sql
-- Restores the minimal sprints table from migration 013 and repoints
-- artefacts.timebox_sprint_id back to artefacts.sprint_id -> sprints(id).
BEGIN;

ALTER TABLE artefacts
    DROP CONSTRAINT IF EXISTS artefacts_timebox_sprint_id_fkey;

DROP INDEX IF EXISTS artefacts_timebox_sprint;

ALTER TABLE artefacts
    RENAME COLUMN timebox_sprint_id TO sprint_id;

DROP TABLE IF EXISTS timebox_sprints;
DROP FUNCTION IF EXISTS timebox_sprints_set_updated_at();

CREATE TABLE sprints (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL,
    workspace_id    UUID        NOT NULL,
    name            TEXT        NOT NULL,
    goal            TEXT,
    start_date      DATE,
    end_date        DATE,
    status          TEXT        NOT NULL DEFAULT 'planned',
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,

    CONSTRAINT sprints_name_nonempty CHECK (length(btrim(name)) > 0),
    CONSTRAINT sprints_status_valid  CHECK (status IN ('planned','active','completed')),
    CONSTRAINT sprints_dates_valid   CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX sprints_subscription
    ON sprints (subscription_id)
    WHERE archived_at IS NULL;

CREATE INDEX sprints_workspace
    ON sprints (workspace_id)
    WHERE archived_at IS NULL;

CREATE INDEX sprints_subscription_status
    ON sprints (subscription_id, status)
    WHERE archived_at IS NULL;

CREATE TRIGGER sprints_set_updated_at
    BEFORE UPDATE ON sprints
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_sprint_id_fkey
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE SET NULL;

CREATE INDEX artefacts_sprint
    ON artefacts (sprint_id)
    WHERE archived_at IS NULL AND sprint_id IS NOT NULL;

COMMIT;
