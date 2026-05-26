-- DOWN counterpart of 110_p2_move_subscriptions_users.sql
--
-- Drops the four tables moved by 110 plus their triggers and
-- trigger functions. The DOWN must run BEFORE 109_DOWN because
-- 109 owns the enum types these tables depend on.

BEGIN;

DROP TABLE IF EXISTS public.subscriptions_sequence CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.cost_centres CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;

DROP FUNCTION IF EXISTS public.subscriptions_sequence_set_updated_at();
DROP FUNCTION IF EXISTS public.users_set_updated_at();
DROP FUNCTION IF EXISTS public.cost_centres_set_updated_at();
DROP FUNCTION IF EXISTS public.subscriptions_set_updated_at();

COMMIT;
