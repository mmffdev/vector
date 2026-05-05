-- ============================================================
-- MMFFDev - Vector: Artefact-type naming convergence + tenant types
-- Migration 106 — applied on top of 105_artefact_flow_states.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 106_artefact_types_naming_and_tenant.sql
--
-- WHY ----------------------------------------------------------
-- The artefact-type domain currently has scattered names:
--   o_artefact_type_registry            (system catalogue)
--   o_subscription_artefact_type_overrides (per-tenant display overrides)
--   o_artefact_flow_default             (system default flow)
--   o_subscription_artefact_flow        (per-tenant flow)
--
-- A fresh DBA reading \dt sees these split across three alphabetic
-- regions (o_artefact_*, o_subscription_*). Hard to recognise as one
-- domain. This migration consolidates everything under o_artefact_*
-- so the six tables sort together as one block:
--   o_artefact_flows_system
--   o_artefact_flows_tenant
--   o_artefact_types_overrides
--   o_artefact_types_system
--   o_artefact_types_tenant   ← NEW (this migration)
--
-- THIS MIGRATION ALSO INTRODUCES TENANT-CREATED ARTEFACT TYPES.
-- Until now Vector only had vendor-seeded artefact types
-- (execution_work_items, execution_defects, etc.) plus per-subscription
-- portfolio_item_types (Theme/Initiative/Feature). There was no path
-- for a tenant to invent a brand-new execution-layer artefact type
-- (e.g. "Capability", "Increment", "Spike"). That's the gap closed
-- here: o_artefact_types_tenant lets a gadmin define custom artefact
-- types per subscription, with the same UUID-keyed shape as system
-- types so the flow tables work uniformly across both.
--
-- The flow tables now dispatch to one of:
--   - artefact_type_id        → o_artefact_types_system(id)
--   - tenant_artefact_type_id → o_artefact_types_tenant(id)   ← NEW
--   - portfolio_item_type_id  → portfolio_item_types(id)
-- with an exactly-one CHECK across all three.
--
-- WHAT THIS MIGRATION DOES NOT DO ------------------------------
-- - Does NOT define field schema for tenant types (custom fields
--   per tenant type are a separate, larger migration).
-- - Does NOT define the artefact data store for tenant types
--   (where rows of type "Capability" actually live — a separate
--   storage decision; either a generic o_artefacts superclass or
--   field-only tenant types layered over an existing table).
-- - Does NOT seed any tenant types (subscriptions create their own).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Rename existing tables for naming convergence
-- Postgres preserves FK references by OID, so all dependents
-- (o_artefact_notes, o_artefact_versions, o_search_index_outbox,
-- and the flow tables themselves) keep working without further
-- changes — their FK arrows just point at the new table names.
-- ============================================================

ALTER TABLE o_artefact_type_registry              RENAME TO o_artefact_types_system;
ALTER TABLE o_subscription_artefact_type_overrides RENAME TO o_artefact_types_overrides;
ALTER TABLE o_artefact_flow_default               RENAME TO o_artefact_flows_system;
ALTER TABLE o_subscription_artefact_flow          RENAME TO o_artefact_flows_tenant;

-- ============================================================
-- 2. Rename indexes / constraints / triggers to match new
-- table names (cosmetic but keeps \d output legible).
-- ============================================================

-- o_artefact_types_system
ALTER INDEX  o_artefact_type_registry_pkey       RENAME TO o_artefact_types_system_pkey;
ALTER INDEX  o_artefact_type_registry_id_unique  RENAME TO o_artefact_types_system_id_unique;
ALTER TABLE  o_artefact_types_system RENAME CONSTRAINT o_atr_scope_key_fmt TO o_artefact_types_system_scope_key_fmt;
ALTER TABLE  o_artefact_types_system RENAME CONSTRAINT o_atr_prefix_fmt    TO o_artefact_types_system_prefix_fmt;

-- o_artefact_types_overrides
ALTER INDEX  o_subscription_artefact_type_overrides_pkey RENAME TO o_artefact_types_overrides_pkey;
ALTER INDEX  idx_o_sato_sub                              RENAME TO idx_o_artefact_types_overrides_sub;
ALTER TABLE  o_artefact_types_overrides RENAME CONSTRAINT o_sato_prefix_fmt TO o_artefact_types_overrides_prefix_fmt;

-- o_artefact_flows_system
ALTER INDEX  o_artefact_flow_default_pkey RENAME TO o_artefact_flows_system_pkey;
ALTER INDEX  idx_o_afd_type               RENAME TO idx_o_artefact_flows_system_type;
ALTER INDEX  idx_o_afd_canonical          RENAME TO idx_o_artefact_flows_system_canonical;
ALTER TABLE  o_artefact_flows_system RENAME CONSTRAINT o_afd_position_unique     TO o_artefact_flows_system_position_unique;
ALTER TABLE  o_artefact_flows_system RENAME CONSTRAINT o_afd_name_unique         TO o_artefact_flows_system_name_unique;
ALTER TABLE  o_artefact_flows_system RENAME CONSTRAINT o_afd_position_positive   TO o_artefact_flows_system_position_positive;
ALTER TRIGGER trg_o_afd_updated_at ON o_artefact_flows_system RENAME TO trg_o_artefact_flows_system_updated_at;

-- o_artefact_flows_tenant
ALTER INDEX  o_subscription_artefact_flow_pkey  RENAME TO o_artefact_flows_tenant_pkey;
ALTER INDEX  idx_o_saf_subscription             RENAME TO idx_o_artefact_flows_tenant_subscription;
ALTER INDEX  idx_o_saf_canonical                RENAME TO idx_o_artefact_flows_tenant_canonical;
ALTER INDEX  idx_o_saf_registry                 RENAME TO idx_o_artefact_flows_tenant_system;
ALTER INDEX  idx_o_saf_portfolio                RENAME TO idx_o_artefact_flows_tenant_portfolio;
ALTER INDEX  o_saf_position_unique_registry     RENAME TO o_artefact_flows_tenant_position_unique_system;
ALTER INDEX  o_saf_position_unique_portfolio    RENAME TO o_artefact_flows_tenant_position_unique_portfolio;
ALTER INDEX  o_saf_name_unique_registry         RENAME TO o_artefact_flows_tenant_name_unique_system;
ALTER INDEX  o_saf_name_unique_portfolio        RENAME TO o_artefact_flows_tenant_name_unique_portfolio;
ALTER TABLE  o_artefact_flows_tenant RENAME CONSTRAINT o_saf_target_exactly_one TO o_artefact_flows_tenant_target_exactly_one;
ALTER TABLE  o_artefact_flows_tenant RENAME CONSTRAINT o_saf_position_positive  TO o_artefact_flows_tenant_position_positive;
ALTER TRIGGER trg_o_saf_updated_at ON o_artefact_flows_tenant RENAME TO trg_o_artefact_flows_tenant_updated_at;

-- ============================================================
-- 3. New table: o_artefact_types_tenant
-- Per-subscription custom artefact types invented by gadmins.
-- Structurally mirrors o_artefact_types_system but adds:
--   - subscription_id (tenancy scope)
--   - parent_system_type_id (optional — "this is a flavour of
--     execution_work_items but with our own name and flow")
--   - archived_at (soft delete)
--   - created_by / updated_by (audit)
--
-- scope_key here is per-subscription, not global — two tenants
-- can both use scope_key = "capability" without collision.
-- ============================================================
CREATE TABLE o_artefact_types_tenant (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id          UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    parent_system_type_id    UUID                 REFERENCES o_artefact_types_system(id) ON DELETE SET NULL,
    scope_key                TEXT        NOT NULL,
    artefact_table           TEXT,
    default_prefix           TEXT        NOT NULL,
    display_label            TEXT        NOT NULL,
    display_label_plural     TEXT        NOT NULL,
    description              TEXT,
    phase                    TEXT        NOT NULL DEFAULT 'PH-0005',
    is_active                BOOLEAN     NOT NULL DEFAULT TRUE,
    archived_at              TIMESTAMPTZ,
    created_by               UUID                 REFERENCES users(id) ON DELETE SET NULL,
    updated_by               UUID                 REFERENCES users(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT o_artefact_types_tenant_scope_key_fmt
        CHECK (scope_key ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT o_artefact_types_tenant_prefix_fmt
        CHECK (default_prefix ~ '^[A-Z][A-Z0-9]{0,7}$'),
    CONSTRAINT o_artefact_types_tenant_scope_key_unique
        UNIQUE (subscription_id, scope_key)
);

CREATE INDEX idx_o_artefact_types_tenant_subscription
    ON o_artefact_types_tenant (subscription_id) WHERE archived_at IS NULL;

CREATE INDEX idx_o_artefact_types_tenant_parent
    ON o_artefact_types_tenant (parent_system_type_id);

CREATE TRIGGER trg_o_artefact_types_tenant_updated_at
    BEFORE UPDATE ON o_artefact_types_tenant
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 4. Extend o_artefact_flows_tenant to dispatch on tenant types
-- Adds a third nullable target column. The existing exactly-one
-- CHECK is replaced with one that covers all three columns.
-- ============================================================

ALTER TABLE o_artefact_flows_tenant
    ADD COLUMN tenant_artefact_type_id UUID
        REFERENCES o_artefact_types_tenant(id) ON DELETE CASCADE;

-- Rename existing column for clarity now that there are three target FKs.
ALTER TABLE o_artefact_flows_tenant
    RENAME COLUMN artefact_type_id TO system_artefact_type_id;

-- Drop old two-way CHECK and replace with three-way exactly-one.
ALTER TABLE o_artefact_flows_tenant
    DROP CONSTRAINT o_artefact_flows_tenant_target_exactly_one;

ALTER TABLE o_artefact_flows_tenant
    ADD  CONSTRAINT o_artefact_flows_tenant_target_exactly_one CHECK (
        ( (system_artefact_type_id  IS NOT NULL)::int
        + (tenant_artefact_type_id  IS NOT NULL)::int
        + (portfolio_item_type_id   IS NOT NULL)::int
        ) = 1
    );

-- Adjust partial uniques + indexes to use the renamed column.
DROP INDEX o_artefact_flows_tenant_position_unique_system;
DROP INDEX o_artefact_flows_tenant_name_unique_system;
DROP INDEX idx_o_artefact_flows_tenant_system;

CREATE UNIQUE INDEX o_artefact_flows_tenant_position_unique_system
    ON o_artefact_flows_tenant (subscription_id, system_artefact_type_id, flow_position)
    WHERE system_artefact_type_id IS NOT NULL;

CREATE UNIQUE INDEX o_artefact_flows_tenant_position_unique_tenant
    ON o_artefact_flows_tenant (subscription_id, tenant_artefact_type_id, flow_position)
    WHERE tenant_artefact_type_id IS NOT NULL;

CREATE UNIQUE INDEX o_artefact_flows_tenant_name_unique_system
    ON o_artefact_flows_tenant (subscription_id, system_artefact_type_id, name)
    WHERE system_artefact_type_id IS NOT NULL;

CREATE UNIQUE INDEX o_artefact_flows_tenant_name_unique_tenant
    ON o_artefact_flows_tenant (subscription_id, tenant_artefact_type_id, name)
    WHERE tenant_artefact_type_id IS NOT NULL;

CREATE INDEX idx_o_artefact_flows_tenant_system
    ON o_artefact_flows_tenant (system_artefact_type_id) WHERE system_artefact_type_id IS NOT NULL;

CREATE INDEX idx_o_artefact_flows_tenant_tenant
    ON o_artefact_flows_tenant (tenant_artefact_type_id) WHERE tenant_artefact_type_id IS NOT NULL;

-- ============================================================
-- 5. Rename column on o_artefact_flows_system for symmetry
-- (still only references o_artefact_types_system — vendor seeds
-- can't reference tenant-created types.)
-- ============================================================

ALTER TABLE o_artefact_flows_system
    RENAME COLUMN artefact_type_id TO system_artefact_type_id;

-- Indexes on this column inherit the new name automatically since
-- they were renamed in step 2. The unique constraints reference
-- the column by name in their definition, so they auto-update too.

COMMIT;
