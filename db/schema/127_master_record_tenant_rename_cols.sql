-- db/schema/127_master_record_tenant_rename_cols.sql
--
-- Prefix all business columns on master_record_tenant with tenant_
-- and drop three columns not needed at this layer.
--
-- Column map (old → new):
--   subscription_id              → tenant_id
--   workspace_name               → tenant_name
--   description                  → tenant_description
--   owner_user_id                → tenant_owner_user_id
--   data_region                  → tenant_data_region
--   timezone                     → tenant_timezone
--   date_format                  → tenant_date_format
--   datetime_format              → tenant_datetime_format
--   workdays                     → tenant_workdays
--   week_start                   → tenant_week_start
--   rank_method                  → tenant_rank_method
--   build_changeset_tracking     → tenant_build_changeset_tracking
--   workspace_notes              → tenant_notes
--   primary_contact_email        → tenant_primary_contact_email
--
-- Dropped:
--   default_access               (removed)
--   auto_unblock_portfolio_items (removed)
--   time_tracker                 (removed)
--
-- Unchanged: created_at, updated_at, archived_at (standard audit cols)

BEGIN;

ALTER TABLE master_record_tenant RENAME COLUMN subscription_id              TO tenant_id;
ALTER TABLE master_record_tenant RENAME COLUMN workspace_name               TO tenant_name;
ALTER TABLE master_record_tenant RENAME COLUMN description                  TO tenant_description;
ALTER TABLE master_record_tenant RENAME COLUMN owner_user_id                TO tenant_owner_user_id;
ALTER TABLE master_record_tenant RENAME COLUMN data_region                  TO tenant_data_region;
ALTER TABLE master_record_tenant RENAME COLUMN timezone                     TO tenant_timezone;
ALTER TABLE master_record_tenant RENAME COLUMN date_format                  TO tenant_date_format;
ALTER TABLE master_record_tenant RENAME COLUMN datetime_format              TO tenant_datetime_format;
ALTER TABLE master_record_tenant RENAME COLUMN workdays                     TO tenant_workdays;
ALTER TABLE master_record_tenant RENAME COLUMN week_start                   TO tenant_week_start;
ALTER TABLE master_record_tenant RENAME COLUMN rank_method                  TO tenant_rank_method;
ALTER TABLE master_record_tenant RENAME COLUMN build_changeset_tracking     TO tenant_build_changeset_tracking;
ALTER TABLE master_record_tenant RENAME COLUMN workspace_notes              TO tenant_notes;
ALTER TABLE master_record_tenant RENAME COLUMN primary_contact_email        TO tenant_primary_contact_email;

ALTER TABLE master_record_tenant DROP COLUMN default_access;
ALTER TABLE master_record_tenant DROP COLUMN auto_unblock_portfolio_items;
ALTER TABLE master_record_tenant DROP COLUMN time_tracker;

-- Rename FK constraints to match new column names.
ALTER TABLE master_record_tenant
    RENAME CONSTRAINT master_record_tenant_subscription_id_fkey
    TO master_record_tenant_tenant_id_fkey;
ALTER TABLE master_record_tenant
    RENAME CONSTRAINT master_record_tenant_owner_user_id_fkey
    TO master_record_tenant_tenant_owner_user_id_fkey;

-- Rename index to match new column name.
ALTER INDEX idx_master_record_tenant_owner_user_id
    RENAME TO idx_master_record_tenant_tenant_owner_user_id;

-- Recreate seed trigger function with updated column names.
CREATE OR REPLACE FUNCTION fn_master_record_tenant_seed_for_subscription()
RETURNS trigger AS $$
BEGIN
    INSERT INTO master_record_tenant (tenant_id, tenant_name)
        VALUES (NEW.id, COALESCE(NEW.name, 'New workspace'))
    ON CONFLICT (tenant_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
