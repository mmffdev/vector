-- ============================================================
-- 085_timebox_milestones.sql
--
-- Adds timebox_milestones — the third leg of the timebox trio
-- alongside timebox_sprints (025) and timebox_releases (026).
--
-- Milestones differ from sprints/releases: they are point-in-time
-- markers (just a target date) rather than date ranges. No cadence,
-- no velocity, no creep counters, no overlap constraint.
--
-- Adds the FK constraint on artefacts.timebox_milestone_id (the
-- column itself was added in migration 084 as a forward-ref).
--
-- WHY:
--   The ArtefactInlineForm needs a Milestone dropdown alongside
--   Sprint and Release. No prior table existed; this migration
--   builds the minimum table + FK + indexes.
--
-- IDEMPOTENCY:
--   CREATE TABLE IF NOT EXISTS + DROP CONSTRAINT IF EXISTS guards.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/085_timebox_milestones_DOWN.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS timebox_milestones (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id             UUID        NOT NULL,
    workspace_id                UUID        NOT NULL,
    org_node_id                 UUID,

    milestone_name              TEXT        NOT NULL,
    milestone_description       TEXT,
    milestone_owner             UUID,

    -- Point-in-time marker, not a range.
    milestone_date_target       DATE        NOT NULL,

    status                      TEXT        NOT NULL DEFAULT 'planned',

    -- Ordering within (workspace, org_node) when several milestones
    -- share the same target date.
    position                    INTEGER     NOT NULL DEFAULT 0,

    milestone_date_added        TIMESTAMPTZ NOT NULL DEFAULT now(),
    milestone_date_updated      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at                 TIMESTAMPTZ,

    CONSTRAINT timebox_milestones_name_nonempty
        CHECK (length(btrim(milestone_name)) > 0),
    CONSTRAINT timebox_milestones_status_valid
        CHECK (status IN ('planned','active','completed','missed'))
);

CREATE INDEX IF NOT EXISTS timebox_milestones_subscription
    ON timebox_milestones (subscription_id)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS timebox_milestones_workspace
    ON timebox_milestones (workspace_id)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS timebox_milestones_workspace_status
    ON timebox_milestones (workspace_id, status)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS timebox_milestones_org_node
    ON timebox_milestones (org_node_id)
    WHERE archived_at IS NULL AND org_node_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS timebox_milestones_target_date
    ON timebox_milestones (workspace_id, milestone_date_target)
    WHERE archived_at IS NULL;

-- updated_at trigger (matches sprint/release convention).
CREATE OR REPLACE FUNCTION timebox_milestones_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.milestone_date_updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS timebox_milestones_set_updated_at ON timebox_milestones;
CREATE TRIGGER timebox_milestones_set_updated_at
    BEFORE UPDATE ON timebox_milestones
    FOR EACH ROW EXECUTE FUNCTION timebox_milestones_set_updated_at();

-- Bind the FK on artefacts (the column was added in 084 without a constraint).
ALTER TABLE artefacts
    DROP CONSTRAINT IF EXISTS artefacts_timebox_milestone_id_fkey;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_timebox_milestone_id_fkey
        FOREIGN KEY (timebox_milestone_id)
        REFERENCES timebox_milestones(id)
        ON DELETE SET NULL;

COMMIT;
