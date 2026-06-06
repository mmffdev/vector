-- Migration 178 DOWN: remove the Metrics tab from the Workspace Admin rail.
--
-- Reverses 178_metrics_page.sql: drops the nav-profile pins, the role grants,
-- and the system page row for 'ws-metrics'. Order matters — children of the
-- pages row (grants, pins-by-key) go before the page row itself.

BEGIN;

-- 1. Remove backfilled nav-profile pins.
DELETE FROM users_nav_pinned
 WHERE users_nav_pinned_item_key = 'ws-metrics';

-- 2. Remove role grants for the page.
DELETE FROM users_roles_pages
 WHERE users_roles_pages_id_page IN (
       SELECT pages_id
         FROM pages
        WHERE pages_key_enum = 'ws-metrics'
          AND pages_id_user_creator IS NULL
          AND pages_id_subscription IS NULL
 );

-- 3. Remove the system page row.
DELETE FROM pages
 WHERE pages_key_enum = 'ws-metrics'
   AND pages_id_user_creator IS NULL
   AND pages_id_subscription IS NULL;

COMMIT;
