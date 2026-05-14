-- ============================================================
-- MMFFDev - vector_artefacts: RF1.4.2.timeboxes
-- Migration 054 — rename timebox_sprints → timeboxes_sprints and
-- timebox_releases → timeboxes_releases, and apply the §2.3 column-
-- prefix rule to every column on both tables. Also rename the two
-- FK columns on artefacts that point at them, per §2.4.
--
-- PLA-0048 / RF1.4.2.timeboxes (2026-05-14). First per-domain rename
-- under the convention sweep — pairs with sql.go updates in the same
-- commit. No data is moved; only names change. The runner's lock-step
-- rename of sql.go + Go types + frontend keeps the wire shape and DB
-- shape in sync (the JSON wire keys also switch to the new column
-- names, since the JSON tags mirrored the column names).
--
-- See docs/c_c_naming_conventions.md §2.3 (column-prefix rule), §2.4
-- (PK/FK naming), §2.5 (constraint/index naming), and §2.6
-- (approved root families — "timeboxes_*").
-- ============================================================

BEGIN;

-- ── 1. Rename the tables. ────────────────────────────────────────
ALTER TABLE timebox_sprints  RENAME TO timeboxes_sprints;
ALTER TABLE timebox_releases RENAME TO timeboxes_releases;

-- ── 2. timeboxes_sprints: column renames per §2.3 + §2.4. ───────
ALTER TABLE timeboxes_sprints RENAME COLUMN id                       TO timeboxes_sprints_id;
ALTER TABLE timeboxes_sprints RENAME COLUMN subscription_id          TO timeboxes_sprints_id_subscription;
ALTER TABLE timeboxes_sprints RENAME COLUMN workspace_id             TO timeboxes_sprints_id_workspace;
ALTER TABLE timeboxes_sprints RENAME COLUMN org_node_id              TO timeboxes_sprints_id_topology_node;
ALTER TABLE timeboxes_sprints RENAME COLUMN sprint_name              TO timeboxes_sprints_name;
ALTER TABLE timeboxes_sprints RENAME COLUMN sprint_suffix            TO timeboxes_sprints_suffix;
ALTER TABLE timeboxes_sprints RENAME COLUMN sprint_owner             TO timeboxes_sprints_id_user_owner;
ALTER TABLE timeboxes_sprints RENAME COLUMN sprint_cadence_days      TO timeboxes_sprints_cadence_days;
ALTER TABLE timeboxes_sprints RENAME COLUMN sprint_date_start        TO timeboxes_sprints_date_start;
ALTER TABLE timeboxes_sprints RENAME COLUMN sprint_date_end          TO timeboxes_sprints_date_end;
ALTER TABLE timeboxes_sprints RENAME COLUMN sprint_scope             TO timeboxes_sprints_scope;
ALTER TABLE timeboxes_sprints RENAME COLUMN sprint_velocity          TO timeboxes_sprints_velocity;
ALTER TABLE timeboxes_sprints RENAME COLUMN sprint_estimate          TO timeboxes_sprints_estimate;
ALTER TABLE timeboxes_sprints RENAME COLUMN sprint_creep_by_count    TO timeboxes_sprints_creep_by_count;
ALTER TABLE timeboxes_sprints RENAME COLUMN sprint_creep_by_estimate TO timeboxes_sprints_creep_by_estimate;
ALTER TABLE timeboxes_sprints RENAME COLUMN status                   TO timeboxes_sprints_status;
ALTER TABLE timeboxes_sprints RENAME COLUMN sprint_date_added        TO timeboxes_sprints_created_at;
ALTER TABLE timeboxes_sprints RENAME COLUMN sprint_date_updated      TO timeboxes_sprints_updated_at;
ALTER TABLE timeboxes_sprints RENAME COLUMN archived_at              TO timeboxes_sprints_archived_at;

-- ── 3. timeboxes_releases: same shape as sprints. ────────────────
ALTER TABLE timeboxes_releases RENAME COLUMN id                        TO timeboxes_releases_id;
ALTER TABLE timeboxes_releases RENAME COLUMN subscription_id           TO timeboxes_releases_id_subscription;
ALTER TABLE timeboxes_releases RENAME COLUMN workspace_id              TO timeboxes_releases_id_workspace;
ALTER TABLE timeboxes_releases RENAME COLUMN org_node_id               TO timeboxes_releases_id_topology_node;
ALTER TABLE timeboxes_releases RENAME COLUMN release_name              TO timeboxes_releases_name;
ALTER TABLE timeboxes_releases RENAME COLUMN release_suffix            TO timeboxes_releases_suffix;
ALTER TABLE timeboxes_releases RENAME COLUMN release_owner             TO timeboxes_releases_id_user_owner;
ALTER TABLE timeboxes_releases RENAME COLUMN release_cadence_days      TO timeboxes_releases_cadence_days;
ALTER TABLE timeboxes_releases RENAME COLUMN release_date_start        TO timeboxes_releases_date_start;
ALTER TABLE timeboxes_releases RENAME COLUMN release_date_end          TO timeboxes_releases_date_end;
ALTER TABLE timeboxes_releases RENAME COLUMN release_scope             TO timeboxes_releases_scope;
ALTER TABLE timeboxes_releases RENAME COLUMN release_velocity          TO timeboxes_releases_velocity;
ALTER TABLE timeboxes_releases RENAME COLUMN release_estimate          TO timeboxes_releases_estimate;
ALTER TABLE timeboxes_releases RENAME COLUMN release_creep_by_count    TO timeboxes_releases_creep_by_count;
ALTER TABLE timeboxes_releases RENAME COLUMN release_creep_by_estimate TO timeboxes_releases_creep_by_estimate;
ALTER TABLE timeboxes_releases RENAME COLUMN status                    TO timeboxes_releases_status;
ALTER TABLE timeboxes_releases RENAME COLUMN release_date_added        TO timeboxes_releases_created_at;
ALTER TABLE timeboxes_releases RENAME COLUMN release_date_updated      TO timeboxes_releases_updated_at;
ALTER TABLE timeboxes_releases RENAME COLUMN archived_at               TO timeboxes_releases_archived_at;

-- ── 4. artefacts FK columns to timeboxes — §2.4 function-then-modifier. ──
-- artefacts is already a §2.6 root family, so the FK column gains the
-- prefix of its OWN table (artefacts), not of the parent.
ALTER TABLE artefacts RENAME COLUMN timebox_sprint_id  TO artefacts_id_timebox_sprint;
ALTER TABLE artefacts RENAME COLUMN timebox_release_id TO artefacts_id_timebox_release;

-- ── 5. Trigger function rebind — they reference column names. ────
-- The trigger functions hard-code the timestamp column. Re-create.
CREATE OR REPLACE FUNCTION timebox_sprints_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.timeboxes_sprints_updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION timebox_releases_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.timeboxes_releases_updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Rename the trigger function objects themselves to match the table.
ALTER FUNCTION timebox_sprints_set_updated_at()  RENAME TO timeboxes_sprints_set_updated_at;
ALTER FUNCTION timebox_releases_set_updated_at() RENAME TO timeboxes_releases_set_updated_at;

-- Drop + re-create the triggers (they still bind the renamed functions
-- by oid, but renaming the trigger object itself needs a fresh CREATE).
DROP TRIGGER IF EXISTS timebox_sprints_set_updated_at  ON timeboxes_sprints;
DROP TRIGGER IF EXISTS timebox_releases_set_updated_at ON timeboxes_releases;

CREATE TRIGGER timeboxes_sprints_set_updated_at
    BEFORE UPDATE ON timeboxes_sprints
    FOR EACH ROW EXECUTE FUNCTION timeboxes_sprints_set_updated_at();

CREATE TRIGGER timeboxes_releases_set_updated_at
    BEFORE UPDATE ON timeboxes_releases
    FOR EACH ROW EXECUTE FUNCTION timeboxes_releases_set_updated_at();

-- ── 6. Rename indexes + constraints to match the new table name. ──
-- Constraints (CHECK, EXCLUDE).
ALTER TABLE timeboxes_sprints RENAME CONSTRAINT timebox_sprints_name_nonempty       TO timeboxes_sprints_name_nonempty;
ALTER TABLE timeboxes_sprints RENAME CONSTRAINT timebox_sprints_cadence_positive    TO timeboxes_sprints_cadence_positive;
ALTER TABLE timeboxes_sprints RENAME CONSTRAINT timebox_sprints_dates_valid         TO timeboxes_sprints_dates_valid;
ALTER TABLE timeboxes_sprints RENAME CONSTRAINT timebox_sprints_status_valid        TO timeboxes_sprints_status_valid;
ALTER TABLE timeboxes_sprints RENAME CONSTRAINT timebox_sprints_scope_nonneg        TO timeboxes_sprints_scope_nonneg;
ALTER TABLE timeboxes_sprints RENAME CONSTRAINT timebox_sprints_velocity_nonneg     TO timeboxes_sprints_velocity_nonneg;
ALTER TABLE timeboxes_sprints RENAME CONSTRAINT timebox_sprints_estimate_nonneg     TO timeboxes_sprints_estimate_nonneg;
ALTER TABLE timeboxes_sprints RENAME CONSTRAINT timebox_sprints_no_overlap          TO timeboxes_sprints_no_overlap;

ALTER TABLE timeboxes_releases RENAME CONSTRAINT timebox_releases_name_nonempty     TO timeboxes_releases_name_nonempty;
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timebox_releases_cadence_nonneg    TO timeboxes_releases_cadence_nonneg;
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timebox_releases_dates_valid       TO timeboxes_releases_dates_valid;
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timebox_releases_status_valid      TO timeboxes_releases_status_valid;
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timebox_releases_scope_nonneg      TO timeboxes_releases_scope_nonneg;
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timebox_releases_velocity_nonneg   TO timeboxes_releases_velocity_nonneg;
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timebox_releases_estimate_nonneg   TO timeboxes_releases_estimate_nonneg;
ALTER TABLE timeboxes_releases RENAME CONSTRAINT timebox_releases_no_overlap        TO timeboxes_releases_no_overlap;

-- Indexes (rename the index objects).
ALTER INDEX timebox_sprints_subscription      RENAME TO timeboxes_sprints_subscription;
ALTER INDEX timebox_sprints_workspace         RENAME TO timeboxes_sprints_workspace;
ALTER INDEX timebox_sprints_workspace_status  RENAME TO timeboxes_sprints_workspace_status;
ALTER INDEX timebox_sprints_org_node          RENAME TO timeboxes_sprints_topology_node;
ALTER INDEX timebox_sprints_dates             RENAME TO timeboxes_sprints_dates;

ALTER INDEX timebox_releases_subscription     RENAME TO timeboxes_releases_subscription;
ALTER INDEX timebox_releases_workspace        RENAME TO timeboxes_releases_workspace;
ALTER INDEX timebox_releases_workspace_status RENAME TO timeboxes_releases_workspace_status;
ALTER INDEX timebox_releases_org_node         RENAME TO timeboxes_releases_topology_node;
ALTER INDEX timebox_releases_dates            RENAME TO timeboxes_releases_dates;

ALTER INDEX artefacts_timebox_sprint  RENAME TO artefacts_id_timebox_sprint;
ALTER INDEX artefacts_timebox_release RENAME TO artefacts_id_timebox_release;

-- Also rename the artefacts FK constraint to match the column. Migration
-- 025 explicitly named the sprint FK; the release FK in 026 was created
-- inline (`REFERENCES timebox_releases(id)` on column add) and Postgres
-- auto-named it. Rather than guess the auto-name, locate it via the
-- catalog and rename atomically inside this tx. Sprint FK is explicit.
ALTER TABLE artefacts RENAME CONSTRAINT artefacts_timebox_sprint_id_fkey
                                     TO artefacts_id_timebox_sprint_fkey;

DO $$
DECLARE
    fk_name text;
BEGIN
    SELECT conname INTO fk_name
      FROM pg_constraint
     WHERE conrelid = 'artefacts'::regclass
       AND contype  = 'f'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (artefacts_id_timebox_release)%';
    IF fk_name IS NULL THEN
        RAISE EXCEPTION 'release FK on artefacts not found (expected single FK referencing artefacts_id_timebox_release)';
    END IF;
    EXECUTE format('ALTER TABLE artefacts RENAME CONSTRAINT %I TO artefacts_id_timebox_release_fkey', fk_name);
END $$;

COMMIT;
