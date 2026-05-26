-- DOWN counterpart of 109_p2_create_extensions_and_helpers.sql
--
-- Drops the helper functions installed by 109. The dblink extension
-- is NOT dropped: other consumers (Pillar 3 will not need it, but
-- other queries or extensions in this DB might depend on it). If a
-- full Pillar-2 reversal is needed, drop the extension manually
-- after confirming nothing else uses it.

BEGIN;

DROP FUNCTION IF EXISTS _p2_source_rowcount(text);
DROP FUNCTION IF EXISTS _p2_assert_rowcount(text, bigint);
DROP FUNCTION IF EXISTS _p2_source_conn();

-- Enum types created by the up: drop only if no other table depends.
-- Wrapped in DO so the DOWN doesn't blow up when downstream move
-- migrations haven't yet been rolled back.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute a
          JOIN pg_type t ON t.oid = a.atttypid
          WHERE t.typname = 'custom_view_kind'
            AND a.attisdropped = false
    ) THEN
        DROP TYPE IF EXISTS public.custom_view_kind;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute a
          JOIN pg_type t ON t.oid = a.atttypid
          WHERE t.typname = 'user_role'
            AND a.attisdropped = false
    ) THEN
        DROP TYPE IF EXISTS public.user_role;
    END IF;
END $$;

-- dblink extension intentionally left in place.
-- DROP EXTENSION IF EXISTS dblink;  -- enable only if rolling back fully

COMMIT;
