-- ============================================================
-- MMFFDev - Vector: Flow tables rename (o_artefact_flows_* → o_flow_*)
-- Migration 107 — applied on top of 106_artefact_types_naming_and_tenant.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 107_flow_tables_rename.sql
--
-- WHY ----------------------------------------------------------
-- Migration 106 clustered the artefact-type domain under o_artefact_*.
-- The flow tables landed under that prefix too (o_artefact_flows_system /
-- o_artefact_flows_tenant) but they're conceptually a sibling concern,
-- not a sub-noun of artefact-types. This migration renames the two
-- flow tables to o_flow_* so they have their own short prefix.
--
-- The flow tables still REFERENCE the artefact-type tables — that's
-- unchanged. Only the table names move; FKs point at the same OIDs.
--
-- Final layout under o_*:
--   o_artefact_types_overrides
--   o_artefact_types_system
--   o_artefact_types_tenant
--   o_flow_system           ← renamed from o_artefact_flows_system
--   o_flow_tenant           ← renamed from o_artefact_flows_tenant
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Rename tables
-- ============================================================
ALTER TABLE o_artefact_flows_system RENAME TO o_flow_system;
ALTER TABLE o_artefact_flows_tenant RENAME TO o_flow_tenant;

-- ============================================================
-- 2. Rename indexes / constraints / triggers to match
-- ============================================================

-- o_flow_system
ALTER INDEX  o_artefact_flows_system_pkey            RENAME TO o_flow_system_pkey;
ALTER INDEX  idx_o_artefact_flows_system_type        RENAME TO idx_o_flow_system_type;
ALTER INDEX  idx_o_artefact_flows_system_canonical   RENAME TO idx_o_flow_system_canonical;
ALTER TABLE  o_flow_system RENAME CONSTRAINT o_artefact_flows_system_position_unique   TO o_flow_system_position_unique;
ALTER TABLE  o_flow_system RENAME CONSTRAINT o_artefact_flows_system_name_unique       TO o_flow_system_name_unique;
ALTER TABLE  o_flow_system RENAME CONSTRAINT o_artefact_flows_system_position_positive TO o_flow_system_position_positive;
ALTER TRIGGER trg_o_artefact_flows_system_updated_at ON o_flow_system RENAME TO trg_o_flow_system_updated_at;

-- o_flow_tenant
ALTER INDEX  o_artefact_flows_tenant_pkey                       RENAME TO o_flow_tenant_pkey;
ALTER INDEX  idx_o_artefact_flows_tenant_subscription           RENAME TO idx_o_flow_tenant_subscription;
ALTER INDEX  idx_o_artefact_flows_tenant_canonical              RENAME TO idx_o_flow_tenant_canonical;
ALTER INDEX  idx_o_artefact_flows_tenant_system                 RENAME TO idx_o_flow_tenant_system;
ALTER INDEX  idx_o_artefact_flows_tenant_tenant                 RENAME TO idx_o_flow_tenant_tenant;
ALTER INDEX  idx_o_artefact_flows_tenant_portfolio              RENAME TO idx_o_flow_tenant_portfolio;
ALTER INDEX  o_artefact_flows_tenant_position_unique_system     RENAME TO o_flow_tenant_position_unique_system;
ALTER INDEX  o_artefact_flows_tenant_position_unique_tenant     RENAME TO o_flow_tenant_position_unique_tenant;
ALTER INDEX  o_artefact_flows_tenant_position_unique_portfolio  RENAME TO o_flow_tenant_position_unique_portfolio;
ALTER INDEX  o_artefact_flows_tenant_name_unique_system         RENAME TO o_flow_tenant_name_unique_system;
ALTER INDEX  o_artefact_flows_tenant_name_unique_tenant         RENAME TO o_flow_tenant_name_unique_tenant;
ALTER INDEX  o_artefact_flows_tenant_name_unique_portfolio      RENAME TO o_flow_tenant_name_unique_portfolio;
ALTER TABLE  o_flow_tenant RENAME CONSTRAINT o_artefact_flows_tenant_target_exactly_one TO o_flow_tenant_target_exactly_one;
ALTER TABLE  o_flow_tenant RENAME CONSTRAINT o_artefact_flows_tenant_position_positive  TO o_flow_tenant_position_positive;
ALTER TRIGGER trg_o_artefact_flows_tenant_updated_at ON o_flow_tenant RENAME TO trg_o_flow_tenant_updated_at;

COMMIT;
