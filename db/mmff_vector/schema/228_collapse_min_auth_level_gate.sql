-- Migration 228 — PLA-0053 / B5.11
-- Collapse the page-access gate down to a single layer: users_roles_pages.
--
-- pages_tags.pages_tags_min_auth_level was added in migration 221 as a
-- tag-tier gate, with rank-derived auth_level on the user side (rank 70
-- → 1, rank 60 → 2, else 3) and the rail dropping any tag whose level
-- was below the user's tier. That created TWO gates on the same surface:
--
--   1. users_roles_pages   — per-role × per-page grant (PLA-0049)
--   2. pages_tags.min_auth_level — coarse tag-tier gate (this migration)
--
-- Gate (1) is the authoritative one — it's what /user-management/permissions
-- writes. Gate (2) was a defence-in-depth tier filter that ended up
-- short-circuiting (1): a user with explicit page-grants for /dev/* would
-- still be denied because their tag bucket was below their tier.
--
-- This migration drops the NOT NULL constraint, default, and CHECK so
-- the column becomes inert but rollback-safe. Backend code stops scanning
-- it in B5.12; frontend stops reading it in B5.13. If we need to revive
-- the tier gate, the DOWN file re-applies migration 221's seed values and
-- the code revert reinstates the filter.
--
-- pages_tags_is_admin_menu is **kept** as-is — that column is used by
-- UserAvatarMenu to route notifications + avatar buckets into the
-- profile dropdown, which is a separate concern from page-access gating.

BEGIN;

-- Stop enforcing the column. NULL means "no tier opinion"; existing
-- seeded values are preserved for rollback evidence.
ALTER TABLE pages_tags
    ALTER COLUMN pages_tags_min_auth_level DROP NOT NULL,
    ALTER COLUMN pages_tags_min_auth_level DROP DEFAULT;

-- Remove the CHECK so future writers aren't bound by the 1..3 vocabulary.
-- The constraint name was inline (anonymous) in 221; locate it via
-- information_schema rather than guess.
DO $$
DECLARE
    cn text;
BEGIN
    SELECT conname INTO cn
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'pages_tags'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%pages_tags_min_auth_level%';
    IF cn IS NOT NULL THEN
        EXECUTE format('ALTER TABLE pages_tags DROP CONSTRAINT %I', cn);
    END IF;
END$$;

COMMENT ON COLUMN pages_tags.pages_tags_min_auth_level IS
    'INERT as of migration 228 (PLA-0053 / B5.11). Tier gate collapsed in '
    'favour of users_roles_pages as the sole page-access authority. Column '
    'retained nullable for rollback only. See docs/c_c_roles_permissions.md '
    'for the single-gate ADR.';

COMMIT;
