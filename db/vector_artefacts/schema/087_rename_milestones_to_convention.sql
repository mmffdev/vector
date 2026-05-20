-- ============================================================
-- 087_rename_milestones_to_convention.sql
--
-- Apply the §2.3 + §2.4 naming convention to the milestone table and
-- artefacts.timebox_milestone_id FK column added in migrations 085/084.
--
-- Mirrors what 054_rename_timeboxes_RF1_4_2.sql did for sprints/releases.
-- 085 was written with the legacy "timebox_milestones" name; this lifts
-- it to the modern "timeboxes_milestones" + table-prefix column names so
-- the milestone service can mirror sprints/releases line-for-line.
--
-- WHY:
--   Caught immediately after 085 applied — better to fix forward than
--   re-write 085 in place (the runner has already recorded it as
--   applied). Net cost: one extra schema_migrations row.
--
-- IDEMPOTENCY:
--   Each ALTER guarded by IF EXISTS where supported; ALTER TABLE …
--   RENAME is itself idempotent-by-target-check (run twice → error
--   "relation already exists" on the second run, which is the safe
--   outcome).
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/087_rename_milestones_to_convention_DOWN.sql
-- ============================================================

BEGIN;

-- ── 1. Rename the table. ─────────────────────────────────────────
ALTER TABLE timebox_milestones RENAME TO timeboxes_milestones;

-- ── 2. Column renames per §2.3 + §2.4. ──────────────────────────
ALTER TABLE timeboxes_milestones RENAME COLUMN id                        TO timeboxes_milestones_id;
ALTER TABLE timeboxes_milestones RENAME COLUMN subscription_id           TO timeboxes_milestones_id_subscription;
ALTER TABLE timeboxes_milestones RENAME COLUMN workspace_id              TO timeboxes_milestones_id_workspace;
ALTER TABLE timeboxes_milestones RENAME COLUMN org_node_id               TO timeboxes_milestones_id_topology_node;
ALTER TABLE timeboxes_milestones RENAME COLUMN milestone_name            TO timeboxes_milestones_name;
ALTER TABLE timeboxes_milestones RENAME COLUMN milestone_description     TO timeboxes_milestones_description;
ALTER TABLE timeboxes_milestones RENAME COLUMN milestone_owner           TO timeboxes_milestones_id_user_owner;
ALTER TABLE timeboxes_milestones RENAME COLUMN milestone_date_target     TO timeboxes_milestones_date_target;
ALTER TABLE timeboxes_milestones RENAME COLUMN status                    TO timeboxes_milestones_status;
ALTER TABLE timeboxes_milestones RENAME COLUMN position                  TO timeboxes_milestones_position;
ALTER TABLE timeboxes_milestones RENAME COLUMN milestone_date_added      TO timeboxes_milestones_created_at;
ALTER TABLE timeboxes_milestones RENAME COLUMN milestone_date_updated    TO timeboxes_milestones_updated_at;
ALTER TABLE timeboxes_milestones RENAME COLUMN archived_at               TO timeboxes_milestones_archived_at;

-- ── 3. Rename indexes to match the new table name. ──────────────
ALTER INDEX IF EXISTS timebox_milestones_subscription      RENAME TO timeboxes_milestones_subscription;
ALTER INDEX IF EXISTS timebox_milestones_workspace         RENAME TO timeboxes_milestones_workspace;
ALTER INDEX IF EXISTS timebox_milestones_workspace_status  RENAME TO timeboxes_milestones_workspace_status;
ALTER INDEX IF EXISTS timebox_milestones_org_node          RENAME TO timeboxes_milestones_org_node;
ALTER INDEX IF EXISTS timebox_milestones_target_date       RENAME TO timeboxes_milestones_target_date;

-- ── 4. Rename constraints. ──────────────────────────────────────
ALTER TABLE timeboxes_milestones
    RENAME CONSTRAINT timebox_milestones_name_nonempty   TO timeboxes_milestones_name_nonempty;
ALTER TABLE timeboxes_milestones
    RENAME CONSTRAINT timebox_milestones_status_valid    TO timeboxes_milestones_status_valid;

-- ── 5. Rename trigger + body function. ──────────────────────────
DROP TRIGGER IF EXISTS timebox_milestones_set_updated_at ON timeboxes_milestones;

CREATE OR REPLACE FUNCTION fn_timeboxes_milestones_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.timeboxes_milestones_updated_at := now();
    RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS timebox_milestones_set_updated_at();

CREATE TRIGGER trg_timeboxes_milestones_touch_updated_at
BEFORE UPDATE ON timeboxes_milestones
FOR EACH ROW
EXECUTE FUNCTION fn_timeboxes_milestones_touch_updated_at();

-- ── 6. Rename the FK column on artefacts to match. ──────────────
ALTER TABLE artefacts RENAME COLUMN timebox_milestone_id TO artefacts_id_timebox_milestone;

ALTER INDEX IF EXISTS artefacts_timebox_milestone RENAME TO artefacts_id_timebox_milestone_idx;

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_timebox_milestone_id_fkey
                   TO artefacts_id_timebox_milestone_fkey;

COMMIT;
