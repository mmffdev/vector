-- ============================================================
-- 096_etl_backfill_audit_column_prefix_RF1_5_2.sql
--
-- RF1.5.2 — Pillar 1 wave 2, table 3/5.
--
-- Applies the §2.3 column-prefix convention to etl_backfill_audit.
-- Pure audit log — no PK, no FK, no indexes, no inbound references
-- (no Go callers either; this table is written by external ETL
-- scripts only). Plain column-prefix rename.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE etl_backfill_audit RENAME COLUMN run_at        TO etl_backfill_audit_run_at;
ALTER TABLE etl_backfill_audit RENAME COLUMN source        TO etl_backfill_audit_source;
ALTER TABLE etl_backfill_audit RENAME COLUMN rows_inserted TO etl_backfill_audit_rows_inserted;
ALTER TABLE etl_backfill_audit RENAME COLUMN rows_updated  TO etl_backfill_audit_rows_updated;
ALTER TABLE etl_backfill_audit RENAME COLUMN rows_total    TO etl_backfill_audit_rows_total;

COMMIT;
