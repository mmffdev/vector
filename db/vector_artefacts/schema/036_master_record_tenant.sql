-- ============================================================
-- MMFFDev - vector_artefacts: master_record_tenant
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 036_master_record_tenant.sql
--
-- One row per workspace holding canonical identity, time/date
-- conventions, and planning defaults. Mirrors the mmff_vector
-- master_record_tenant table (post-migration 127/128) exactly,
-- with subscription_id/tenant_id → workspace_id rename.
--
-- workspace_id is a bare UUID (no FK — workspaces table lives in
-- mmff_vector, not in vector_artefacts). Same pattern as artefacts.
--
-- Column map from mmff_vector.master_record_tenant:
--   tenant_id                        → workspace_id  (PK rename)
--   tenant_name                      → tenant_name
--   tenant_description               → tenant_description
--   tenant_owner_user_id             → tenant_owner_user_id
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
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS master_record_tenant (
    workspace_id                     UUID        PRIMARY KEY,

    -- Identity
    tenant_name                      TEXT        NOT NULL DEFAULT 'New workspace',
    tenant_description               TEXT,
    tenant_owner_user_id             UUID,
    tenant_primary_contact_email     TEXT,

    -- Data region
    tenant_data_region               TEXT        NOT NULL DEFAULT 'use1' CHECK (tenant_data_region IN (
        'use1','use2','usw1','usw2','cac1','caw1','sae1',
        'euw1','euw2','euw3','euc1','eun1',
        'mec1','mes1','afs1',
        'aps1','apse1','apse2','apne1','apne2','ape1'
    )),

    -- Time & dates
    tenant_timezone                  TEXT        NOT NULL DEFAULT 'Europe/London',
    tenant_date_format               TEXT        NOT NULL DEFAULT 'DD/MM/YYYY' CHECK (tenant_date_format IN (
        'DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD','DD-MMM-YYYY','D MMMM YYYY','MMMM D, YYYY'
    )),
    tenant_datetime_format           TEXT        NOT NULL DEFAULT 'DD/MM/YYYY HH:mm' CHECK (tenant_datetime_format IN (
        'DD/MM/YYYY HH:mm','MM/DD/YYYY hh:mm a','YYYY-MM-DD HH:mm','D MMM YYYY, HH:mm'
    )),

    -- Workdays
    tenant_workdays                  TEXT[]      NOT NULL DEFAULT ARRAY['mon','tue','wed','thu','fri']::text[],
    tenant_week_start                TEXT        NOT NULL DEFAULT 'mon' CHECK (tenant_week_start IN ('mon','sun')),

    -- Planning
    tenant_rank_method               TEXT        NOT NULL DEFAULT 'dragdrop' CHECK (tenant_rank_method IN ('manual','dragdrop')),

    -- Features
    tenant_build_changeset_tracking  BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Notes
    tenant_notes                     TEXT,

    -- Audit
    tenant_created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    tenant_updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    tenant_archived_at               TIMESTAMPTZ,

    CONSTRAINT master_record_tenant_workdays_valid CHECK (
        cardinality(tenant_workdays) BETWEEN 1 AND 7
        AND tenant_workdays <@ ARRAY['mon','tue','wed','thu','fri','sat','sun']::text[]
    ),
    CONSTRAINT master_record_tenant_email_format CHECK (
        tenant_primary_contact_email IS NULL
        OR tenant_primary_contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    )
);

CREATE INDEX IF NOT EXISTS idx_master_record_tenant_archived_at
    ON master_record_tenant (tenant_archived_at);

CREATE INDEX IF NOT EXISTS idx_master_record_tenant_owner_user_id
    ON master_record_tenant (tenant_owner_user_id);

CREATE OR REPLACE FUNCTION fn_master_record_tenant_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.tenant_updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_master_record_tenant_touch_updated_at ON master_record_tenant;
CREATE TRIGGER trg_master_record_tenant_touch_updated_at
    BEFORE UPDATE ON master_record_tenant
    FOR EACH ROW EXECUTE FUNCTION fn_master_record_tenant_touch_updated_at();

COMMIT;
