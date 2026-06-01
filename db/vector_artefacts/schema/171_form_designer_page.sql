-- ============================================================
-- 171_form_designer_page.sql
--
-- Register /workspace-admin/custom-fields/form-designer as a system page in the
-- Workspace Admin (workspace_admin) rail bucket, grant the same roles that see
-- Custom Fields, and pin it into every existing nav profile so the rail picks it
-- up without a logout/login.
--
-- WHY (Rick, 2026-06-01):
--   The Form Designer (Form Layout Builder) is reachable inline from the Custom
--   Fields page via the FormBuilderLaunchPanel dropdown, but that inline mount
--   has no URL of its own — a browser refresh bounced the user back to the main
--   page. The new dedicated route (app/(user)/workspace-admin/custom-fields/
--   form-designer/page.tsx) gives it a stable, refreshable URL and its own
--   panel/title ("Vector Form Designer"). This row + grants + pins surface it in
--   rail-2 under the workspace-settings bucket. The Custom Fields dropdown entry
--   is UNCHANGED — this is an additional entry point, not a replacement.
--
-- VISIBILITY:
--   Mirrors ws-custom-fields exactly — granted to grp_global + grp_portfolio
--   (is_system = TRUE), kind 'static', pinnable, default-pinned. Order 91 places
--   it directly after Custom Fields (order 90).
--
-- IDEMPOTENCY:
--   - pages: ON CONFLICT (pages_key_enum) WHERE ... partial-index inference DO NOTHING.
--   - users_roles_pages: ON CONFLICT (composite PK) DO NOTHING.
--   - users_nav_pinned: uq_users_nav_pinned_unique_item (user, sub, profile,
--     item_key) — ON CONFLICT DO NOTHING.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/171_form_designer_page_DOWN.sql
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
    'ws-form-designer',
    'Form Designer',
    '/workspace-admin/custom-fields/form-designer',
    'layout',
    'workspace_admin',
    'static',
    TRUE,
    TRUE,
    91
)
ON CONFLICT (pages_key_enum) WHERE pages_id_user_creator IS NULL AND pages_id_subscription IS NULL DO NOTHING;

-- ── 2. Grant to the same group roles that see Custom Fields. ─────
INSERT INTO users_roles_pages (
    users_roles_pages_id_page,
    users_roles_pages_id_role
)
SELECT
    p.pages_id,
    r.users_roles_id
FROM pages p
CROSS JOIN users_roles r
WHERE p.pages_key_enum         = 'ws-form-designer'
  AND p.pages_id_subscription  IS NULL
  AND p.pages_id_user_creator  IS NULL
  AND r.users_roles_code       IN ('grp_global','grp_portfolio')
  AND r.users_roles_is_system  = TRUE
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

-- ── 3. Backfill into existing nav profiles. ─────────────────────
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
    'ws-form-designer',
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
