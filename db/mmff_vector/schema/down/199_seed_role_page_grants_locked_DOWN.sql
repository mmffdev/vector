-- ============================================================
-- DOWN for 199_seed_role_page_grants_locked.sql
--
-- Restores the prior-to-mig-199 grant set is NOT possible — mig 199
-- replaces all grants for the 5 system roles with the captured set.
-- This DOWN simply DELETEs the 5 roles' grants entirely; recovery
-- means re-applying mig 199 (which is idempotent) or re-running
-- dev/scripts/capture_role_grants.sh against a saner snapshot.
-- ============================================================

BEGIN;

DELETE FROM users_roles_pages
 WHERE users_roles_pages_id_role IN (
   SELECT users_roles_id FROM users_roles
    WHERE users_roles_is_system = TRUE
      AND users_roles_id_subscription IS NULL
      AND users_roles_code IN (
        'grp_portfolio','grp_product','grp_team_lead',
        'grp_team_member','grp_stakeholder'
      )
 );

COMMIT;
