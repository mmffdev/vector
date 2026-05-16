-- ============================================================
-- 068_master_record_tenants_subscription_tier.sql
--
-- PLA-0050 / Story 00568 — tenant-level defaults table.
--
-- Creates a NEW master_record_tenants table in vector_artefacts,
-- keyed by subscription_id (the paying customer / legal entity).
-- One row per subscription. Workspaces in the subscription inherit
-- locale/calendar/region/format defaults from this row when their
-- own master_record_workspaces row carries NULL in the matching
-- column (inheritance read-path is cleanup-register Story 3,
-- deferred from this plan).
--
-- This is a NEW table — the old vector_artefacts.master_record_tenants
-- was renamed to master_record_workspaces by migration 067. The name
-- is now free to take its proper meaning at the tenant tier.
--
-- Cross-DB invariant: subscription_id PK is a logical FK to
-- mmff_vector.subscriptions.id, enforced by the Go service
-- (tenantmasterrecord, sole writer). Postgres-level FKs do not
-- cross DBs. Backfill below inserts one row per existing
-- subscription with system defaults.
--
-- The 16 fields mirror master_record_workspaces minus owner_user_id
-- (tenants are owned via the subscriptions_stakeholders bridge in
-- mmff_vector, not a direct FK column).
-- ============================================================

BEGIN;

CREATE TABLE master_record_tenants (
    master_record_tenants_id_subscription           uuid                     NOT NULL PRIMARY KEY,
    master_record_tenants_name                      text                     NOT NULL DEFAULT 'New tenant',
    master_record_tenants_description               text,
    master_record_tenants_primary_contact_email     text,
    master_record_tenants_data_region               text                     NOT NULL DEFAULT 'use1',
    master_record_tenants_timezone                  text                     NOT NULL DEFAULT 'Europe/London',
    master_record_tenants_date_format               text                     NOT NULL DEFAULT 'DD/MM/YYYY',
    master_record_tenants_datetime_format           text                     NOT NULL DEFAULT 'DD/MM/YYYY HH:mm',
    master_record_tenants_workdays                  text[]                   NOT NULL DEFAULT ARRAY['mon','tue','wed','thu','fri'],
    master_record_tenants_week_start                text                     NOT NULL DEFAULT 'mon',
    master_record_tenants_rank_method               text                     NOT NULL DEFAULT 'dragdrop',
    master_record_tenants_build_changeset_tracking  boolean                  NOT NULL DEFAULT false,
    master_record_tenants_notes                     text,
    master_record_tenants_created_at                timestamp with time zone NOT NULL DEFAULT now(),
    master_record_tenants_updated_at                timestamp with time zone NOT NULL DEFAULT now(),
    master_record_tenants_archived_at               timestamp with time zone
);

CREATE INDEX idx_master_record_tenants_archived_at
    ON master_record_tenants (master_record_tenants_archived_at);

ALTER TABLE master_record_tenants
    ADD CONSTRAINT master_record_tenants_primary_contact_email_format
    CHECK (master_record_tenants_primary_contact_email IS NULL
        OR master_record_tenants_primary_contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

ALTER TABLE master_record_tenants
    ADD CONSTRAINT master_record_tenants_data_region_check
    CHECK (master_record_tenants_data_region = ANY (ARRAY[
        'use1','use2','usw1','usw2','cac1','caw1','sae1',
        'euw1','euw2','euw3','euc1','eun1',
        'mec1','mes1','afs1',
        'aps1','apse1','apse2','apne1','apne2','ape1'
    ]));

ALTER TABLE master_record_tenants
    ADD CONSTRAINT master_record_tenants_date_format_check
    CHECK (master_record_tenants_date_format = ANY (ARRAY[
        'DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD','DD-MMM-YYYY','D MMMM YYYY','MMMM D, YYYY'
    ]));

ALTER TABLE master_record_tenants
    ADD CONSTRAINT master_record_tenants_datetime_format_check
    CHECK (master_record_tenants_datetime_format = ANY (ARRAY[
        'DD/MM/YYYY HH:mm','MM/DD/YYYY hh:mm a','YYYY-MM-DD HH:mm','D MMM YYYY, HH:mm'
    ]));

ALTER TABLE master_record_tenants
    ADD CONSTRAINT master_record_tenants_rank_method_check
    CHECK (master_record_tenants_rank_method = ANY (ARRAY['manual','dragdrop']));

ALTER TABLE master_record_tenants
    ADD CONSTRAINT master_record_tenants_week_start_check
    CHECK (master_record_tenants_week_start = ANY (ARRAY['mon','sun']));

ALTER TABLE master_record_tenants
    ADD CONSTRAINT master_record_tenants_workdays_valid
    CHECK (cardinality(master_record_tenants_workdays) >= 1
       AND cardinality(master_record_tenants_workdays) <= 7
       AND master_record_tenants_workdays <@ ARRAY['mon','tue','wed','thu','fri','sat','sun']);

CREATE OR REPLACE FUNCTION fn_master_record_tenants_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.master_record_tenants_updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_master_record_tenants_touch_updated_at
    BEFORE UPDATE ON master_record_tenants
    FOR EACH ROW EXECUTE FUNCTION fn_master_record_tenants_touch_updated_at();

-- ---- FDW shadow for subscriptions (one-off; not present before this migration) ----

CREATE FOREIGN TABLE IF NOT EXISTS fdw_subscriptions (
    id         uuid,
    name       text,
    slug       text,
    is_active  boolean,
    created_at timestamptz,
    updated_at timestamptz,
    tier       text
)
SERVER fdw_mmff_vector
OPTIONS (schema_name 'public', table_name 'subscriptions');

-- ---- Backfill ----
-- One row per existing subscription, all columns at system defaults. ON CONFLICT
-- keeps re-runs safe and tolerates partial backfill from earlier dev runs.

INSERT INTO master_record_tenants (master_record_tenants_id_subscription, master_record_tenants_name)
SELECT id, COALESCE(name, 'New tenant')
FROM fdw_subscriptions
ON CONFLICT (master_record_tenants_id_subscription) DO NOTHING;

COMMIT;
