-- ============================================================
-- 147 — Add topology.grants.manage_others permission for the
--       Topology Permissions admin page (PLA-0046 / B6.8)
--
-- Adds one permission code:
--   topology.grants.manage_others — read every user's topology
--                                   grants and assign/revoke nodes
--                                   on their behalf (admin-pivot).
--
-- Grant matrix:
--   gadmin (rank 30)  → topology.grants.manage_others
--
-- padmin and below are NOT granted: this surface enumerates grants
-- across users, which exceeds the workspace-bounded authority of
-- padmin. The MVP is gadmin-only; if a future story opens it to
-- padmin, add the grant in a follow-up migration rather than
-- amending this one.
--
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 147_topology_grants_manage_others_permission.sql
-- ============================================================

BEGIN;

-- ── catalogue ───────────────────────────────────────────────
INSERT INTO permissions (code, label, category, description) VALUES
    ('topology.grants.manage_others', 'Manage topology grants for other users',
     'topology', 'Read every user''s topology node grants and assign/revoke nodes on their behalf. Hosts the gadmin-only Topology Permissions page.')
ON CONFLICT (code) DO NOTHING;

-- ── grants: gadmin ──────────────────────────────────────────
INSERT INTO roles_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad30', p.id
FROM permissions p
WHERE p.code = 'topology.grants.manage_others'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
