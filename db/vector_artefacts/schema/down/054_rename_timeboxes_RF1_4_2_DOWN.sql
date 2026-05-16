-- ============================================================
-- MMFFDev - vector_artefacts: RF1.4.2.timeboxes DOWN
-- Reverses migration 054. Restores the table/column/index/constraint
-- names from BEFORE the convention sweep. Manual apply via psql; the
-- runner skips this directory by design.
--
-- Run only against a restored / pre-054 snapshot. After applying, also
-- DELETE FROM schema_migrations WHERE filename = '054_rename_timeboxes_RF1_4_2.sql';
-- ============================================================

BEGIN;

-- artefacts FK constraint names back to original.
ALTER TABLE artefacts RENAME CONSTRAINT artefacts_id_timebox_sprint_fkey
                                     TO artefacts_timebox_sprint_id_fkey;
DO $$
DECLARE
    fk_name text;
BEGIN
    SELECT conname INTO fk_name
      FROM pg_constraint
     WHERE conrelid = 'artefacts'::regclass
       AND contype  = 'f'
       AND conname = 'artefacts_id_timebox_release_fkey';
    IF fk_name IS NOT NULL THEN
        ALTER TABLE artefacts RENAME CONSTRAINT artefacts_id_timebox_release_fkey
                                             TO artefacts_timebox_release_id_fkey;
    END IF;
END $$;

-- Indexes.
ALTER INDEX artefacts_id_timebox_sprint  RENAME TO artefacts_timebox_sprint;
ALTER INDEX artefacts_id_timebox_release RENAME TO artefacts_timebox_release;

ALTER INDEX timeboxes_releases_dates            RENAME TO timebox_releases_dates;
ALTER INDEX timeboxes_releases_topology_node    RENAME TO timebox_releases_org_node;
ALTER INDEX timeboxes_releases_workspace_status RENAME TO timebox_releases_workspace_status;
ALTER INDEX timeboxes_releases_workspace        RENAME TO timebox_releases_workspace;
ALTER INDEX timeboxes_releases_subscription     RENAME TO timebox_releases_subscription;

ALTER INDEX timeboxes_sprints_dates             RENAME TO timebox_sprints_dates;
ALTER INDEX timeboxes_sprints_topology_node     RENAME TO timebox_sprints_org_node;
ALTER INDEX timeboxes_sprints_workspace_status  RENAME TO timebox_sprints_workspace_status;
ALTER INDEX timeboxes_sprints_workspace         RENAME TO timebox_sprints_workspace;
ALTER INDEX timeboxes_sprints_subscription      RENAME TO timebox_sprints_subscription;

-- Constraints.
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timeboxes_releases_no_overlap        TO timebox_releases_no_overlap;
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timeboxes_releases_estimate_nonneg   TO timebox_releases_estimate_nonneg;
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timeboxes_releases_velocity_nonneg   TO timebox_releases_velocity_nonneg;
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timeboxes_releases_scope_nonneg      TO timebox_releases_scope_nonneg;
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timeboxes_releases_status_valid      TO timebox_releases_status_valid;
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timeboxes_releases_dates_valid       TO timebox_releases_dates_valid;
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timeboxes_releases_cadence_nonneg    TO timebox_releases_cadence_nonneg;
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timeboxes_releases_name_nonempty     TO timebox_releases_name_nonempty;

ALTER TABLE timeboxes_sprints  RENAME CONSTRAINT timeboxes_sprints_no_overlap         TO timebox_sprints_no_overlap;
ALTER TABLE timeboxes_sprints  RENAME CONSTRAINT timeboxes_sprints_estimate_nonneg    TO timebox_sprints_estimate_nonneg;
ALTER TABLE timeboxes_sprints  RENAME CONSTRAINT timeboxes_sprints_velocity_nonneg    TO timebox_sprints_velocity_nonneg;
ALTER TABLE timeboxes_sprints  RENAME CONSTRAINT timeboxes_sprints_scope_nonneg       TO timebox_sprints_scope_nonneg;
ALTER TABLE timeboxes_sprints  RENAME CONSTRAINT timeboxes_sprints_status_valid       TO timebox_sprints_status_valid;
ALTER TABLE timeboxes_sprints  RENAME CONSTRAINT timeboxes_sprints_dates_valid        TO timebox_sprints_dates_valid;
ALTER TABLE timeboxes_sprints  RENAME CONSTRAINT timeboxes_sprints_cadence_positive   TO timebox_sprints_cadence_positive;
ALTER TABLE timeboxes_sprints  RENAME CONSTRAINT timeboxes_sprints_name_nonempty      TO timebox_sprints_name_nonempty;

-- Triggers + functions.
DROP TRIGGER IF EXISTS timeboxes_sprints_set_updated_at  ON timeboxes_sprints;
DROP TRIGGER IF EXISTS timeboxes_releases_set_updated_at ON timeboxes_releases;

ALTER FUNCTION timeboxes_sprints_set_updated_at()  RENAME TO timebox_sprints_set_updated_at;
ALTER FUNCTION timeboxes_releases_set_updated_at() RENAME TO timebox_releases_set_updated_at;

CREATE OR REPLACE FUNCTION timebox_sprints_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.sprint_date_updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION timebox_releases_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.release_date_updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- artefacts FK columns.
ALTER TABLE artefacts RENAME COLUMN artefacts_id_timebox_release TO timebox_release_id;
ALTER TABLE artefacts RENAME COLUMN artefacts_id_timebox_sprint  TO timebox_sprint_id;

-- Releases columns.
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_archived_at         TO archived_at;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_updated_at          TO release_date_updated;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_created_at          TO release_date_added;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_status              TO status;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_creep_by_estimate   TO release_creep_by_estimate;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_creep_by_count      TO release_creep_by_count;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_estimate            TO release_estimate;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_velocity            TO release_velocity;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_scope               TO release_scope;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_date_end            TO release_date_end;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_date_start          TO release_date_start;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_cadence_days        TO release_cadence_days;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_id_user_owner       TO release_owner;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_suffix              TO release_suffix;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_name                TO release_name;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_id_topology_node    TO org_node_id;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_id_workspace        TO workspace_id;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_id_subscription     TO subscription_id;
ALTER TABLE timeboxes_releases RENAME COLUMN timeboxes_releases_id                  TO id;

-- Sprints columns.
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_archived_at         TO archived_at;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_updated_at          TO sprint_date_updated;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_created_at          TO sprint_date_added;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_status              TO status;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_creep_by_estimate   TO sprint_creep_by_estimate;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_creep_by_count      TO sprint_creep_by_count;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_estimate            TO sprint_estimate;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_velocity            TO sprint_velocity;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_scope               TO sprint_scope;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_date_end            TO sprint_date_end;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_date_start          TO sprint_date_start;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_cadence_days        TO sprint_cadence_days;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_id_user_owner       TO sprint_owner;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_suffix              TO sprint_suffix;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_name                TO sprint_name;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_id_topology_node    TO org_node_id;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_id_workspace        TO workspace_id;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_id_subscription     TO subscription_id;
ALTER TABLE timeboxes_sprints RENAME COLUMN timeboxes_sprints_id                  TO id;

-- Table names back.
ALTER TABLE timeboxes_releases RENAME TO timebox_releases;
ALTER TABLE timeboxes_sprints  RENAME TO timebox_sprints;

-- Re-create the triggers that we dropped above.
CREATE TRIGGER timebox_sprints_set_updated_at
    BEFORE UPDATE ON timebox_sprints
    FOR EACH ROW EXECUTE FUNCTION timebox_sprints_set_updated_at();
CREATE TRIGGER timebox_releases_set_updated_at
    BEFORE UPDATE ON timebox_releases
    FOR EACH ROW EXECUTE FUNCTION timebox_releases_set_updated_at();

COMMIT;
