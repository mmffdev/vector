-- DOWN counterpart of 111_p2_move_leaves.sql

BEGIN;

DROP TABLE IF EXISTS public.pages_access_version CASCADE;
DROP TABLE IF EXISTS public.vector_icons CASCADE;
DROP TABLE IF EXISTS public.users_permissions CASCADE;
DROP TABLE IF EXISTS public.pages_tags CASCADE;
DROP TABLE IF EXISTS public.library_help_defaults CASCADE;

DROP FUNCTION IF EXISTS public.pages_access_version_bump();
DROP FUNCTION IF EXISTS public.library_help_defaults_set_updated_at();

COMMIT;
