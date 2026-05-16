-- ============================================================
-- 198_pages_access_version.sql
--
-- PLA-0049 Phase 0.5.1 — global page-access invalidation primitive.
--
-- Singleton table holding one BIGINT. Every backend instance reads
-- this on a per-request middleware hot path (with a short in-process
-- cache) to decide whether the per-user page-access set it has
-- cached is still valid. The version is bumped by AFTER triggers on
-- the two tables that affect page access:
--
--   • users_roles_pages   — direct (page_id, role_id) grant matrix
--   • users_roles         — adding/removing/updating a role can
--                           transitively change who sees what
--
-- Why a singleton (not per-tenant): page-grant changes today are
-- gadmin-only and operate at the system-page level (subscription_id
-- IS NULL on the page row). A single global version is the simplest
-- correct invariant. Per-tenant version would be a future
-- optimisation if tenant-custom roles ever start churning at scale.
--
-- Why BIGINT (not TIMESTAMPTZ): integer compares are faster, version
-- is monotone-increasing (no clock-skew concerns across replicas if
-- this ever runs in HA), and the in-process cache key is a single
-- 8-byte read.
--
-- Why a row-level singleton (not a sequence): sequences advance on
-- every INSERT regardless of transaction outcome, leaving gaps. A
-- row-level UPDATE inside the trigger advances atomically with the
-- triggering write — no spurious bumps if the source change rolls
-- back.
-- ============================================================

BEGIN;

-- ── Singleton table ─────────────────────────────────────────
-- One row, locked to id=1. CHECK constraint refuses any other id;
-- INSERT is done once here at boot.
CREATE TABLE pages_access_version (
    pages_access_version_id      INTEGER     NOT NULL CHECK (pages_access_version_id = 1),
    pages_access_version_value   BIGINT      NOT NULL DEFAULT 1,
    pages_access_version_bumped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (pages_access_version_id)
);

COMMENT ON TABLE pages_access_version IS
'PLA-0049: singleton holding the global page-access version. Bumped by triggers on users_roles_pages and users_roles. Read every request by auth.RequirePageAccess to decide whether per-user access cache is stale.';

INSERT INTO pages_access_version (pages_access_version_id, pages_access_version_value)
VALUES (1, 1);

-- ── Bump function ───────────────────────────────────────────
-- Single function reused by both triggers. Increments value +1 and
-- stamps bumped_at = NOW(). Returns NULL because it's an AFTER trigger
-- (return value ignored).
CREATE OR REPLACE FUNCTION pages_access_version_bump()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE pages_access_version
       SET pages_access_version_value     = pages_access_version_value + 1,
           pages_access_version_bumped_at = NOW()
     WHERE pages_access_version_id = 1;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ── Triggers ────────────────────────────────────────────────
-- AFTER triggers (not BEFORE) so the bump only fires after the source
-- write has committed in the current statement. STATEMENT (not ROW)
-- so a bulk INSERT/DELETE bumps once, not N times — the version
-- semantics are "something changed since you last looked", not
-- "exactly N changes happened".

CREATE TRIGGER users_roles_pages_bump_access_version
    AFTER INSERT OR UPDATE OR DELETE ON users_roles_pages
    FOR EACH STATEMENT
    EXECUTE FUNCTION pages_access_version_bump();

CREATE TRIGGER users_roles_bump_access_version
    AFTER INSERT OR UPDATE OR DELETE ON users_roles
    FOR EACH STATEMENT
    EXECUTE FUNCTION pages_access_version_bump();

-- ── Sanity ──────────────────────────────────────────────────
DO $$
DECLARE n int; v bigint;
BEGIN
    SELECT COUNT(*) INTO n FROM pages_access_version;
    IF n <> 1 THEN
        RAISE EXCEPTION 'PLA-0049 mig 198: expected 1 singleton row, found %', n;
    END IF;

    SELECT pages_access_version_value INTO v FROM pages_access_version WHERE pages_access_version_id = 1;
    IF v < 1 THEN
        RAISE EXCEPTION 'PLA-0049 mig 198: singleton value % is invalid', v;
    END IF;
END $$;

COMMIT;
