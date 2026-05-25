-- ============================================================
-- DOWN: PLA064 / CUT1.3.1 part 1 — Remove auth/identity cluster replicas
-- Drops the 4 tables created by 093_replicate_auth_identity_cluster.sql.
-- Reverse order of creation (though none reference each other).
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS users_sessions;
DROP TABLE IF EXISTS dpop_jti_cache;
DROP TABLE IF EXISTS csp_reports;
DROP TABLE IF EXISTS admin_api_keys;

COMMIT;
