-- DOWN counterpart of 113_p2_move_collisions.sql
--
-- Drops the 4 collision tables (admin_api_keys, users_sessions,
-- csp_reports, dpop_jti_cache) recreated in the up. Does NOT
-- restore VA's prior empty placeholder copies — those served no
-- purpose and are not worth rebuilding for a rollback.

BEGIN;

DROP TABLE IF EXISTS public.dpop_jti_cache CASCADE;
DROP TABLE IF EXISTS public.csp_reports CASCADE;
DROP TABLE IF EXISTS public.users_sessions CASCADE;
DROP TABLE IF EXISTS public.admin_api_keys CASCADE;

COMMIT;
