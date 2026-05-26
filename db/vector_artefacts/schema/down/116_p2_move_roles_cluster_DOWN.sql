-- DOWN counterpart of 116_p2_move_roles_cluster.sql

BEGIN;

DROP TABLE IF EXISTS public.subscriptions_stakeholders CASCADE;
DROP TABLE IF EXISTS public.users_roles_permissions CASCADE;
DROP TABLE IF EXISTS public.users_roles_workspaces CASCADE;
DROP TABLE IF EXISTS public.users_roles CASCADE;

DROP FUNCTION IF EXISTS public.fn_users_roles_workspaces_touch_updated_at();
DROP FUNCTION IF EXISTS public.fn_users_roles_touch_updated_at();

COMMIT;
