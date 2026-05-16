-- ============================================================
-- 117 — Add flows.manage permission for the Flow Editor surface
--
-- Adds one permission code:
--   flows.manage — open and apply changes to the per-tenant flow
--                  editor (writes to o_flow_tenant only)
--
-- Grant matrix:
--   gadmin (rank 30)  → flows.manage
--   padmin (rank 25)  → flows.manage
--
-- Both roles see and operate the same surface (writes scoped to the
-- caller's subscription). team_lead / user / external get nothing.
--
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 117_flows_manage_permission.sql
-- ============================================================

BEGIN;

-- ── catalogue ───────────────────────────────────────────────
INSERT INTO permissions (code, label, category, description) VALUES
    ('flows.manage', 'Manage tenant flows',
     'flows', 'Open the Flow Editor and modify per-tenant flows in o_flow_tenant.')
ON CONFLICT (code) DO NOTHING;

-- ── grants: gadmin ──────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad30', p.id
FROM permissions p
WHERE p.code = 'flows.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── grants: padmin ──────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad25', p.id
FROM permissions p
WHERE p.code = 'flows.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
