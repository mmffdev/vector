-- db/schema/126_master_record_tenant.sql
--
-- Per-tenant base settings: one row per subscription holding the
-- canonical workspace identity, time/date conventions, planning
-- defaults, and feature flags surfaced by the
-- /workspace-settings/organization page.
--
-- Subscription_id is the primary key — every tenant has exactly one
-- record. A trigger autopopulates this row when a new subscription
-- is created so the page never sees a missing record.

CREATE TABLE master_record_tenant (
    subscription_id              uuid PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,

    -- Identity
    workspace_name               text   NOT NULL DEFAULT 'New workspace',
    description                  text,
    owner_user_id                uuid   REFERENCES users(id) ON DELETE SET NULL,
    data_region                  text   NOT NULL DEFAULT 'use1' CHECK (data_region IN (
        'use1','use2','usw1','usw2','cac1','caw1','sae1',
        'euw1','euw2','euw3','euc1','eun1',
        'mec1','mes1','afs1',
        'aps1','apse1','apse2','apne1','apne2','ape1'
    )),

    -- Time & dates
    timezone                     text   NOT NULL DEFAULT 'Europe/London',
    date_format                  text   NOT NULL DEFAULT 'DD/MM/YYYY' CHECK (date_format IN (
        'DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD','DD-MMM-YYYY','D MMMM YYYY','MMMM D, YYYY'
    )),
    datetime_format              text   NOT NULL DEFAULT 'DD/MM/YYYY HH:mm' CHECK (datetime_format IN (
        'DD/MM/YYYY HH:mm','MM/DD/YYYY hh:mm a','YYYY-MM-DD HH:mm','D MMM YYYY, HH:mm'
    )),

    -- Workdays. workdays is a subset of {mon..sun}; week_start is mon|sun.
    workdays                     text[] NOT NULL DEFAULT ARRAY['mon','tue','wed','thu','fri']::text[],
    week_start                   text   NOT NULL DEFAULT 'mon' CHECK (week_start IN ('mon','sun')),

    -- Project defaults
    default_access               text   NOT NULL DEFAULT 'no_access' CHECK (default_access IN (
        'no_access','viewer','editor'
    )),

    -- Planning
    rank_method                  text   NOT NULL DEFAULT 'dragdrop' CHECK (rank_method IN (
        'manual','dragdrop'
    )),

    -- Features
    build_changeset_tracking     boolean NOT NULL DEFAULT FALSE,
    auto_unblock_portfolio_items boolean NOT NULL DEFAULT TRUE,
    time_tracker                 boolean NOT NULL DEFAULT FALSE,

    -- Notes / contact
    workspace_notes              text,
    primary_contact_email        text,

    -- Audit
    created_at                   timestamptz NOT NULL DEFAULT now(),
    updated_at                   timestamptz NOT NULL DEFAULT now(),
    archived_at                  timestamptz,

    -- Workdays must be a non-empty subset of the seven day codes.
    CONSTRAINT master_record_tenant_workdays_valid CHECK (
        cardinality(workdays) BETWEEN 1 AND 7
        AND workdays <@ ARRAY['mon','tue','wed','thu','fri','sat','sun']::text[]
    ),
    CONSTRAINT master_record_tenant_email_format CHECK (
        primary_contact_email IS NULL
        OR primary_contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    )
);

CREATE INDEX idx_master_record_tenant_archived_at ON master_record_tenant(archived_at);
CREATE INDEX idx_master_record_tenant_owner_user_id ON master_record_tenant(owner_user_id);

-- Touch updated_at on every UPDATE. Same pattern as other auditable tables.
CREATE OR REPLACE FUNCTION fn_master_record_tenant_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_master_record_tenant_touch_updated_at
    BEFORE UPDATE ON master_record_tenant
    FOR EACH ROW EXECUTE FUNCTION fn_master_record_tenant_touch_updated_at();

-- Auto-create one row per subscription so the page always has a target.
CREATE OR REPLACE FUNCTION fn_master_record_tenant_seed_for_subscription() RETURNS trigger AS $$
BEGIN
    INSERT INTO master_record_tenant (subscription_id, workspace_name)
        VALUES (NEW.id, COALESCE(NEW.name, 'New workspace'))
    ON CONFLICT (subscription_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_subscriptions_seed_master_record
    AFTER INSERT ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION fn_master_record_tenant_seed_for_subscription();

-- Backfill existing subscriptions so every current tenant has a row.
INSERT INTO master_record_tenant (subscription_id, workspace_name)
SELECT s.id, COALESCE(s.name, 'New workspace')
  FROM subscriptions s
  LEFT JOIN master_record_tenant m ON m.subscription_id = s.id
 WHERE m.subscription_id IS NULL;
