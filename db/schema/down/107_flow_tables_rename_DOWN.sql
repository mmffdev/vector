-- ============================================================
-- DOWN: 107_flow_tables_rename.sql
-- Restores o_flow_* table names back to o_artefact_flows_*.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Reverse index/constraint/trigger renames
-- ============================================================

-- o_flow_tenant
ALTER TRIGGER trg_o_flow_tenant_updated_at ON o_flow_tenant RENAME TO trg_o_artefact_flows_tenant_updated_at;
ALTER TABLE  o_flow_tenant RENAME CONSTRAINT o_flow_tenant_position_positive  TO o_artefact_flows_tenant_position_positive;
ALTER TABLE  o_flow_tenant RENAME CONSTRAINT o_flow_tenant_target_exactly_one TO o_artefact_flows_tenant_target_exactly_one;
ALTER INDEX  o_flow_tenant_name_unique_portfolio      RENAME TO o_artefact_flows_tenant_name_unique_portfolio;
ALTER INDEX  o_flow_tenant_name_unique_tenant         RENAME TO o_artefact_flows_tenant_name_unique_tenant;
ALTER INDEX  o_flow_tenant_name_unique_system         RENAME TO o_artefact_flows_tenant_name_unique_system;
ALTER INDEX  o_flow_tenant_position_unique_portfolio  RENAME TO o_artefact_flows_tenant_position_unique_portfolio;
ALTER INDEX  o_flow_tenant_position_unique_tenant     RENAME TO o_artefact_flows_tenant_position_unique_tenant;
ALTER INDEX  o_flow_tenant_position_unique_system     RENAME TO o_artefact_flows_tenant_position_unique_system;
ALTER INDEX  idx_o_flow_tenant_portfolio              RENAME TO idx_o_artefact_flows_tenant_portfolio;
ALTER INDEX  idx_o_flow_tenant_tenant                 RENAME TO idx_o_artefact_flows_tenant_tenant;
ALTER INDEX  idx_o_flow_tenant_system                 RENAME TO idx_o_artefact_flows_tenant_system;
ALTER INDEX  idx_o_flow_tenant_canonical              RENAME TO idx_o_artefact_flows_tenant_canonical;
ALTER INDEX  idx_o_flow_tenant_subscription           RENAME TO idx_o_artefact_flows_tenant_subscription;
ALTER INDEX  o_flow_tenant_pkey                       RENAME TO o_artefact_flows_tenant_pkey;

-- o_flow_system
ALTER TRIGGER trg_o_flow_system_updated_at ON o_flow_system RENAME TO trg_o_artefact_flows_system_updated_at;
ALTER TABLE  o_flow_system RENAME CONSTRAINT o_flow_system_position_positive TO o_artefact_flows_system_position_positive;
ALTER TABLE  o_flow_system RENAME CONSTRAINT o_flow_system_name_unique       TO o_artefact_flows_system_name_unique;
ALTER TABLE  o_flow_system RENAME CONSTRAINT o_flow_system_position_unique   TO o_artefact_flows_system_position_unique;
ALTER INDEX  idx_o_flow_system_canonical RENAME TO idx_o_artefact_flows_system_canonical;
ALTER INDEX  idx_o_flow_system_type      RENAME TO idx_o_artefact_flows_system_type;
ALTER INDEX  o_flow_system_pkey          RENAME TO o_artefact_flows_system_pkey;

-- ============================================================
-- 2. Reverse table renames
-- ============================================================
ALTER TABLE o_flow_tenant RENAME TO o_artefact_flows_tenant;
ALTER TABLE o_flow_system RENAME TO o_artefact_flows_system;

COMMIT;
