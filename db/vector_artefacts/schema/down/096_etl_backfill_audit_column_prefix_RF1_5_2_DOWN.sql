-- ============================================================
-- 096_etl_backfill_audit_column_prefix_RF1_5_2_DOWN.sql
--
-- Reverses 096_etl_backfill_audit_column_prefix_RF1_5_2.sql.
-- ============================================================

BEGIN;

-- ---- Column renames (reverse) ----

ALTER TABLE etl_backfill_audit RENAME COLUMN etl_backfill_audit_rows_total    TO rows_total;
ALTER TABLE etl_backfill_audit RENAME COLUMN etl_backfill_audit_rows_updated  TO rows_updated;
ALTER TABLE etl_backfill_audit RENAME COLUMN etl_backfill_audit_rows_inserted TO rows_inserted;
ALTER TABLE etl_backfill_audit RENAME COLUMN etl_backfill_audit_source        TO source;
ALTER TABLE etl_backfill_audit RENAME COLUMN etl_backfill_audit_run_at        TO run_at;

COMMIT;
