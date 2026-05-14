-- ============================================================
-- MMFFDev - vector_artefacts: Extensions + shared helpers
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 002_extensions_and_helpers.sql
--
-- - pgcrypto       : gen_random_uuid() default for primary keys
-- - set_updated_at : trigger function reused by every table that has an
--                    updated_at column (attached per-table in later migs)
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_updated_at() IS
    'Generic BEFORE UPDATE trigger - bumps updated_at to now() on any row '
    'modification. Attach per-table where mtime tracking is required.';

COMMIT;
