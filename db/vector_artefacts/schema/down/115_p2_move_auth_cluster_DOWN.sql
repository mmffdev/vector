-- DOWN counterpart of 115_p2_move_auth_cluster.sql

BEGIN;

DROP TABLE IF EXISTS public.users_mentions CASCADE;
DROP TABLE IF EXISTS public.users_notifications_prefs CASCADE;
DROP TABLE IF EXISTS public.users_notifications CASCADE;
DROP TABLE IF EXISTS public.notifications_outbox CASCADE;
DROP TABLE IF EXISTS public.users_notification_rules CASCADE;
DROP TABLE IF EXISTS public.users_reauth_nonces CASCADE;
DROP TABLE IF EXISTS public.users_password_resets CASCADE;

DROP FUNCTION IF EXISTS public.notifications_outbox_notify();

COMMIT;
