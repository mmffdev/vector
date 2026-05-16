-- ============================================================
-- DOWN for 197_rename_permission_codes.sql
-- ============================================================

BEGIN;

-- 1. Drop the 2 new perms (and any junctions to them).
DELETE FROM users_permissions
 WHERE users_permissions_code IN ('users.create.grp_product','users.create.grp_stakeholder');

-- 2. Restore the 5 legacy creator-matrix codes + labels.
UPDATE users_permissions
   SET users_permissions_code  = 'users.create.gadmin',
       users_permissions_label = 'Create gadmin users'
 WHERE users_permissions_code = 'users.create.grp_global';

UPDATE users_permissions
   SET users_permissions_code  = 'users.create.padmin',
       users_permissions_label = 'Create padmin users'
 WHERE users_permissions_code = 'users.create.grp_portfolio';

UPDATE users_permissions
   SET users_permissions_code  = 'users.create.team_lead',
       users_permissions_label = 'Create team_lead users'
 WHERE users_permissions_code = 'users.create.grp_team_lead';

UPDATE users_permissions
   SET users_permissions_code  = 'users.create.user',
       users_permissions_label = 'Create user-role users'
 WHERE users_permissions_code = 'users.create.grp_team_member';

UPDATE users_permissions
   SET users_permissions_code  = 'users.create.external',
       users_permissions_label = 'Create external-archetype users'
 WHERE users_permissions_code = 'users.create.grp_external';

COMMIT;
