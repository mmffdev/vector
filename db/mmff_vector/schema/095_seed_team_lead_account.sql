-- ============================================================
-- MMFFDev - Vector: Provision team_lead@mmffdev.com  (PLA-0007 / 00309)
-- Migration 095
--
-- Seeds the Team Lead reference account that PLA-0007 was originally
-- asked for. This is a NEW row — it is NOT one of the protected human
-- accounts (gadmin@/padmin@/user@). The CLAUDE.md HARD RULE applies
-- only to those three rows; team_lead@mmffdev.com is a fixture
-- account that test suites and operators may rely on.
--
-- Password: password123! (bcrypt cost 12, generated inline by
-- pgcrypto's gen_salt('bf', 12) — same cost factor used elsewhere
-- in this schema). The login is intended for development and
-- automated test-suite use only. force_password_change is FALSE so
-- e2e tests can log in directly without a reset interception.
--
-- This migration is also the carrier for the protected-account
-- preservation assertion that 00309 promises (PLA-0007 acceptance
-- criterion #10): the gadmin@/padmin@/user@ rows must remain
-- byte-for-byte unchanged in their credential fields. We snapshot
-- before the INSERT, run the INSERT, then diff. If the diff is
-- non-empty the entire migration aborts.
--
-- Idempotency: ON CONFLICT (email) on the team_lead INSERT means
-- re-running the migration is a no-op for that row.
-- ============================================================

BEGIN;

-- ── Step 1: snapshot protected-account credential fields BEFORE the INSERT.
-- ============================================================
-- The ON COMMIT DROP keeps this temp table local to this migration.
CREATE TEMP TABLE _pla7_309_snapshot ON COMMIT DROP AS
SELECT
    u.id,
    u.email,
    u.password_hash,
    u.is_active,
    u.password_changed_at,
    u.role_id
FROM users u
WHERE u.email IN ('gadmin@mmffdev.com', 'padmin@mmffdev.com', 'user@mmffdev.com')
  AND u.subscription_id = '00000000-0000-0000-0000-000000000001';

DO $$
DECLARE
    n INTEGER;
BEGIN
    SELECT COUNT(*) INTO n FROM _pla7_309_snapshot;
    IF n <> 3 THEN
        RAISE EXCEPTION 'PLA-0007 095: expected 3 protected accounts in snapshot, found %; aborting before any change', n;
    END IF;
END $$;


-- ── Step 2: confirm the team_lead system role row exists.
-- ============================================================
-- Migration 088 seeds it with a fixed UUID; this is a defensive
-- check so we fail loudly here rather than via a silent FK error.
DO $$
DECLARE
    n INTEGER;
BEGIN
    SELECT COUNT(*) INTO n FROM roles
    WHERE id = '00000000-0000-0000-0000-00000000ad20'
      AND code = 'team_lead'
      AND subscription_id IS NULL;
    IF n <> 1 THEN
        RAISE EXCEPTION 'PLA-0007 095: team_lead system role row not found; migration 088 missing or drifted';
    END IF;
END $$;


-- ── Step 3: provision team_lead@mmffdev.com.
-- ============================================================
-- Defensive against the legacy users.role enum column (089 keeps
-- it for one release cycle; some envs may have already dropped it
-- in a follow-up release). The INSERT path is built dynamically so
-- the same migration runs cleanly on both shapes.
DO $$
DECLARE
    legacy_role_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'role'
    ) INTO legacy_role_exists;

    IF legacy_role_exists THEN
        -- The user_role enum has only ('user','padmin','gadmin') —
        -- 'team_lead' is not a member. We pin the legacy column to
        -- 'user' (its DEFAULT) and let role_id carry the real role.
        -- The Z migration drops users.role; until then the two
        -- columns are allowed to diverge for new accounts.
        EXECUTE $sql$
            INSERT INTO users (
                subscription_id, email, password_hash, role, role_id,
                is_active, force_password_change
            )
            VALUES (
                '00000000-0000-0000-0000-000000000001',
                'team_lead@mmffdev.com',
                crypt('password123!', gen_salt('bf', 12)),
                'user'::user_role,
                '00000000-0000-0000-0000-00000000ad20',
                TRUE,
                FALSE
            )
            ON CONFLICT (email, subscription_id) DO NOTHING
        $sql$;
    ELSE
        EXECUTE $sql$
            INSERT INTO users (
                subscription_id, email, password_hash, role_id,
                is_active, force_password_change
            )
            VALUES (
                '00000000-0000-0000-0000-000000000001',
                'team_lead@mmffdev.com',
                crypt('password123!', gen_salt('bf', 12)),
                '00000000-0000-0000-0000-00000000ad20',
                TRUE,
                FALSE
            )
            ON CONFLICT (email, subscription_id) DO NOTHING
        $sql$;
    END IF;
END $$;


-- ── Step 4: protected-account preservation assertion.
-- ============================================================
-- HARD RULE check — diff the snapshot against current state for the
-- three protected accounts. The only fields we tolerate moving are
-- the non-credential ones (updated_at can wobble if the row was
-- touched by another migration); the credential fields below MUST
-- be unchanged.
DO $$
DECLARE
    drift INTEGER;
    drift_email TEXT;
BEGIN
    SELECT COUNT(*), MIN(s.email)
    INTO drift, drift_email
    FROM _pla7_309_snapshot s
    JOIN users u ON u.id = s.id
    WHERE
        u.email                IS DISTINCT FROM s.email
        OR u.password_hash      IS DISTINCT FROM s.password_hash
        OR u.is_active          IS DISTINCT FROM s.is_active
        OR u.password_changed_at IS DISTINCT FROM s.password_changed_at
        OR u.role_id            IS DISTINCT FROM s.role_id;

    IF drift > 0 THEN
        RAISE EXCEPTION
            'PLA-0007 095: HARD-RULE breach — % protected account(s) drifted (first: %); aborting',
            drift, drift_email;
    END IF;
END $$;


-- ── Step 5: positive assertion that team_lead@ landed correctly.
-- ============================================================
DO $$
DECLARE
    found_role UUID;
BEGIN
    SELECT role_id INTO found_role
    FROM users
    WHERE email = 'team_lead@mmffdev.com'
      AND subscription_id = '00000000-0000-0000-0000-000000000001';

    IF found_role IS NULL THEN
        RAISE EXCEPTION 'PLA-0007 095: team_lead@mmffdev.com row not found post-INSERT';
    END IF;

    IF found_role <> '00000000-0000-0000-0000-00000000ad20' THEN
        RAISE EXCEPTION
            'PLA-0007 095: team_lead@mmffdev.com role_id is % (expected ad20)',
            found_role;
    END IF;
END $$;

COMMIT;
