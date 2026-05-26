-- ============================================================
-- 097_topology_commits_column_prefix_RF1_5_2.sql
--
-- RF1.5.2 — Pillar 1 wave 2, table 4/5.
--
-- Applies the §2.3 column-prefix convention to topology_commits.
-- Single-row-per-subscription checkpoint table (PLA-0023 P6, mig 180);
-- PK is on (subscription_id), so the PK column follows the §2.4
-- FK shape `<table>_id_<target>` rather than `<table>_id` (mirrors
-- the artefacts_number_sequences composite-PK precedent in 095).
--
-- Both `subscription_id` and `committed_by` are app-soft references
-- (parent tables `subscriptions` + `users` live in mmff_vector, so
-- Postgres can't enforce cross-DB FKs). Both follow the §2.4 shape:
-- `<table>_id_<target>`. `committed_by` carries the role `committed_by`
-- — there's only one FK-like reference to `users` on this table, so
-- per §2.4 role-suffix-when-single-target-occurs the role suffix is
-- omitted and the column becomes `topology_commits_id_user`. The
-- existing `committed_by` semantic is preserved by the standalone
-- `topology_commits_committed_at` + `topology_commits_committed_by`
-- column pair (yes, we keep `committed_by` as a column name suffix,
-- not as a role suffix — it's the column's natural name, not a role
-- discriminator).
--
-- Wait: per §2.4 the FK shape is `<table>_id_<target>[_<role>]`.
-- `committed_by` is the role here (not the target — the target is
-- `users`), so the column name is `topology_commits_id_user_committed_by`
-- to follow §2.4 strictly. This is consistent with the master_record
-- precedent (e.g. `master_record_workspaces_id_user_owner` for the
-- "owner" role to the `users` target).
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE topology_commits RENAME COLUMN subscription_id TO topology_commits_id_subscription;
ALTER TABLE topology_commits RENAME COLUMN committed_at    TO topology_commits_committed_at;
ALTER TABLE topology_commits RENAME COLUMN committed_by    TO topology_commits_id_user_committed_by;
ALTER TABLE topology_commits RENAME COLUMN created_at      TO topology_commits_created_at;
ALTER TABLE topology_commits RENAME COLUMN updated_at      TO topology_commits_updated_at;

-- topology_commits_pkey already matches <table>_pkey convention — left untouched.
-- No other indexes, constraints, or FKs on this table.

COMMIT;
