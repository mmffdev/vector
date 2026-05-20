-- ============================================================
-- 087_rename_milestones_to_convention_DOWN.sql
-- Rollback for 087_rename_milestones_to_convention.sql
-- ============================================================

BEGIN;

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_id_timebox_milestone_fkey
                   TO artefacts_timebox_milestone_id_fkey;
ALTER INDEX IF EXISTS artefacts_id_timebox_milestone_idx RENAME TO artefacts_timebox_milestone;
ALTER TABLE artefacts RENAME COLUMN artefacts_id_timebox_milestone TO timebox_milestone_id;

DROP TRIGGER IF EXISTS trg_timeboxes_milestones_touch_updated_at ON timeboxes_milestones;
DROP FUNCTION IF EXISTS fn_timeboxes_milestones_touch_updated_at();

CREATE OR REPLACE FUNCTION timebox_milestones_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.timeboxes_milestones_updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER timebox_milestones_set_updated_at
    BEFORE UPDATE ON timeboxes_milestones
    FOR EACH ROW EXECUTE FUNCTION timebox_milestones_set_updated_at();

ALTER TABLE timeboxes_milestones
    RENAME CONSTRAINT timeboxes_milestones_status_valid    TO timebox_milestones_status_valid;
ALTER TABLE timeboxes_milestones
    RENAME CONSTRAINT timeboxes_milestones_name_nonempty   TO timebox_milestones_name_nonempty;

ALTER INDEX IF EXISTS timeboxes_milestones_target_date      RENAME TO timebox_milestones_target_date;
ALTER INDEX IF EXISTS timeboxes_milestones_org_node         RENAME TO timebox_milestones_org_node;
ALTER INDEX IF EXISTS timeboxes_milestones_workspace_status RENAME TO timebox_milestones_workspace_status;
ALTER INDEX IF EXISTS timeboxes_milestones_workspace        RENAME TO timebox_milestones_workspace;
ALTER INDEX IF EXISTS timeboxes_milestones_subscription     RENAME TO timebox_milestones_subscription;

ALTER TABLE timeboxes_milestones RENAME COLUMN timeboxes_milestones_archived_at   TO archived_at;
ALTER TABLE timeboxes_milestones RENAME COLUMN timeboxes_milestones_updated_at    TO milestone_date_updated;
ALTER TABLE timeboxes_milestones RENAME COLUMN timeboxes_milestones_created_at    TO milestone_date_added;
ALTER TABLE timeboxes_milestones RENAME COLUMN timeboxes_milestones_position      TO position;
ALTER TABLE timeboxes_milestones RENAME COLUMN timeboxes_milestones_status        TO status;
ALTER TABLE timeboxes_milestones RENAME COLUMN timeboxes_milestones_date_target   TO milestone_date_target;
ALTER TABLE timeboxes_milestones RENAME COLUMN timeboxes_milestones_id_user_owner TO milestone_owner;
ALTER TABLE timeboxes_milestones RENAME COLUMN timeboxes_milestones_name          TO milestone_name;
ALTER TABLE timeboxes_milestones RENAME COLUMN timeboxes_milestones_description   TO milestone_description;
ALTER TABLE timeboxes_milestones RENAME COLUMN timeboxes_milestones_id_topology_node TO org_node_id;
ALTER TABLE timeboxes_milestones RENAME COLUMN timeboxes_milestones_id_workspace  TO workspace_id;
ALTER TABLE timeboxes_milestones RENAME COLUMN timeboxes_milestones_id_subscription TO subscription_id;
ALTER TABLE timeboxes_milestones RENAME COLUMN timeboxes_milestones_id            TO id;

ALTER TABLE timeboxes_milestones RENAME TO timebox_milestones;

COMMIT;
