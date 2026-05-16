-- ============================================================
-- PLA-0007 / Story 00293 — Add role_id columns + backfill
-- ============================================================
-- HIGH-RISK MIGRATION: this migration touches the users table.
-- The CLAUDE.md HARD RULE protects three human accounts:
--   gadmin@mmffdev.com, padmin@mmffdev.com, user@mmffdev.com
-- These rows must be byte-for-byte unchanged in their credential
-- fields (password_hash, email, is_active, password_changed_at)
-- after this migration. Their role_id is the ONLY permitted change.
--
-- A protected-account preservation assertion runs at the END of
-- this migration. The migration runs in a single transaction
-- (per backend/cmd/migrate/main.go applyFile). If the assertion
-- fails, the transaction aborts and no changes land.
-- ============================================================

-- ── Step 1: snapshot protected-account credential fields BEFORE any change.
-- ============================================================
-- We use a temp table inside the transaction so the snapshot
-- is visible to the post-migration assertion below.
CREATE TEMP TABLE _pla7_protected_snapshot ON COMMIT DROP AS
SELECT
    u.id,
    u.email,
    u.password_hash,
    u.is_active,
    u.password_changed_at
FROM users u
WHERE u.email IN ('gadmin@mmffdev.com', 'padmin@mmffdev.com', 'user@mmffdev.com')
  AND u.subscription_id = '00000000-0000-0000-0000-000000000001';

-- Sanity: we MUST find all three. Otherwise abort — something has
-- already drifted.
DO $$
DECLARE
    n INTEGER;
BEGIN
    SELECT COUNT(*) INTO n FROM _pla7_protected_snapshot;
    IF n <> 3 THEN
        RAISE EXCEPTION 'PLA-0007 089: expected 3 protected accounts, found %; aborting migration before any change', n;
    END IF;
END $$;


-- ── Step 2: add users.role_id (nullable for backfill).
-- ============================================================
ALTER TABLE users
    ADD COLUMN role_id UUID REFERENCES roles(id) ON DELETE RESTRICT;

CREATE INDEX idx_users_role_id ON users (role_id);


-- ── Step 3: backfill users.role_id from users.role enum.
-- ============================================================
-- Each enum value maps deterministically to one seeded system role.
-- The fixed UUIDs come from migration 088.
UPDATE users
SET role_id = '00000000-0000-0000-0000-00000000ad30'  -- gadmin
WHERE role = 'gadmin';

UPDATE users
SET role_id = '00000000-0000-0000-0000-00000000ad25'  -- padmin
WHERE role = 'padmin';

UPDATE users
SET role_id = '00000000-0000-0000-0000-00000000ad10'  -- user
WHERE role = 'user';

-- Verify zero rows left NULL.
DO $$
DECLARE
    n INTEGER;
BEGIN
    SELECT COUNT(*) INTO n FROM users WHERE role_id IS NULL;
    IF n > 0 THEN
        RAISE EXCEPTION 'PLA-0007 089: backfill left % users with NULL role_id', n;
    END IF;
END $$;

-- Now make users.role_id NOT NULL.
ALTER TABLE users
    ALTER COLUMN role_id SET NOT NULL;

-- KEEP users.role for one full release cycle. Migration Z drops it later.


-- ── Step 4: page_roles.role_id (and drop the old enum column —
--     page_roles is internal, no external readers).
-- ============================================================
ALTER TABLE page_roles
    ADD COLUMN role_id UUID REFERENCES roles(id) ON DELETE CASCADE;

UPDATE page_roles
SET role_id = '00000000-0000-0000-0000-00000000ad30'  -- gadmin
WHERE role = 'gadmin';

UPDATE page_roles
SET role_id = '00000000-0000-0000-0000-00000000ad25'  -- padmin
WHERE role = 'padmin';

UPDATE page_roles
SET role_id = '00000000-0000-0000-0000-00000000ad10'  -- user
WHERE role = 'user';

DO $$
DECLARE
    n INTEGER;
BEGIN
    SELECT COUNT(*) INTO n FROM page_roles WHERE role_id IS NULL;
    IF n > 0 THEN
        RAISE EXCEPTION 'PLA-0007 089: page_roles backfill left % rows with NULL role_id', n;
    END IF;
END $$;

ALTER TABLE page_roles
    ALTER COLUMN role_id SET NOT NULL;

-- Replace the old PK (page_id, role) with (page_id, role_id) and drop role.
ALTER TABLE page_roles DROP CONSTRAINT page_roles_pkey;
ALTER TABLE page_roles ADD PRIMARY KEY (page_id, role_id);
DROP INDEX IF EXISTS idx_page_roles_role;
ALTER TABLE page_roles DROP COLUMN role;
CREATE INDEX idx_page_roles_role_id ON page_roles (role_id);


-- ── Step 5: rewrite provision_on_first_gadmin trigger to compare
--     against the seeded gadmin role row, not the enum literal.
-- ============================================================
-- We keep dual-readiness: while users.role still exists, the trigger
-- can compare on either column. We compare on role_id only — that's
-- the post-migration source of truth.
CREATE OR REPLACE FUNCTION provision_on_first_gadmin()
RETURNS TRIGGER AS $$
DECLARE
    v_gadmin_role_id UUID := '00000000-0000-0000-0000-00000000ad30';
BEGIN
    IF NEW.role_id = v_gadmin_role_id AND NEW.is_active = TRUE THEN
        IF NOT EXISTS (
            SELECT 1 FROM company_roadmap WHERE subscription_id = NEW.subscription_id
        ) THEN
            PERFORM provision_subscription_defaults(NEW.subscription_id, NEW.id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ── Step 6: PROTECTED-ACCOUNT PRESERVATION ASSERTION.
-- ============================================================
-- Diff the snapshot taken at Step 1 against current state. If any
-- credential field has changed, abort the entire migration.
-- The only permitted change is role_id (which is the whole point
-- of this migration); password_hash, email, is_active, and
-- password_changed_at MUST be unchanged.
DO $$
DECLARE
    drift INTEGER;
    drift_email TEXT;
BEGIN
    SELECT COUNT(*), MIN(s.email)
    INTO drift, drift_email
    FROM _pla7_protected_snapshot s
    JOIN users u ON u.id = s.id
    WHERE
        u.email                IS DISTINCT FROM s.email
        OR u.password_hash      IS DISTINCT FROM s.password_hash
        OR u.is_active          IS DISTINCT FROM s.is_active
        OR u.password_changed_at IS DISTINCT FROM s.password_changed_at;

    IF drift > 0 THEN
        RAISE EXCEPTION
            'PLA-0007 089: HARD-RULE breach — % protected account(s) drifted (first: %); aborting migration',
            drift, drift_email;
    END IF;

    -- Verify role_id assignments landed where expected.
    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE email = 'gadmin@mmffdev.com'
          AND role_id = '00000000-0000-0000-0000-00000000ad30'
    ) THEN
        RAISE EXCEPTION 'PLA-0007 089: gadmin@mmffdev.com role_id did not bind to seeded gadmin role';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE email = 'padmin@mmffdev.com'
          AND role_id = '00000000-0000-0000-0000-00000000ad25'
    ) THEN
        RAISE EXCEPTION 'PLA-0007 089: padmin@mmffdev.com role_id did not bind to seeded padmin role';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE email = 'user@mmffdev.com'
          AND role_id = '00000000-0000-0000-0000-00000000ad10'
    ) THEN
        RAISE EXCEPTION 'PLA-0007 089: user@mmffdev.com role_id did not bind to seeded user role';
    END IF;

    RAISE NOTICE 'PLA-0007 089: protected-account preservation OK (3/3 unchanged, role_ids bound)';
END $$;
