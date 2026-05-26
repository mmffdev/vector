-- DOWN counterpart of 114_p2_move_nav_cluster.sql

BEGIN;

DROP TABLE IF EXISTS public.users_tab_order CASCADE;
DROP TABLE IF EXISTS public.users_custom_page_views CASCADE;
DROP TABLE IF EXISTS public.users_custom_pages CASCADE;
DROP TABLE IF EXISTS public.users_nav_prefs CASCADE;
DROP TABLE IF EXISTS public.users_nav_profile_groups CASCADE;
DROP TABLE IF EXISTS public.users_nav_profiles CASCADE;
DROP TABLE IF EXISTS public.users_nav_groups CASCADE;

DROP FUNCTION IF EXISTS public.users_tab_order_set_updated_at();
DROP FUNCTION IF EXISTS public.users_custom_page_views_set_updated_at();
DROP FUNCTION IF EXISTS public.users_custom_pages_set_updated_at();
DROP FUNCTION IF EXISTS public.fn_users_nav_prefs_touch_updated_at();
DROP FUNCTION IF EXISTS public.fn_users_nav_profiles_touch_updated_at();
DROP FUNCTION IF EXISTS public.fn_users_nav_groups_touch_updated_at();

COMMIT;
