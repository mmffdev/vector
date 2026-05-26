-- ============================================================
-- DOWN: 119_p3_drop_fdw_mmff_vector_DOWN.sql
--
-- POST-DROP DEAD (2026-05-26)
-- ---------------------------
-- mmff_vector was DROPped after this migration's UP was applied
-- (Pillar 3 step 3 of refactorDB). This DOWN file CANNOT be used
-- to roll back: CREATE SERVER would succeed but every subsequent
-- dblink call against fdw_mmff_vector would fail to connect to a
-- nonexistent database.
--
-- To roll back the FDW drop after mmff_vector is gone, restore
-- the pre-Pillar-3 snapshot first (mmff_vector_snapshot_20260525
-- or the pre-push backup tagged with the Pillar 3 commit SHA);
-- then this DOWN file is usable again.
--
-- Original DOWN intent (still accurate textually):
-- Restores the fdw_mmff_vector server + user mapping but DOES NOT
-- recreate the 16 foreign tables — they referenced bare-column
-- shapes from mmff_vector that no longer exist post-Pillar-1.
-- ============================================================

BEGIN;

CREATE SERVER IF NOT EXISTS fdw_mmff_vector
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host 'localhost', port '5432', dbname 'mmff_vector');

CREATE USER MAPPING IF NOT EXISTS FOR mmff_dev
    SERVER fdw_mmff_vector
    OPTIONS (user 'mmff_dev', password current_setting('app.fdw_source_password', true));

-- Foreign tables intentionally not restored; see top comment.

COMMIT;
