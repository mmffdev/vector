-- One-shot remediation: clean up orphaned rows from perm-test-* tenants.
--
-- Why this exists:
-- The first run of backend/internal/permissions/service_test.go on
-- 2026-04-23 had a flawed cleanup ordering — DELETE on
-- portfolio_item_types/execution_item_types ran before
-- item_type_transition_edges, which kept item_type_states pinned. The
-- result: parent type rows gone, child state rows orphaned, tenant rows
-- still present (blocked by the pinned states).
--
-- The test cleanup is now fixed. This script wipes the leftover data
-- created during that botched run. Scope is narrowed to slug pattern
-- 'perm-test-%' so it cannot touch live tenant data.
--
-- Order matters: leaves of the FK graph first, root (tenants) last.

BEGIN;

-- Snapshot the affected tenant ids into a temp table so every DELETE
-- can reference the same set without re-querying.
CREATE TEMP TABLE _perm_test_tenants ON COMMIT DROP AS
    SELECT id FROM tenants WHERE slug LIKE 'perm-test-%';

-- Sanity print: how many tenants are we about to nuke?
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM _perm_test_tenants;
    RAISE NOTICE 'cleanup_perm_test_tenants: targeting % tenant(s)', n;
END$$;

-- Children that point at workspace-stack rows.
DELETE FROM user_workspace_permissions
 WHERE workspace_id IN (SELECT id FROM workspace WHERE tenant_id IN (SELECT id FROM _perm_test_tenants));

DELETE FROM page_entity_refs
 WHERE entity_id IN (
    SELECT id FROM portfolio WHERE tenant_id IN (SELECT id FROM _perm_test_tenants)
    UNION
    SELECT id FROM product   WHERE tenant_id IN (SELECT id FROM _perm_test_tenants)
 );

DELETE FROM entity_stakeholders WHERE tenant_id IN (SELECT id FROM _perm_test_tenants);

-- execution_item_types (portfolio_item_types, item_type_states,
-- item_type_transition_edges dropped in migration 032).
DELETE FROM execution_item_types WHERE tenant_id IN (SELECT id FROM _perm_test_tenants);

-- Workspace stack.
DELETE FROM product         WHERE tenant_id IN (SELECT id FROM _perm_test_tenants);
DELETE FROM portfolio       WHERE tenant_id IN (SELECT id FROM _perm_test_tenants);
DELETE FROM workspace       WHERE tenant_id IN (SELECT id FROM _perm_test_tenants);
DELETE FROM company_roadmap WHERE tenant_id IN (SELECT id FROM _perm_test_tenants);
DELETE FROM tenant_sequence WHERE tenant_id IN (SELECT id FROM _perm_test_tenants);

-- Users last (referenced by FKs above as owner_user_id, granted_by, etc).
DELETE FROM users   WHERE tenant_id IN (SELECT id FROM _perm_test_tenants);
DELETE FROM tenants WHERE id IN (SELECT id FROM _perm_test_tenants);

COMMIT;
