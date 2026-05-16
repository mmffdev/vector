-- ============================================================
-- 195_users_roles_pages_uuid_keyed.sql
--
-- PLA-0049 Phase 0.2 — re-key users_roles_pages from the legacy
-- user_role enum partner to the UUID id_role partner. Drops the
-- enum column entirely from this table so tenant-custom roles
-- and the new grp_product / grp_stakeholder system roles can
-- carry page grants (the user_role enum has only 3 values:
-- 'user'/'padmin'/'gadmin' — anything outside that set could
-- not be granted a page through the old PK shape).
--
-- The user_role Postgres enum TYPE itself is left in place
-- (still used by users.role per PLA-0007's deferred Migration Z
-- and by some history queries). Only the column on
-- users_roles_pages is dropped.
--
-- The CHECK constraint users_roles_tenant_rank_band is REPLACED
-- here in the same transaction: old bands {5,10,20,25,30}
-- → new bands {10,20,30,40,50,60,70} matching the new system
-- rank ladder seeded in 194.
--
-- DOWN: 195_users_roles_pages_uuid_keyed_DOWN.sql restores the
-- enum column, the old PK, and the old CHECK. Restoring grant
-- data for pages whose roles fall outside {gadmin,padmin,user}
-- is NOT possible after the down — those rows are dropped.
-- ============================================================

BEGIN;

-- ── Step 1. Drop the old PK that uses the enum partner ──────
ALTER TABLE users_roles_pages DROP CONSTRAINT users_roles_pages_pkey;

-- ── Step 2. Drop the enum column (all data captured in id_role) ──
-- The two indexes on the enum column are auto-dropped with the column.
ALTER TABLE users_roles_pages DROP COLUMN users_roles_pages_role;

-- ── Step 3. Build the new PK on (id_page, id_role) ──────────
ALTER TABLE users_roles_pages
    ADD CONSTRAINT users_roles_pages_pkey
    PRIMARY KEY (users_roles_pages_id_page, users_roles_pages_id_role);

-- ── Step 4. Replace the rank-band CHECK on users_roles ──────
ALTER TABLE users_roles DROP CONSTRAINT users_roles_tenant_rank_band;
ALTER TABLE users_roles
    ADD CONSTRAINT users_roles_tenant_rank_band
    CHECK (
        users_roles_id_subscription IS NULL
        OR users_roles_rank NOT IN (10, 20, 30, 40, 50, 60, 70)
    );

-- ── Sanity ──────────────────────────────────────────────────
DO $$
DECLARE
    has_enum_col BOOLEAN;
    pk_cols      TEXT;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users_roles_pages'
          AND column_name = 'users_roles_pages_role'
    ) INTO has_enum_col;
    IF has_enum_col THEN
        RAISE EXCEPTION 'PLA-0049 mig 195: users_roles_pages_role column still present after drop';
    END IF;

    SELECT string_agg(a.attname, ',' ORDER BY array_position(c.conkey, a.attnum))
      INTO pk_cols
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum   = ANY(c.conkey)
     WHERE c.conrelid = 'users_roles_pages'::regclass
       AND c.contype  = 'p';
    IF pk_cols <> 'users_roles_pages_id_page,users_roles_pages_id_role' THEN
        RAISE EXCEPTION 'PLA-0049 mig 195: PK columns are %, expected (id_page, id_role)', pk_cols;
    END IF;
END $$;

COMMIT;
