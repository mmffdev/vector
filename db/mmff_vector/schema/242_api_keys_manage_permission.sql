-- ============================================================
-- 242 — Add api_keys.manage permission for /admin/api-keys/*
--       (PLA059 — Lock Down API Key Admin Routes)
--
-- Adds one permission code:
--   api_keys.manage — issue, list, revoke programmatic API keys
--                     on the actor's subscription. Distinct from
--                     users.list (the prior, wrong gate).
--
-- Grant matrix (mirrors current users.list holders, so existing
-- gadmin / padmin operators do not lose capability on day one;
-- see PLA059 § Risks):
--   grp_global    (rank 70) → api_keys.manage
--   grp_portfolio (rank 60) → api_keys.manage
--
-- Future role-engineering can split this off — the point of
-- this migration is to make that *possible*.
--
-- Idempotent via ON CONFLICT / NOT EXISTS guards; safe to re-run.
--
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 242_api_keys_manage_permission.sql
-- ============================================================

BEGIN;

-- ── catalogue ───────────────────────────────────────────────
INSERT INTO users_permissions (
    users_permissions_code,
    users_permissions_label,
    users_permissions_category,
    users_permissions_description
) VALUES (
    'api_keys.manage',
    'Manage API keys',
    'api_keys',
    'Issue, list, and revoke programmatic API keys on the actor''s subscription. Gates /admin/api-keys/* and is layered with RequireFreshPassword + RequireStepUpReauth("manage-api-keys") on issue and revoke. Distinct from users.list — credential issuance is a separate threat class from reading the user directory.'
) ON CONFLICT (users_permissions_code) DO NOTHING;

-- ── grants: grp_global + grp_portfolio ──────────────────────
INSERT INTO users_roles_permissions (
    users_roles_permissions_id_role,
    users_roles_permissions_id_permission
)
SELECT r.users_roles_id, p.users_permissions_id
  FROM users_roles r, users_permissions p
 WHERE r.users_roles_code IN ('grp_global', 'grp_portfolio')
   AND r.users_roles_id_subscription IS NULL
   AND p.users_permissions_code = 'api_keys.manage'
   AND NOT EXISTS (
     SELECT 1 FROM users_roles_permissions urp
      WHERE urp.users_roles_permissions_id_role = r.users_roles_id
        AND urp.users_roles_permissions_id_permission = p.users_permissions_id
   );

COMMIT;
