-- 083_master_record_tenants_mentions_scope.sql
--
-- Adds the per-subscription mentions-scope toggle to
-- master_record_tenants. Values: 'tenant' (default — anyone in the
-- subscription is mentionable) | 'team' (only users sharing a team
-- with the caller).
--
-- The 'team' setting is opt-in: it relies on a users_teams_members
-- table that the teams feature will introduce later. Until that
-- table exists, the mentions service degrades to 'tenant' scope on
-- query error rather than 500-ing the picker.

BEGIN;

ALTER TABLE master_record_tenants
    ADD COLUMN IF NOT EXISTS master_record_tenants_mentions_scope text
        NOT NULL DEFAULT 'tenant';

ALTER TABLE master_record_tenants
    ADD CONSTRAINT master_record_tenants_mentions_scope_check
    CHECK (master_record_tenants_mentions_scope IN ('tenant', 'team'));

COMMIT;
