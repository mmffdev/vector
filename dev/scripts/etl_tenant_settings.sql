-- ============================================================
-- ETL: master_record_tenant (mmff_vector) → master_record_tenant (vector_artefacts)
-- M2.3.2
--
-- Run in two steps:
--
--   Step 1 (mmff_vector): export to CSV
--     psql $MMFF_VECTOR_URL -c "\COPY (SELECT ...) TO '/tmp/tenant_settings_export.csv' CSV HEADER"
--
--   Step 2 (vector_artefacts): import and load
--     psql $VA_URL -f dev/scripts/etl_tenant_settings.sql
--
-- Column map (mmff_vector → vector_artefacts):
--   tenant_id                        → workspace_id  (same UUID value; key was subscription_id, renamed to tenant_id in mig 127)
--   tenant_name                      → tenant_name
--   tenant_description               → tenant_description
--   tenant_owner_user_id             → tenant_owner_user_id  (bare UUID; cross-DB FK not enforced)
--   tenant_primary_contact_email     → tenant_primary_contact_email
--   tenant_data_region               → tenant_data_region
--   tenant_timezone                  → tenant_timezone
--   tenant_date_format               → tenant_date_format
--   tenant_datetime_format           → tenant_datetime_format
--   tenant_workdays                  → tenant_workdays
--   tenant_week_start                → tenant_week_start
--   tenant_rank_method               → tenant_rank_method
--   tenant_build_changeset_tracking  → tenant_build_changeset_tracking
--   tenant_notes                     → tenant_notes
--   tenant_created_at                → tenant_created_at
--   tenant_updated_at                → tenant_updated_at
--   tenant_archived_at               → tenant_archived_at
--
-- Idempotent: ON CONFLICT (workspace_id) DO UPDATE so re-runs
-- overwrite with the latest source values.
-- ============================================================

-- ============================================================
-- STEP 1: Export from mmff_vector (run against mmff_vector DB)
-- ============================================================
-- \COPY (
--     SELECT
--         tenant_id,
--         tenant_name,
--         tenant_description,
--         tenant_owner_user_id,
--         tenant_primary_contact_email,
--         tenant_data_region,
--         tenant_timezone,
--         tenant_date_format,
--         tenant_datetime_format,
--         tenant_workdays,
--         tenant_week_start,
--         tenant_rank_method,
--         tenant_build_changeset_tracking,
--         tenant_notes,
--         tenant_created_at,
--         tenant_updated_at,
--         tenant_archived_at
--     FROM master_record_tenant
--     ORDER BY tenant_created_at
-- ) TO '/tmp/tenant_settings_export.csv' CSV HEADER;

-- ============================================================
-- STEP 2: Import into vector_artefacts (run against vector_artefacts DB)
-- ============================================================

BEGIN;

CREATE TEMP TABLE tenant_settings_import (
    tenant_id                        UUID,
    tenant_name                      TEXT,
    tenant_description               TEXT,
    tenant_owner_user_id             UUID,
    tenant_primary_contact_email     TEXT,
    tenant_data_region               TEXT,
    tenant_timezone                  TEXT,
    tenant_date_format               TEXT,
    tenant_datetime_format           TEXT,
    tenant_workdays                  TEXT,  -- CSV serialises arrays as "{mon,tue,...}"; cast on insert
    tenant_week_start                TEXT,
    tenant_rank_method               TEXT,
    tenant_build_changeset_tracking  BOOLEAN,
    tenant_notes                     TEXT,
    tenant_created_at                TIMESTAMPTZ,
    tenant_updated_at                TIMESTAMPTZ,
    tenant_archived_at               TIMESTAMPTZ
);

-- Load the CSV (adjust path if needed)
-- \COPY tenant_settings_import FROM '/tmp/tenant_settings_export.csv' CSV HEADER;

INSERT INTO master_record_tenant (
    workspace_id,
    tenant_name,
    tenant_description,
    tenant_owner_user_id,
    tenant_primary_contact_email,
    tenant_data_region,
    tenant_timezone,
    tenant_date_format,
    tenant_datetime_format,
    tenant_workdays,
    tenant_week_start,
    tenant_rank_method,
    tenant_build_changeset_tracking,
    tenant_notes,
    tenant_created_at,
    tenant_updated_at,
    tenant_archived_at
)
SELECT
    tenant_id,
    tenant_name,
    tenant_description,
    tenant_owner_user_id,
    tenant_primary_contact_email,
    tenant_data_region,
    tenant_timezone,
    tenant_date_format,
    tenant_datetime_format,
    -- Postgres TEXT[] from CSV arrives as the literal "{mon,tue,wed}" string; cast to array.
    string_to_array(trim(both '{}' from tenant_workdays), ','),
    tenant_week_start,
    tenant_rank_method,
    tenant_build_changeset_tracking,
    tenant_notes,
    tenant_created_at,
    tenant_updated_at,
    tenant_archived_at
FROM tenant_settings_import
ON CONFLICT (workspace_id) DO UPDATE SET
    tenant_name                      = EXCLUDED.tenant_name,
    tenant_description               = EXCLUDED.tenant_description,
    tenant_owner_user_id             = EXCLUDED.tenant_owner_user_id,
    tenant_primary_contact_email     = EXCLUDED.tenant_primary_contact_email,
    tenant_data_region               = EXCLUDED.tenant_data_region,
    tenant_timezone                  = EXCLUDED.tenant_timezone,
    tenant_date_format               = EXCLUDED.tenant_date_format,
    tenant_datetime_format           = EXCLUDED.tenant_datetime_format,
    tenant_workdays                  = EXCLUDED.tenant_workdays,
    tenant_week_start                = EXCLUDED.tenant_week_start,
    tenant_rank_method               = EXCLUDED.tenant_rank_method,
    tenant_build_changeset_tracking  = EXCLUDED.tenant_build_changeset_tracking,
    tenant_notes                     = EXCLUDED.tenant_notes,
    tenant_created_at                = EXCLUDED.tenant_created_at,
    tenant_updated_at                = EXCLUDED.tenant_updated_at,
    tenant_archived_at               = EXCLUDED.tenant_archived_at;

-- Verification
SELECT
    'tenant_settings rows upserted' AS label,
    COUNT(*) AS count
FROM master_record_tenant;

COMMIT;
