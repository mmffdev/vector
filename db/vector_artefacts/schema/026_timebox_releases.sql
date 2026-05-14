-- ============================================================
-- MMFFDev - vector_artefacts: timebox_releases
-- Migration 026 — applied on top of 025_timebox_sprints.sql
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 026_timebox_releases.sql
--
-- Adds timebox_releases — the release timebox kind, mirroring
-- timebox_sprints in structure. Releases do not enforce the
-- sprint adjacency rule, but do enforce non-overlapping date
-- ranges per (workspace, org_node) for live records.
--
-- Also adds artefacts.timebox_release_id FK column so artefacts
-- can be associated with a release.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE timebox_releases (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id             UUID        NOT NULL,
    workspace_id                UUID        NOT NULL,
    org_node_id                 UUID,

    release_name                TEXT        NOT NULL,
    release_suffix              TEXT,
    release_owner               UUID,

    release_cadence_days        INTEGER     NOT NULL DEFAULT 0,
    release_date_start          DATE        NOT NULL,
    release_date_end            DATE        NOT NULL,

    release_scope               INTEGER     NOT NULL DEFAULT 0,
    release_velocity            INTEGER     NOT NULL DEFAULT 0,
    release_estimate            INTEGER     NOT NULL DEFAULT 0,
    release_creep_by_count      INTEGER     NOT NULL DEFAULT 0,
    release_creep_by_estimate   INTEGER     NOT NULL DEFAULT 0,

    status                      TEXT        NOT NULL DEFAULT 'planned',

    release_date_added          TIMESTAMPTZ NOT NULL DEFAULT now(),
    release_date_updated        TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at                 TIMESTAMPTZ,

    CONSTRAINT timebox_releases_name_nonempty
        CHECK (length(btrim(release_name)) > 0),
    CONSTRAINT timebox_releases_cadence_nonneg
        CHECK (release_cadence_days >= 0),
    CONSTRAINT timebox_releases_dates_valid
        CHECK (release_date_end >= release_date_start),
    CONSTRAINT timebox_releases_status_valid
        CHECK (status IN ('planned','active','completed')),
    CONSTRAINT timebox_releases_scope_nonneg
        CHECK (release_scope >= 0),
    CONSTRAINT timebox_releases_velocity_nonneg
        CHECK (release_velocity >= 0),
    CONSTRAINT timebox_releases_estimate_nonneg
        CHECK (release_estimate >= 0),

    -- No two live releases in the same (workspace, team) may overlap on dates.
    CONSTRAINT timebox_releases_no_overlap
        EXCLUDE USING gist (
            workspace_id WITH =,
            org_node_id  WITH =,
            daterange(release_date_start, release_date_end, '[]') WITH &&
        ) WHERE (archived_at IS NULL AND org_node_id IS NOT NULL)
);

CREATE INDEX timebox_releases_subscription
    ON timebox_releases (subscription_id)
    WHERE archived_at IS NULL;

CREATE INDEX timebox_releases_workspace
    ON timebox_releases (workspace_id)
    WHERE archived_at IS NULL;

CREATE INDEX timebox_releases_workspace_status
    ON timebox_releases (workspace_id, status)
    WHERE archived_at IS NULL;

CREATE INDEX timebox_releases_org_node
    ON timebox_releases (org_node_id)
    WHERE archived_at IS NULL AND org_node_id IS NOT NULL;

CREATE INDEX timebox_releases_dates
    ON timebox_releases (workspace_id, release_date_start, release_date_end)
    WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION timebox_releases_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.release_date_updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER timebox_releases_set_updated_at
    BEFORE UPDATE ON timebox_releases
    FOR EACH ROW EXECUTE FUNCTION timebox_releases_set_updated_at();

-- Add release FK column to artefacts so items can be associated with a release.
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS timebox_release_id UUID REFERENCES timebox_releases(id) ON DELETE SET NULL;

CREATE INDEX artefacts_timebox_release
    ON artefacts (timebox_release_id)
    WHERE archived_at IS NULL AND timebox_release_id IS NOT NULL;

COMMIT;
