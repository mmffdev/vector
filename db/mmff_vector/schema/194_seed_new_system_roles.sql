-- ============================================================
-- 194_seed_new_system_roles.sql
--
-- PLA-0049 Phase 0.1 — seed the 7 new system roles with random
-- UUIDs and the new rank ladder (10/20/30/40/50/60/70, bottom-up).
--
-- Lineup:
--   grp_global       Global Admin       70  (universal access)
--   grp_portfolio    Portfolio Manager  60
--   grp_product      Product Owner      50
--   grp_team_lead    Team Lead          40
--   grp_team_member  Team Member        30
--   grp_stakeholder  Stakeholder        20
--   grp_external     External           10  (archetype)
--
-- The OLD 5 system rows (gadmin/padmin/team_lead/user/external at
-- ranks 30/25/20/10/5 with rank-encoded UUIDs ad30/ad25/ad20/ad10/ad05)
-- are NOT touched here. Migration 195 drops the users_roles_pages
-- enum PK partner so the new roles can carry page grants. Migration
-- 196 repoints all FK references to the new UUIDs and DELETEs the
-- old rows.
--
-- NOTE on rank-band CHECK constraint: the existing
-- `users_roles_tenant_rank_band` forbids tenant rows from using ANY
-- of {5,10,20,25,30}. With the new ladder we need to forbid
-- {10,20,30,40,50,60,70}. The CHECK is REPLACED in migration 196 in
-- the same transaction that DELETEs the old rows — keeping the old
-- bands valid here means this migration is a pure additive insert
-- with no constraint conflict.
--
-- Idempotent: ON CONFLICT (users_roles_code) WHERE id_subscription
-- IS NULL DO NOTHING. Safe to re-run after a partial failure.
-- ============================================================

BEGIN;

INSERT INTO users_roles (
    users_roles_id,
    users_roles_id_subscription,
    users_roles_code,
    users_roles_label,
    users_roles_description,
    users_roles_rank,
    users_roles_is_system,
    users_roles_is_external
) VALUES
    (gen_random_uuid(), NULL, 'grp_global',      'Global Admin',
     'Universal access; cannot be revoked from any page. Tenant-wide administrative authority.',
     70, TRUE,  FALSE),
    (gen_random_uuid(), NULL, 'grp_portfolio',   'Portfolio Manager',
     'Manages portfolio-scoped settings and the roles below.',
     60, TRUE,  FALSE),
    (gen_random_uuid(), NULL, 'grp_product',     'Product Owner',
     'Owns product surface; coordinates Team Lead and below.',
     50, TRUE,  FALSE),
    (gen_random_uuid(), NULL, 'grp_team_lead',   'Team Lead',
     'Operational lead for a team; coordinates Team Members.',
     40, TRUE,  FALSE),
    (gen_random_uuid(), NULL, 'grp_team_member', 'Team Member',
     'Standard contributor; default role for new accounts.',
     30, TRUE,  FALSE),
    (gen_random_uuid(), NULL, 'grp_stakeholder', 'Stakeholder',
     'Limited-access viewer; comment + read by default.',
     20, TRUE,  FALSE),
    (gen_random_uuid(), NULL, 'grp_external',    'External',
     'Archetype for tenant clones (auditor, contractor, agent). Hidden from grids; tenants clone-and-edit.',
     10, TRUE,  TRUE)
ON CONFLICT (users_roles_code) WHERE users_roles_id_subscription IS NULL DO NOTHING;

DO $$
DECLARE n int;
BEGIN
    SELECT COUNT(*) INTO n
      FROM users_roles
     WHERE users_roles_is_system = TRUE
       AND users_roles_code LIKE 'grp_%';
    IF n <> 7 THEN
        RAISE EXCEPTION 'PLA-0049 mig 194: expected 7 grp_* system roles after seed, found %', n;
    END IF;
END $$;

COMMIT;
