-- 217_nav_artefacts_purge_user_prefs.sql
--
-- Purge per-user nav pref rows for the three leaf pages that moved
-- inside the ws-artefacts shell. They are no longer independently
-- pinnable, so stale prefs would keep showing them in the rail.

BEGIN;

DELETE FROM users_nav_prefs
 WHERE users_nav_prefs_item_key IN (
   'ws-artefact-types',
   'ws-transition-rules',
   'ws-flow-states-v2'
 );

COMMIT;
