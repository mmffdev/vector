-- ============================================================
-- 196_repoint_role_references.sql
--
-- PLA-0049 Phase 0.3 — repoint every FK reference from the 5
-- legacy system roles (rank-encoded UUIDs ad05/ad10/ad20/ad25/ad30)
-- to the 7 new grp_* system roles seeded in mig 194, then DELETE
-- the legacy rows.
--
-- Mapping (chosen to preserve grant inheritance where possible):
--   gadmin     (…ad30)  →  grp_global       (rank 70)
--   padmin     (…ad25)  →  grp_portfolio    (rank 60)
--   team_lead  (…ad20)  →  grp_team_lead    (rank 40)
--   user       (…ad10)  →  grp_team_member  (rank 30)
--   external   (…ad05)  →  grp_external     (rank 10)
--
-- The two NEW roles grp_product (rank 50) and grp_stakeholder
-- (rank 20) are intentionally NOT mapped from any legacy row.
-- They start with ZERO grants — gadmin will populate them via
-- the page-permissions grid (Phase 1) and the lock-in seed
-- migration (Phase 2).
--
-- Affected tables (re-pointed in this migration):
--   1. users.role_id                                 (UUID FK)
--   2. users_roles_pages.users_roles_pages_id_role   (UUID FK)
--   3. users_roles_permissions.users_roles_permissions_id_role
--                                                    (UUID FK)
--
-- After re-point: DELETE the 5 legacy rows from users_roles.
-- Cascade behaviour: users_roles_pages and users_roles_permissions
-- both have ON DELETE CASCADE on id_role, but they no longer
-- reference the old rows post-repoint, so the DELETEs are safe.
-- users.role_id has ON DELETE RESTRICT — the DELETE would fail
-- if we forgot to repoint a user, which is the desired safety net.
--
-- Legacy users.role enum column is also updated for the dual-read
-- window:
--   role_id → grp_global       =>  role enum := 'gadmin'
--   role_id → grp_portfolio    =>  role enum := 'padmin'
--   role_id → anything else    =>  role enum := 'user' (coarsest bucket)
-- The enum will be dropped in deferred Migration Z; this is the
-- coarse fallback for any reader still on the legacy column.
--
-- HARD-RULE COMPLIANCE: this migration touches users.role_id and
-- users.role on the 5 protected human accounts (gadmin@, padmin@,
-- user@, claude@, cookra@). It does NOT touch password_hash, email,
-- is_active, or password_changed_at — those columns are excluded
-- from every UPDATE here. Per CLAUDE.md, role_id changes are NOT
-- on the immutability list (only the credential fields are).
-- ============================================================

BEGIN;

-- ── Step 0. Capture the new role UUIDs into temp variables ──
DO $$
DECLARE
    new_global       UUID;
    new_portfolio    UUID;
    new_team_lead    UUID;
    new_team_member  UUID;
    new_external     UUID;
BEGIN
    SELECT users_roles_id INTO new_global
      FROM users_roles WHERE users_roles_code = 'grp_global'      AND users_roles_id_subscription IS NULL;
    SELECT users_roles_id INTO new_portfolio
      FROM users_roles WHERE users_roles_code = 'grp_portfolio'   AND users_roles_id_subscription IS NULL;
    SELECT users_roles_id INTO new_team_lead
      FROM users_roles WHERE users_roles_code = 'grp_team_lead'   AND users_roles_id_subscription IS NULL;
    SELECT users_roles_id INTO new_team_member
      FROM users_roles WHERE users_roles_code = 'grp_team_member' AND users_roles_id_subscription IS NULL;
    SELECT users_roles_id INTO new_external
      FROM users_roles WHERE users_roles_code = 'grp_external'    AND users_roles_id_subscription IS NULL;

    IF new_global IS NULL OR new_portfolio IS NULL OR new_team_lead IS NULL
       OR new_team_member IS NULL OR new_external IS NULL THEN
        RAISE EXCEPTION 'PLA-0049 mig 196: missing one or more grp_* system roles (mig 194 not applied?)';
    END IF;

    -- ── Step 1. Repoint users.role_id (NOT NULL FK) ─────────
    UPDATE users SET role_id = new_global      WHERE role_id = '00000000-0000-0000-0000-00000000ad30';
    UPDATE users SET role_id = new_portfolio   WHERE role_id = '00000000-0000-0000-0000-00000000ad25';
    UPDATE users SET role_id = new_team_lead   WHERE role_id = '00000000-0000-0000-0000-00000000ad20';
    UPDATE users SET role_id = new_team_member WHERE role_id = '00000000-0000-0000-0000-00000000ad10';
    UPDATE users SET role_id = new_external    WHERE role_id = '00000000-0000-0000-0000-00000000ad05';

    -- ── Step 2. Repoint users_roles_pages.users_roles_pages_id_role ─
    -- Conflict guard: if a page already has a row for the new role
    -- (shouldn't happen on a clean DB — defensive), keep the existing
    -- row and DELETE the duplicate.
    DELETE FROM users_roles_pages a
     USING users_roles_pages b
     WHERE a.users_roles_pages_id_page = b.users_roles_pages_id_page
       AND a.users_roles_pages_id_role IN (
           '00000000-0000-0000-0000-00000000ad30'::uuid,
           '00000000-0000-0000-0000-00000000ad25'::uuid,
           '00000000-0000-0000-0000-00000000ad20'::uuid,
           '00000000-0000-0000-0000-00000000ad10'::uuid,
           '00000000-0000-0000-0000-00000000ad05'::uuid)
       AND b.users_roles_pages_id_role IN (new_global, new_portfolio, new_team_lead, new_team_member, new_external)
       AND CASE a.users_roles_pages_id_role
           WHEN '00000000-0000-0000-0000-00000000ad30'::uuid THEN new_global
           WHEN '00000000-0000-0000-0000-00000000ad25'::uuid THEN new_portfolio
           WHEN '00000000-0000-0000-0000-00000000ad20'::uuid THEN new_team_lead
           WHEN '00000000-0000-0000-0000-00000000ad10'::uuid THEN new_team_member
           WHEN '00000000-0000-0000-0000-00000000ad05'::uuid THEN new_external
           END = b.users_roles_pages_id_role;

    UPDATE users_roles_pages SET users_roles_pages_id_role = new_global      WHERE users_roles_pages_id_role = '00000000-0000-0000-0000-00000000ad30';
    UPDATE users_roles_pages SET users_roles_pages_id_role = new_portfolio   WHERE users_roles_pages_id_role = '00000000-0000-0000-0000-00000000ad25';
    UPDATE users_roles_pages SET users_roles_pages_id_role = new_team_lead   WHERE users_roles_pages_id_role = '00000000-0000-0000-0000-00000000ad20';
    UPDATE users_roles_pages SET users_roles_pages_id_role = new_team_member WHERE users_roles_pages_id_role = '00000000-0000-0000-0000-00000000ad10';
    UPDATE users_roles_pages SET users_roles_pages_id_role = new_external    WHERE users_roles_pages_id_role = '00000000-0000-0000-0000-00000000ad05';

    -- ── Step 3. Repoint users_roles_permissions ─────────────
    -- Same conflict guard as step 2: dedupe before update.
    DELETE FROM users_roles_permissions a
     USING users_roles_permissions b
     WHERE a.users_roles_permissions_id_permission = b.users_roles_permissions_id_permission
       AND a.users_roles_permissions_id_role IN (
           '00000000-0000-0000-0000-00000000ad30'::uuid,
           '00000000-0000-0000-0000-00000000ad25'::uuid,
           '00000000-0000-0000-0000-00000000ad20'::uuid,
           '00000000-0000-0000-0000-00000000ad10'::uuid,
           '00000000-0000-0000-0000-00000000ad05'::uuid)
       AND b.users_roles_permissions_id_role IN (new_global, new_portfolio, new_team_lead, new_team_member, new_external)
       AND CASE a.users_roles_permissions_id_role
           WHEN '00000000-0000-0000-0000-00000000ad30'::uuid THEN new_global
           WHEN '00000000-0000-0000-0000-00000000ad25'::uuid THEN new_portfolio
           WHEN '00000000-0000-0000-0000-00000000ad20'::uuid THEN new_team_lead
           WHEN '00000000-0000-0000-0000-00000000ad10'::uuid THEN new_team_member
           WHEN '00000000-0000-0000-0000-00000000ad05'::uuid THEN new_external
           END = b.users_roles_permissions_id_role;

    UPDATE users_roles_permissions SET users_roles_permissions_id_role = new_global      WHERE users_roles_permissions_id_role = '00000000-0000-0000-0000-00000000ad30';
    UPDATE users_roles_permissions SET users_roles_permissions_id_role = new_portfolio   WHERE users_roles_permissions_id_role = '00000000-0000-0000-0000-00000000ad25';
    UPDATE users_roles_permissions SET users_roles_permissions_id_role = new_team_lead   WHERE users_roles_permissions_id_role = '00000000-0000-0000-0000-00000000ad20';
    UPDATE users_roles_permissions SET users_roles_permissions_id_role = new_team_member WHERE users_roles_permissions_id_role = '00000000-0000-0000-0000-00000000ad10';
    UPDATE users_roles_permissions SET users_roles_permissions_id_role = new_external    WHERE users_roles_permissions_id_role = '00000000-0000-0000-0000-00000000ad05';

    -- ── Step 4. Update legacy users.role enum coarse fallback ─
    -- Only two new roles map cleanly to existing enum slots. Everyone
    -- else (team_lead/team_member/stakeholder/product/external)
    -- coarsens to 'user' for the dual-read window.
    UPDATE users SET role = 'gadmin'::user_role WHERE role_id = new_global;
    UPDATE users SET role = 'padmin'::user_role WHERE role_id = new_portfolio;
    UPDATE users SET role = 'user'::user_role
     WHERE role_id IN (new_team_lead, new_team_member, new_external)
        OR role_id IN (
            SELECT users_roles_id FROM users_roles
             WHERE users_roles_code IN ('grp_product', 'grp_stakeholder')
               AND users_roles_id_subscription IS NULL
        );

    -- ── Step 5. DELETE the legacy system rows ───────────────
    DELETE FROM users_roles
     WHERE users_roles_is_system = TRUE
       AND users_roles_id IN (
           '00000000-0000-0000-0000-00000000ad30'::uuid,
           '00000000-0000-0000-0000-00000000ad25'::uuid,
           '00000000-0000-0000-0000-00000000ad20'::uuid,
           '00000000-0000-0000-0000-00000000ad10'::uuid,
           '00000000-0000-0000-0000-00000000ad05'::uuid
       );

    -- ── Step 6. Sanity ──────────────────────────────────────
    PERFORM 1 FROM users_roles
     WHERE users_roles_id IN (
         '00000000-0000-0000-0000-00000000ad30'::uuid,
         '00000000-0000-0000-0000-00000000ad25'::uuid,
         '00000000-0000-0000-0000-00000000ad20'::uuid,
         '00000000-0000-0000-0000-00000000ad10'::uuid,
         '00000000-0000-0000-0000-00000000ad05'::uuid
     );
    IF FOUND THEN
        RAISE EXCEPTION 'PLA-0049 mig 196: legacy system role row(s) survived DELETE';
    END IF;

    PERFORM 1 FROM users WHERE role_id IN (
        '00000000-0000-0000-0000-00000000ad30'::uuid,
        '00000000-0000-0000-0000-00000000ad25'::uuid,
        '00000000-0000-0000-0000-00000000ad20'::uuid,
        '00000000-0000-0000-0000-00000000ad10'::uuid,
        '00000000-0000-0000-0000-00000000ad05'::uuid
    );
    IF FOUND THEN
        RAISE EXCEPTION 'PLA-0049 mig 196: at least one users.role_id still points at a legacy UUID';
    END IF;
END $$;

COMMIT;
