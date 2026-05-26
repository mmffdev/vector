-- DOWN counterpart of 117_p2_move_pages_cluster.sql

BEGIN;

-- Drop the trigger we installed on users (cross-table cascade).
DROP TRIGGER IF EXISTS trg_users_role_change_cascade_nav_prefs ON public.users;
DROP FUNCTION IF EXISTS public.fn_users_role_change_cascade_nav_prefs();

DROP TABLE IF EXISTS public.users_roles_pages CASCADE;
DROP TABLE IF EXISTS public.page_entity_refs CASCADE;
DROP TABLE IF EXISTS public.pages_help CASCADE;
DROP TABLE IF EXISTS public.pages CASCADE;
DROP TABLE IF EXISTS public.pages_addressables CASCADE;

DROP FUNCTION IF EXISTS public.fn_users_roles_pages_cascade_nav_prefs();
DROP FUNCTION IF EXISTS public.fn_users_nav_prefs_resequence(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.fn_pages_cascade_nav_prefs();
DROP FUNCTION IF EXISTS public.pages_help_set_updated_at();
DROP FUNCTION IF EXISTS public.pages_set_updated_at();
DROP FUNCTION IF EXISTS public.pages_addressables_set_updated_at();

COMMIT;
