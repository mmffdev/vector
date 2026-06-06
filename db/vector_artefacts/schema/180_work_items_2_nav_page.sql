-- Migration 180: Register /work-items-2 in the Planning nav rail.
--
-- /work-items-2 is the ObjectTreeV2 safety-net copy of /work-items, kept
-- reachable + discoverable while /work-items is rebuilt on the Grid primitive
-- (docs/superpowers/specs/2026-06-06-work-items-grid-swap-design.md). It mirrors
-- the live /work-items catalogue row exactly: tag 'planning', icon 'layers',
-- kind 'static', and the SAME 5 system-role grants
-- (grp_global, grp_portfolio, grp_product, grp_team_lead, grp_team_member —
-- NOT grp_stakeholder, matching /work-items). default_order 7 places it
-- immediately after /work-items (order 6).
--
-- Grants verified against the live dev row over the tunnel (2026-06-06), not
-- copied from an older migration, so visibility matches /work-items precisely.
--
-- ROLLBACK: db/vector_artefacts/schema/down/180_work_items_2_nav_page_DOWN.sql

BEGIN;

WITH inserted AS (
    INSERT INTO pages (
        pages_key_enum,
        pages_label,
        pages_href,
        pages_icon,
        pages_tag_enum,
        pages_kind,
        pages_pinnable,
        pages_default_pinned,
        pages_default_order,
        pages_id_user_creator,
        pages_id_subscription
    )
    VALUES
        ('work-items-2', 'Work Items (old)', '/work-items-2', 'layers', 'planning', 'static', TRUE, TRUE, 7, NULL, NULL)
    ON CONFLICT (pages_key_enum) WHERE (pages_id_user_creator IS NULL AND pages_id_subscription IS NULL) DO NOTHING
    RETURNING pages_id
)
INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT i.pages_id, r.users_roles_id
  FROM inserted i, users_roles r
 WHERE r.users_roles_code IN ('grp_global','grp_portfolio','grp_product','grp_team_lead','grp_team_member')
   AND r.users_roles_is_system = true
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

COMMIT;
