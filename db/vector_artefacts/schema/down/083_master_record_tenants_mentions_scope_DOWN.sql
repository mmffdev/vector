-- DOWN for 083_master_record_tenants_mentions_scope.sql
BEGIN;

ALTER TABLE master_record_tenants
    DROP CONSTRAINT IF EXISTS master_record_tenants_mentions_scope_check;

ALTER TABLE master_record_tenants
    DROP COLUMN IF EXISTS master_record_tenants_mentions_scope;

COMMIT;
