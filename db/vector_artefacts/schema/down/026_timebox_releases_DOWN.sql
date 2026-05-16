-- DOWN for 026_timebox_releases.sql
BEGIN;

ALTER TABLE artefacts
    DROP CONSTRAINT IF EXISTS artefacts_timebox_release_id_fkey;

DROP INDEX IF EXISTS artefacts_timebox_release;

ALTER TABLE artefacts
    DROP COLUMN IF EXISTS timebox_release_id;

DROP TABLE IF EXISTS timebox_releases;
DROP FUNCTION IF EXISTS timebox_releases_set_updated_at();

COMMIT;
