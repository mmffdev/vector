-- ============================================================
-- MMFFDev - Vector: mmff_dev DB bootstrap
-- ============================================================
-- Database created out-of-band 2026-05-21:
--   CREATE DATABASE mmff_dev OWNER mmff_dev ENCODING UTF8;
--
-- This file is the first migration: schema_migrations table only.
-- All subsequent dev-DB migrations live in db/mmff_dev/schema/NNN_*.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT        PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (filename) VALUES ('001_init.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
