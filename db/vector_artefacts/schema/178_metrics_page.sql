-- ============================================================
-- 178_metrics_page.sql
--
-- Register /workspace-admin/metrics as a system page (tab) in the Workspace
-- Admin (workspace_admin) rail bucket, grant the same roles that see Workspace
-- Details, and pin it into every existing nav profile so the rail picks it up
-- without a logout/login.
--
-- WHY (Rick, 2026-06-06):
--   The Metrics page (app/(user)/workspace-admin/metrics/page.tsx) was built to
--   be a TAB alongside Workspace Details, but the workspace_admin rail is driven
--   by the `pages` table, so without this row there is no tab and the page is
--   unreachable from the UI. This row + grants + pins surface it as a tab. It is
--   a home for metric-based workspace options (Scrum metrics first; the page
--   currently ships a "Scrum Metrics" stub panel).
--
-- VISIBILITY:
--   Mirrors ws-workspace-details exactly — granted to grp_global + grp_portfolio
--   + grp_product (is_system = TRUE), kind 'static', pinnable, default-pinned.
--   Order 2 places it directly after Workspace Details (order 1); it shares the
--   slot with the existing order-2 entries (Artefacts/Workspaces), which the
--   nav's stable tie-break orders by label.
--
-- ICON:
--   'bar-chart' — a registered key in app/components/nav_primary_rail_NavPageIcons.tsx
--   (NOT 'bar-chart-2', which is unmapped and would render blank).
--
-- IDEMPOTENCY:
--   - pages: ON CONFLICT (pages_key_enum) WHERE system partial-index DO NOTHING.
--   - users_roles_pages: ON CONFLICT (composite PK) DO NOTHING.
--   - users_nav_pinned: uq on (user, sub, profile, item_key) — DO NOTHING.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/178_metrics_page_DOWN.sql
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
    'ws-metrics',
    'Metrics',
    '/workspace-admin/metrics',
    'bar-chart',
    'workspace_admin',
    'static',
    TRUE,
    TRUE,
    2
)
ON CONFLICT (pages_key_enum) WHERE pages_id_user_creator IS NULL AND pages_id_subscription IS NULL DO NOTHING;

-- ── 2. Grant to the same group roles that see Workspace Details. ─
INSERT INTO users_roles_pages (
    users_roles_pages_id_page,
    users_roles_pages_id_role
)
SELECT
    p.pages_id,
    r.users_roles_id
FROM pages p
CROSS JOIN users_roles r
WHERE p.pages_key_enum         = 'ws-metrics'
  AND p.pages_id_subscription  IS NULL
  AND p.pages_id_user_creator  IS NULL
  AND r.users_roles_code       IN ('grp_global','grp_portfolio','grp_product')
  AND r.users_roles_is_system  = TRUE
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

-- ── 3. Backfill into existing nav profiles so the tab shows without re-login. ─
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
    'ws-metrics',
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
