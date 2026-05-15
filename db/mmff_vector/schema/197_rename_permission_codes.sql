-- ============================================================
-- 197_rename_permission_codes.sql
--
-- PLA-0049 Phase 0.4 — rename the 5 legacy users.create.<code>
-- permissions to users.create.grp_* to match the new role codes
-- seeded in mig 194, and add the 2 new codes for the brand-new
-- system roles (grp_product, grp_stakeholder).
--
-- Renames (UPDATE on existing rows — keeps the permission UUIDs
-- and all junction grants intact, only the human-facing code
-- changes):
--   users.create.gadmin     →  users.create.grp_global
--   users.create.padmin     →  users.create.grp_portfolio
--   users.create.team_lead  →  users.create.grp_team_lead
--   users.create.user       →  users.create.grp_team_member
--   users.create.external   →  users.create.grp_external
--
-- Inserts (NEW permissions for the two new system roles):
--   users.create.grp_product
--   users.create.grp_stakeholder
--
-- The label is updated in lockstep so the /admin/roles UI shows
-- the new product names, not the legacy ones.
--
-- Junction rows in users_roles_permissions are not touched —
-- they reference users_permissions.users_permissions_id (UUID)
-- which is stable across rename. Anyone who could create a
-- gadmin yesterday can create a grp_global today via the same
-- grant row.
--
-- The Go-side permissions catalogue (backend/internal/permissions/
-- catalogue.go) is updated in the same Phase 0 commit so the
-- init() parity check between DB and code does not blow up.
-- ============================================================

BEGIN;

-- ── Step 1. Rename the 5 legacy creator-matrix permissions ──
UPDATE users_permissions
   SET users_permissions_code  = 'users.create.grp_global',
       users_permissions_label = 'Create Global Admin users'
 WHERE users_permissions_code = 'users.create.gadmin';

UPDATE users_permissions
   SET users_permissions_code  = 'users.create.grp_portfolio',
       users_permissions_label = 'Create Portfolio Manager users'
 WHERE users_permissions_code = 'users.create.padmin';

UPDATE users_permissions
   SET users_permissions_code  = 'users.create.grp_team_lead',
       users_permissions_label = 'Create Team Lead users'
 WHERE users_permissions_code = 'users.create.team_lead';

UPDATE users_permissions
   SET users_permissions_code  = 'users.create.grp_team_member',
       users_permissions_label = 'Create Team Member users'
 WHERE users_permissions_code = 'users.create.user';

UPDATE users_permissions
   SET users_permissions_code  = 'users.create.grp_external',
       users_permissions_label = 'Create users under any External-archetype role'
 WHERE users_permissions_code = 'users.create.external';

-- ── Step 2. Insert the 2 new creator-matrix permissions ─────
INSERT INTO users_permissions (
    users_permissions_id,
    users_permissions_code,
    users_permissions_label,
    users_permissions_category,
    users_permissions_description
) VALUES
    (gen_random_uuid(), 'users.create.grp_product',
     'Create Product Owner users',
     'users',
     'Permission to create users with the Product Owner system role.'),
    (gen_random_uuid(), 'users.create.grp_stakeholder',
     'Create Stakeholder users',
     'users',
     'Permission to create users with the Stakeholder system role.')
ON CONFLICT (users_permissions_code) DO NOTHING;

-- ── Step 3. Auto-grant the 2 new perms to grp_global ────────
-- grp_global has universal authority by design; it must be able
-- to create users in either of the new roles. The other system
-- roles (grp_portfolio / grp_team_lead etc.) start with NO
-- create grants for grp_product / grp_stakeholder — gadmin can
-- assign these later via the page-permissions grid pattern (or
-- through the /admin/roles permission grid).
DO $$
DECLARE
    grp_global_id UUID;
    perm_product  UUID;
    perm_stake    UUID;
BEGIN
    SELECT users_roles_id INTO grp_global_id
      FROM users_roles
     WHERE users_roles_code = 'grp_global'
       AND users_roles_id_subscription IS NULL;

    SELECT users_permissions_id INTO perm_product
      FROM users_permissions
     WHERE users_permissions_code = 'users.create.grp_product';

    SELECT users_permissions_id INTO perm_stake
      FROM users_permissions
     WHERE users_permissions_code = 'users.create.grp_stakeholder';

    IF grp_global_id IS NULL OR perm_product IS NULL OR perm_stake IS NULL THEN
        RAISE EXCEPTION 'PLA-0049 mig 197: missing prerequisites (grp_global=%, perm_product=%, perm_stake=%)',
            grp_global_id, perm_product, perm_stake;
    END IF;

    INSERT INTO users_roles_permissions (
        users_roles_permissions_id_role,
        users_roles_permissions_id_permission
    ) VALUES
        (grp_global_id, perm_product),
        (grp_global_id, perm_stake)
    ON CONFLICT DO NOTHING;
END $$;

-- ── Step 4. Sanity ──────────────────────────────────────────
DO $$
DECLARE
    legacy_remaining int;
    new_codes        int;
BEGIN
    SELECT COUNT(*) INTO legacy_remaining
      FROM users_permissions
     WHERE users_permissions_code IN (
        'users.create.gadmin','users.create.padmin','users.create.team_lead',
        'users.create.user','users.create.external');
    IF legacy_remaining > 0 THEN
        RAISE EXCEPTION 'PLA-0049 mig 197: % legacy users.create.<old> code(s) survived rename', legacy_remaining;
    END IF;

    SELECT COUNT(*) INTO new_codes
      FROM users_permissions
     WHERE users_permissions_code LIKE 'users.create.grp_%';
    IF new_codes <> 7 THEN
        RAISE EXCEPTION 'PLA-0049 mig 197: expected 7 users.create.grp_* codes, found %', new_codes;
    END IF;
END $$;

COMMIT;
