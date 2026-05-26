-- ============================================================
-- DOWN: 119_p3_drop_fdw_mmff_vector_DOWN.sql
--
-- Restores the fdw_mmff_vector server + user mapping but DOES NOT
-- recreate the 16 foreign tables — they referenced bare-column
-- shapes from mmff_vector that no longer exist post-Pillar-1. If
-- you need a true rollback, restore from the pre-Pillar-3 backup
-- snapshot instead.
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
