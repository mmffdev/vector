-- 112_grant_gadmin_portfolio_model_edit.sql
--
-- Grants `portfolio.model.edit` to the gadmin role.
--
-- Rationale: the Portfolio Model wizard (Vector Standard / Enterprise /
-- Rally / SAFe / Jira chooser at /portfolio-model) is a global-config
-- surface — gadmin is the platform-wide administrator and must be able
-- to configure which portfolio model a tenant subscription adopts.
-- Migration 104 originally seeded this permission to padmin only,
-- under the assumption that model adoption is a tenant-scoped action.
-- In practice gadmin needs the same capability for platform setup,
-- demos, and rescue scenarios where padmin access is unavailable.
--
-- Idempotent: ON CONFLICT (role_id, permission_id) DO NOTHING. Safe to
-- re-run; safe to apply on a freshly-seeded DB where 104 has already
-- placed both rows.

INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-00000000ad30', p.id
FROM permissions p
WHERE p.code IN (
    'portfolio.model.edit'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
