-- ============================================================
-- MMFFDev - vector_artefacts: sprints table + sprint_id FK
-- Migration 013 — applied on top of 012_artefacts_wire_field_columns.sql
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 013_sprints.sql
--
-- Creates the sprints table (iteration container) mirroring the
-- column shape of mmff_vector.sprints (065_execution_core_columns.sql)
-- with workspace_id added for the vector_artefacts intra-DB scope.
--
-- Converts artefacts.sprint_id (soft UUID from 012) into a hard FK
-- and adds the sprint partial index.
-- ============================================================

BEGIN;

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

-- Convert the soft UUID from 012 into a hard FK now that sprints exists.
ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_sprint_id_fkey
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE SET NULL;

-- Sprint-specific partial index on artefacts (placed here so FK already exists).
CREATE INDEX artefacts_sprint
    ON artefacts (sprint_id)
    WHERE archived_at IS NULL AND sprint_id IS NOT NULL;

COMMIT;
