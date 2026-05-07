-- DOWN for db/schema/127_master_record_tenant_rename_cols.sql
--
-- Reverses the column renames and constraint/index renames, and
-- restores the three columns that 127 dropped (default_access,
-- auto_unblock_portfolio_items, time_tracker) with their original
-- defaults. Data in those columns is unrecoverable — the rebuilt
-- columns hold the table default for every existing row.

BEGIN;

ALTER TABLE master_record_tenant RENAME COLUMN tenant_id                       TO subscription_id;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_name                     TO workspace_name;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_description              TO description;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_owner_user_id            TO owner_user_id;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_data_region              TO data_region;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_timezone                 TO timezone;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_date_format              TO date_format;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_datetime_format          TO datetime_format;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_workdays                 TO workdays;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_week_start               TO week_start;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_rank_method              TO rank_method;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_build_changeset_tracking TO build_changeset_tracking;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_notes                    TO workspace_notes;
ALTER TABLE master_record_tenant RENAME COLUMN tenant_primary_contact_email    TO primary_contact_email;

-- Restore dropped columns with their original definitions.
ALTER TABLE master_record_tenant
    ADD COLUMN default_access text NOT NULL DEFAULT 'no_access' CHECK (default_access IN (
        'no_access','viewer','editor'
    )),
    ADD COLUMN auto_unblock_portfolio_items boolean NOT NULL DEFAULT TRUE,
    ADD COLUMN time_tracker boolean NOT NULL DEFAULT FALSE;

-- Restore FK constraint names.
ALTER TABLE master_record_tenant
    RENAME CONSTRAINT master_record_tenant_tenant_id_fkey
    TO master_record_tenant_subscription_id_fkey;
ALTER TABLE master_record_tenant
    RENAME CONSTRAINT master_record_tenant_tenant_owner_user_id_fkey
    TO master_record_tenant_owner_user_id_fkey;

-- Restore index name to pre-127 form.
ALTER INDEX idx_master_record_tenant_tenant_owner_user_id
    RENAME TO idx_master_record_tenant_owner_user_id;

-- Restore seed trigger function to pre-rename column names.
CREATE OR REPLACE FUNCTION fn_master_record_tenant_seed_for_subscription()
RETURNS trigger AS $$
BEGIN
    INSERT INTO master_record_tenant (subscription_id, workspace_name)
        VALUES (NEW.id, COALESCE(NEW.name, 'New workspace'))
    ON CONFLICT (subscription_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
