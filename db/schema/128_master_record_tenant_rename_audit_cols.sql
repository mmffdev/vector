-- db/schema/128_master_record_tenant_rename_audit_cols.sql
--
-- Prefix the three audit columns on master_record_tenant with tenant_
-- so every column on the table shares the tenant_ namespace.
--
-- Column map (old → new):
--   created_at  → tenant_created_at
--   updated_at  → tenant_updated_at
--   archived_at → tenant_archived_at

BEGIN;

ALTER TABLE master_record_tenant RENAME COLUMN created_at  TO tenant_created_at;
ALTER TABLE master_record_tenant RENAME COLUMN updated_at  TO tenant_updated_at;
ALTER TABLE master_record_tenant RENAME COLUMN archived_at TO tenant_archived_at;

-- Rebuild the touch trigger function to assign the renamed audit column.
-- Without this, any UPDATE on the table fails with "record \"new\" has
-- no field \"updated_at\"" because the trigger's CREATE in mig 126 still
-- references the pre-rename column name.
CREATE OR REPLACE FUNCTION fn_master_record_tenant_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.tenant_updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER INDEX idx_master_record_tenant_archived_at
    RENAME TO idx_master_record_tenant_tenant_archived_at;

COMMIT;
