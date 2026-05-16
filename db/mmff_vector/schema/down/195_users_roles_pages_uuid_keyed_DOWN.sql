-- ============================================================
-- DOWN for 195_users_roles_pages_uuid_keyed.sql
--
-- WARNING: this DOWN restores the schema shape but CANNOT
-- restore grant data for any users_roles_pages row whose id_role
-- points at a role outside {gadmin,padmin,user}. Those rows are
-- silently dropped on down because the resurrected enum column
-- has no slot for them.
--
-- The replaced CHECK is restored to {5,10,20,25,30}.
-- ============================================================

BEGIN;

-- 1. Drop new PK
ALTER TABLE users_roles_pages DROP CONSTRAINT users_roles_pages_pkey;

-- 2. Drop rows that have no enum representation (cannot survive the round-trip).
DELETE FROM users_roles_pages
 WHERE users_roles_pages_id_role NOT IN (
    SELECT users_roles_id FROM users_roles
     WHERE users_roles_is_system = TRUE
       AND users_roles_code IN ('gadmin','padmin','user')
 );

-- 3. Re-add the enum column.
ALTER TABLE users_roles_pages
    ADD COLUMN users_roles_pages_role user_role;

-- 4. Backfill the enum from the id_role pointer.
UPDATE users_roles_pages p
   SET users_roles_pages_role = r.users_roles_code::user_role
  FROM users_roles r
 WHERE r.users_roles_id = p.users_roles_pages_id_role;

ALTER TABLE users_roles_pages ALTER COLUMN users_roles_pages_role SET NOT NULL;

-- 5. Restore the old PK (id_page, role enum).
ALTER TABLE users_roles_pages
    ADD CONSTRAINT users_roles_pages_pkey
    PRIMARY KEY (users_roles_pages_id_page, users_roles_pages_role);

CREATE INDEX idx_users_roles_pages_role
    ON users_roles_pages (users_roles_pages_role);

-- 6. Restore the old rank band check.
ALTER TABLE users_roles DROP CONSTRAINT users_roles_tenant_rank_band;
ALTER TABLE users_roles
    ADD CONSTRAINT users_roles_tenant_rank_band
    CHECK (
        users_roles_id_subscription IS NULL
        OR users_roles_rank NOT IN (5, 10, 20, 25, 30)
    );

COMMIT;
