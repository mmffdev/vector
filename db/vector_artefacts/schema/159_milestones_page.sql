-- ============================================================
-- 159_milestones_page.sql
--
-- Register /milestones as a system page in the Planning rail bucket,
-- grant user-facing system roles, and pin it into every existing
-- nav profile so the rail picks it up without a logout/login.
--
-- Mirrors the sprints + releases seed pattern, translated to the
-- post-fold schema:
--   - pages (post-fold column prefixes pages_*)
--   - users_roles_pages with code-based role lookup (no hardcoded UUIDs)
--   - users_nav_pinned (post-141 split from users_nav_prefs)
--
-- WHY:
--   The /milestones page (implementation plan 2026-05-29-milestones-page.md,
--   spec 2026-05-29-milestones-page-design.md) closes the frontend gap over
--   the existing timeboxes_milestones table + backend service. Without
--   this page row + grants + pins, the route exists in Next.js but is
--   invisible in the rail.
--
-- NOTE ON ROLE CODES:
--   The plan references 'user'/'padmin'/'gadmin' but the live DB uses the
--   post-fold group-role scheme. The five is_system=TRUE codes that mirror
--   the grants on releases, sprints, planning, backlog, and risk are:
--     grp_global, grp_portfolio, grp_product, grp_team_lead, grp_team_member
--   (Confirmed by pre-check query on users_roles_pages for those pages,
--   2026-05-29.)
--
-- MIGRATION NUMBER:
--   158 was taken by 158_artefacts_slot_gate_trigger.sql — bumped to 159.
--
-- IDEMPOTENCY:
--   - pages: ON CONFLICT (pages_key_enum) WHERE ... partial-index inference DO NOTHING.
--   - users_roles_pages: ON CONFLICT (composite PK) DO NOTHING.
--   - users_nav_pinned: uq_users_nav_pinned_unique_item constraint covers
--     (user, subscription, profile, item_key) — ON CONFLICT DO NOTHING.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/159_milestones_page_DOWN.sql
-- ============================================================

BEGIN;

-- ── 1. Register the page row. ───────────────────────────────────
INSERT INTO pages (
    pages_key_enum,
    pages_label,
    pages_href,
    pages_icon,
    pages_tag_enum,
    pages_kind,
    pages_pinnable,
    pages_default_pinned,
    pages_default_order
) VALUES (
    'milestones',
    'Milestones',
    '/milestones',
    'flag',
    'planning',
    'static',
    TRUE,
    TRUE,
    9
)
ON CONFLICT (pages_key_enum) WHERE pages_id_user_creator IS NULL AND pages_id_subscription IS NULL DO NOTHING;

-- ── 2. Grant to group roles via code lookup. ─────────────────────
--    Mirrors the grant pattern on releases/sprints/planning/backlog/risk:
--    grp_global, grp_portfolio, grp_product, grp_team_lead, grp_team_member
INSERT INTO users_roles_pages (
    users_roles_pages_id_page,
    users_roles_pages_id_role
)
SELECT
    p.pages_id,
    r.users_roles_id
FROM pages p
CROSS JOIN users_roles r
WHERE p.pages_key_enum         = 'milestones'
  AND p.pages_id_subscription  IS NULL
  AND p.pages_id_user_creator  IS NULL
  AND r.users_roles_code       IN ('grp_global','grp_portfolio','grp_product','grp_team_lead','grp_team_member')
  AND r.users_roles_is_system  = TRUE
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

-- ── 3. Backfill into existing nav profiles. ─────────────────────
--    Position = current max + 1 for the profile (top-level items only),
--    or 0 if the profile has no pinned items yet.
--    The uq_users_nav_pinned_unique_item constraint (user, sub, profile,
--    item_key) handles the idempotency guard.
INSERT INTO users_nav_pinned (
    users_nav_pinned_id_user,
    users_nav_pinned_id_subscription,
    users_nav_pinned_id_profile,
    users_nav_pinned_item_key,
    users_nav_pinned_position
)
SELECT
    pr.users_nav_profiles_id_user,
    pr.users_nav_profiles_id_subscription,
    pr.users_nav_profiles_id,
    'milestones',
    COALESCE(
        (SELECT MAX(np.users_nav_pinned_position) + 1
           FROM users_nav_pinned np
          WHERE np.users_nav_pinned_id_user         = pr.users_nav_profiles_id_user
            AND np.users_nav_pinned_id_subscription = pr.users_nav_profiles_id_subscription
            AND np.users_nav_pinned_id_profile      = pr.users_nav_profiles_id
            AND np.users_nav_pinned_parent_item_key IS NULL),
        0
    )
FROM users_nav_profiles pr
ON CONFLICT (users_nav_pinned_id_user, users_nav_pinned_id_subscription, users_nav_pinned_id_profile, users_nav_pinned_item_key)
DO NOTHING;

COMMIT;
