-- DOWN for 002_dev_reports.sql
BEGIN;

DROP TRIGGER IF EXISTS dev_reports_touch_updated_at ON dev_reports;
DROP FUNCTION IF EXISTS dev_reports_touch_updated_at();
DROP TABLE IF EXISTS dev_reports;

DELETE FROM schema_migrations WHERE filename = '002_dev_reports.sql';

COMMIT;
