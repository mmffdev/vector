-- DOWN for db/schema/128_master_record_tenant_rename_audit_cols.sql
--
-- Reverses the tenant_-prefixing of the three audit columns and
-- restores the touch trigger function and archived_at index to
-- their pre-128 names.

BEGIN;

ALTER TABLE master_record_tenant RENAME COLUMN tenant_created_at  TO created_at;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_updated_at  TO updated_at;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_archived_at TO archived_at;

CREATE OR REPLACE FUNCTION fn_master_record_tenant_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER INDEX idx_master_record_tenant_tenant_archived_at
    RENAME TO idx_master_record_tenant_archived_at;

COMMIT;
