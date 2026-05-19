-- TD-RAIL-ADMIN-TAGS (2026-05-19) — replace the binary is_admin_menu
-- gate on pages_tags with a tiered auth level so the primary nav rail
-- can show DIFFERENT admin surfaces to DIFFERENT admin roles.
--
-- Level vocabulary (low number = higher privilege):
--   1 = Vector Admin (gadmin / grp_global only)
--   2 = Workspace Admin (padmin / grp_portfolio and above)
--   3 = Everyone (default — user-facing buckets)
--
-- A user at rail-render time sees a tag iff its min_auth_level >=
-- the user's own auth_level (Global → 1, Portfolio → 2, others → 3).
-- That makes gadmin a superset of padmin's view, and padmin a superset
-- of a Team Member's view.
--
-- Seed mapping for the 4 admin tags 220 had flagged is_admin_menu=TRUE:
--   vector_admin    → 1   (Vector ops; gadmin only)
--   user_management → 1   (tenant-admin surface; gadmin only)
--   workspace_admin → 2   (workspace ops; padmin + gadmin)
--   dev_tools       → 1   (dev-only; will be detached pre-prod)
--
-- 220 also flipped is_admin_menu=TRUE on those four — that flag was
-- always meant for notifications/avatar_menu (admin avatar dropdown).
-- Revert the four so the rail's filter chain is governed only by
-- min_auth_level and the avatar/cog menu keeps its original contract.

BEGIN;

ALTER TABLE pages_tags
    ADD COLUMN IF NOT EXISTS pages_tags_min_auth_level smallint NOT NULL DEFAULT 3
        CHECK (pages_tags_min_auth_level BETWEEN 1 AND 3);

COMMENT ON COLUMN pages_tags.pages_tags_min_auth_level IS
    'Minimum admin tier required to see this tag on the primary nav rail. '
    '1=Vector Admin, 2=Workspace Admin, 3=Everyone. User-side auth_level is '
    'derived from users_roles.rank (Global→1, Portfolio→2, else→3).';

-- Seed: only the four admin tags get an elevated level. Everything else
-- keeps the column default of 3 (visible to everyone).
UPDATE pages_tags
   SET pages_tags_min_auth_level = 1
 WHERE pages_tags_tag_enum IN ('vector_admin', 'user_management', 'dev_tools');

UPDATE pages_tags
   SET pages_tags_min_auth_level = 2
 WHERE pages_tags_tag_enum = 'workspace_admin';

-- Revert 220's is_admin_menu writes on these four. They never belonged
-- on the avatar-menu surface; the rail-side gate is now min_auth_level.
UPDATE pages_tags
   SET pages_tags_is_admin_menu = FALSE
 WHERE pages_tags_tag_enum IN (
       'vector_admin',
       'user_management',
       'workspace_admin',
       'dev_tools'
   );

COMMIT;
