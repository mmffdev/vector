-- ============================================================
-- 251_cost_centres_column_prefix_RF1_5_1_DOWN.sql
--
-- Reverses 251_cost_centres_column_prefix_RF1_5_1.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE cost_centres
    RENAME CONSTRAINT cost_centres_id_subscription_fkey
                  TO cost_centres_subscription_id_fkey;

ALTER TABLE cost_centres
    RENAME CONSTRAINT cost_centres_id_parent_fkey
                  TO cost_centres_parent_id_fkey;

-- ---- Index renames (reverse) ----

ALTER INDEX cost_centres_id_subscription_code_unique RENAME TO cost_centres_unique_code_active;
ALTER INDEX idx_cost_centres_id_subscription         RENAME TO cost_centres_subscription_idx;
ALTER INDEX idx_cost_centres_id_parent               RENAME TO cost_centres_parent_idx;

-- ---- Column renames (reverse) ----

ALTER TABLE cost_centres RENAME COLUMN cost_centres_updated_at        TO updated_at;
ALTER TABLE cost_centres RENAME COLUMN cost_centres_created_at        TO created_at;
ALTER TABLE cost_centres RENAME COLUMN cost_centres_archived_at       TO archived_at;
ALTER TABLE cost_centres RENAME COLUMN cost_centres_is_active         TO is_active;
ALTER TABLE cost_centres RENAME COLUMN cost_centres_name              TO name;
ALTER TABLE cost_centres RENAME COLUMN cost_centres_code              TO code;
ALTER TABLE cost_centres RENAME COLUMN cost_centres_id_parent         TO parent_id;
ALTER TABLE cost_centres RENAME COLUMN cost_centres_id_subscription   TO subscription_id;
ALTER TABLE cost_centres RENAME COLUMN cost_centres_id                TO id;

COMMIT;
