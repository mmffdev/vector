-- Migration 232: Fix-up for migration 231.
--
-- Migration 231 (restore ws-custom-fields page) granted only grp_portfolio
-- on the false assumption that grp_global is auto-granted by a trigger.
-- The migration's header repeated this misreading of mig 199's docstring
-- ("grp_global is NOT touched ... managed by mig 193 and the auto-grant
-- trigger"). On inspection there is NO such trigger on the `pages` table —
-- only trg_pages_updated_at exists. mig 199's text described a one-time
-- seed step, not an ongoing trigger.
--
-- Effect of the gap: gadmin users do not see the Custom Fields page in
-- their workspace-admin nav rail because no users_roles_pages row admits
-- them. padmin sees it (the grp_portfolio grant landed correctly).
--
-- This migration adds the missing grp_global grant. Idempotent:
-- NOT EXISTS guard prevents a duplicate row.

BEGIN;

INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
SELECT p.id, r.users_roles_id
  FROM pages p, users_roles r
 WHERE p.key_enum = 'ws-custom-fields'
   AND r.users_roles_code = 'grp_global'
   AND r.users_roles_id_subscription IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM users_roles_pages urp
      WHERE urp.users_roles_pages_id_page = p.id
        AND urp.users_roles_pages_id_role = r.users_roles_id
   );

COMMIT;
