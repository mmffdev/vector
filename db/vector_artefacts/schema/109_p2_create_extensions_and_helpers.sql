-- ============================================================
-- 109_p2_create_extensions_and_helpers.sql
--
-- Pillar 2 (cross-DB merge: mmff_vector → vector_artefacts) —
-- migration 1 of N.
--
-- Purpose
-- -------
-- Bootstraps the helper plumbing needed by the per-cluster move
-- migrations that follow (110..118):
--
--   1. CREATE EXTENSION dblink — used by every move migration to
--      INSERT … SELECT FROM dblink(<conn>, <query>) AS t(<cols>).
--      Already-present is a no-op (IF NOT EXISTS).
--
--   2. A SECURITY DEFINER helper `_p2_source_conn()` that returns the
--      dblink connection string for the source DB (mmff_vector by
--      default; can be overridden per-session via GUC
--      `vector.p2_source_db` for dry-run replays against a clone).
--      Password is read from GUC `app.fdw_source_password` which the
--      cmd/migrate runner already sets per-connection.
--
--   3. A SECURITY DEFINER helper `_p2_assert_rowcount(table, expected)`
--      that compares the row count of the named table (in the LOCAL
--      DB, i.e. vector_artefacts) against the expected value and
--      RAISE EXCEPTION on mismatch. Used by every move migration to
--      enforce row-count parity inline.
--
-- This migration touches NO data and creates NO tables. It is the
-- safest possible bootstrap step and is fully reversible via the
-- companion DOWN script (drops the helpers + extension if no other
-- consumer remains).
--
-- Pillar 2 reference: handovers/refactorDB.md (Pillar 2 § Pre-flight).
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS dblink;

-- ---- Enum types needed by tables that will be moved ----
-- public.user_role is referenced by users.users_role.
-- public.custom_view_kind is referenced by users_custom_page_views.users_custom_page_views_kind.
-- Both live in mmff_vector today; we create matching enums in vector_artefacts.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE public.user_role AS ENUM ('user', 'padmin', 'gadmin');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'custom_view_kind') THEN
        CREATE TYPE public.custom_view_kind AS ENUM ('timeline', 'board', 'list');
    END IF;
END $$;

-- ---- _p2_source_conn() ----
-- Returns the libpq connection string used by every Pillar 2 dblink
-- call. The source DB name comes from GUC vector.p2_source_db when
-- set (dry-run override); default is 'mmff_vector' (production move).
-- Password is read from app.fdw_source_password (already set by the
-- migration runner).
CREATE OR REPLACE FUNCTION _p2_source_conn() RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_db   text := current_setting('vector.p2_source_db', true);
    v_pass text := current_setting('app.fdw_source_password', true);
BEGIN
    IF v_db IS NULL OR v_db = '' THEN
        v_db := 'mmff_vector';
    END IF;
    IF v_pass IS NULL OR v_pass = '' THEN
        RAISE EXCEPTION 'Pillar 2 dblink helper: GUC app.fdw_source_password is empty. '
                        'The migration runner is expected to set this per-connection; '
                        'dry-run replays must SET app.fdw_source_password before running.';
    END IF;
    RETURN format('host=localhost port=5432 dbname=%s user=mmff_dev password=%s', v_db, v_pass);
END;
$$;

-- ---- _p2_assert_rowcount(table, expected) ----
-- Compare row count of the named table in the current DB
-- (vector_artefacts) against the expected row count from the source.
-- RAISE EXCEPTION on mismatch; the surrounding tx aborts and rolls
-- back, leaving the schema/data unchanged. Used by every move
-- migration to enforce parity inline.
CREATE OR REPLACE FUNCTION _p2_assert_rowcount(p_table text, p_expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_actual bigint;
BEGIN
    EXECUTE format('SELECT count(*) FROM %I', p_table) INTO v_actual;
    IF v_actual <> p_expected THEN
        RAISE EXCEPTION 'Pillar 2 row-count mismatch on table %: expected %, got %',
            p_table, p_expected, v_actual;
    END IF;
END;
$$;

-- ---- _p2_source_rowcount(table) ----
-- Helper to fetch the source-DB row count for a table over dblink.
-- Saves repeating the dblink connection string in every move
-- migration. Returns bigint.
CREATE OR REPLACE FUNCTION _p2_source_rowcount(p_table text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
    v_count bigint;
BEGIN
    SELECT c INTO v_count
      FROM dblink(_p2_source_conn(), format('SELECT count(*)::bigint FROM %I', p_table))
        AS t(c bigint);
    RETURN v_count;
END;
$$;

COMMIT;
