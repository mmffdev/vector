-- Migration 245: Add the "Value" primary-nav bucket + 4 child pages.
-- Follows the pattern from migrations 009 (seed), 238, 239, 240.
--
-- New bucket sits directly under "Planning" in rail-1 ordering.
-- Live pages_tags spacing is by 10s (personal=10, bookmarks=20,
-- planning=30, strategy=40, …); slot 35 puts Value between Planning
-- and Strategy without disturbing the other tags.
--
-- Note: the live table is `pages_tags` (plural) with prefixed columns
-- per the PLA-0049-era naming refactor — the original 009 seed created
-- `page_tags` which was later renamed. `pages` keeps short column names.
--
-- The 4 child pages are seeded with default_order so that "Value Status"
-- is rank 0 (default landing page when the bucket is selected — Rail 1
-- routes to s.pages[0].href, which after default_pinned backfill is
-- ordered by pages.default_order).
--
-- Icon: paper-plane (added to app/components/nav_primary_rail_NavPageIcons.tsx
-- as a fresh case; user requested fa6:FaRegPaperPlane, mapped into the
-- project's hand-rolled icon catalogue).

BEGIN;

-- ----------------------------------------------------------------
-- Step 1: Insert the new 'value' tag at slot 35 (under Planning=30).
-- ----------------------------------------------------------------
INSERT INTO pages_tags (pages_tags_tag_enum, pages_tags_display_name, pages_tags_default_order, pages_tags_is_admin_menu)
VALUES ('value', 'Value', 35, FALSE)
ON CONFLICT (pages_tags_tag_enum) DO NOTHING;

-- ----------------------------------------------------------------
-- Step 2: Insert the 4 Value child pages + grant all user-roles.
-- default_order drives the initial position when default_pinned
-- pages are auto-seeded into a fresh users_nav_prefs row, which in
-- turn drives "first page" routing when the bucket is clicked.
-- ----------------------------------------------------------------
WITH inserted AS (
    INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order, created_by, subscription_id)
    VALUES
        ('value-status',       'Value Status', '/value-status',       'paper-plane', 'value', 'static', TRUE, TRUE, 0, NULL, NULL),
        ('value-sprint',       'Sprint',       '/value-sprint',       'sprint',      'value', 'static', TRUE, TRUE, 1, NULL, NULL),
        ('value-sprint-board', 'Sprint Board', '/value-sprint-board', 'kanban',      'value', 'static', TRUE, TRUE, 2, NULL, NULL),
        ('value-flow',         'Flow',         '/value-flow',         'activity',    'value', 'static', TRUE, TRUE, 3, NULL, NULL)
    ON CONFLICT (key_enum) WHERE (created_by IS NULL AND subscription_id IS NULL) DO NOTHING
    RETURNING id
)
INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT i.id, r.users_roles_id
  FROM inserted i, users_roles r
 WHERE r.users_roles_code IN ('grp_global','grp_portfolio','grp_product','grp_stakeholder','grp_team_lead','grp_team_member')
   AND r.users_roles_is_system = true
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

COMMIT;
