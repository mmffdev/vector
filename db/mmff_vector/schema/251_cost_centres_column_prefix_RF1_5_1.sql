-- ============================================================
-- 251_cost_centres_column_prefix_RF1_5_1.sql
--
-- RF1.5.1 — Pillar 1 wave 1, table 1/5.
--
-- Applies the §2.3 column-prefix convention to cost_centres.
-- PK becomes <table>_id; FKs follow §2.4 PK/FK shape
-- (FK = <table>_id_<target>[_<role>]; self-FK uses role suffix
-- `_parent` per the topology_nodes_id_parent precedent in §2.4).
--
-- Inbound FK from users.cost_centre_id → cost_centres(id) is
-- automatically retargeted by Postgres on PK column rename (FKs
-- track column oid, not name). The legacy `users.cost_centre_id`
-- column name itself stays bare here — `users` sweep is a
-- different wave.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE cost_centres RENAME COLUMN id              TO cost_centres_id;
ALTER TABLE cost_centres RENAME COLUMN subscription_id TO cost_centres_id_subscription;
ALTER TABLE cost_centres RENAME COLUMN parent_id       TO cost_centres_id_parent;
ALTER TABLE cost_centres RENAME COLUMN code            TO cost_centres_code;
ALTER TABLE cost_centres RENAME COLUMN name            TO cost_centres_name;
ALTER TABLE cost_centres RENAME COLUMN is_active       TO cost_centres_is_active;
ALTER TABLE cost_centres RENAME COLUMN archived_at     TO cost_centres_archived_at;
ALTER TABLE cost_centres RENAME COLUMN created_at      TO cost_centres_created_at;
ALTER TABLE cost_centres RENAME COLUMN updated_at      TO cost_centres_updated_at;

-- ---- Index renames ----

ALTER INDEX cost_centres_parent_idx         RENAME TO idx_cost_centres_id_parent;
ALTER INDEX cost_centres_subscription_idx   RENAME TO idx_cost_centres_id_subscription;
ALTER INDEX cost_centres_unique_code_active RENAME TO cost_centres_id_subscription_code_unique;

-- ---- Constraint renames ----

ALTER TABLE cost_centres
    RENAME CONSTRAINT cost_centres_parent_id_fkey
                  TO cost_centres_id_parent_fkey;

ALTER TABLE cost_centres
    RENAME CONSTRAINT cost_centres_subscription_id_fkey
                  TO cost_centres_id_subscription_fkey;

-- cost_centres_code_chk + cost_centres_name_chk already match the
-- <table>_<col>_chk convention — left untouched.

COMMIT;
