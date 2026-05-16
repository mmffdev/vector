-- ============================================================
-- DOWN: 106_artefact_types_naming_and_tenant.sql
-- Reverses the naming convergence and removes o_artefact_types_tenant.
-- After this runs, table names match the post-105 / pre-106 layout.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Reverse column rename on o_artefact_flows_system
-- ============================================================
ALTER TABLE o_artefact_flows_system
    RENAME COLUMN system_artefact_type_id TO artefact_type_id;

-- ============================================================
-- 2. Reverse o_artefact_flows_tenant changes
-- Drop the 3-way CHECK + tenant-target indexes, then the column,
-- restore the 2-way CHECK, and rename system_artefact_type_id back.
-- ============================================================

ALTER TABLE o_artefact_flows_tenant
    DROP CONSTRAINT o_artefact_flows_tenant_target_exactly_one;

DROP INDEX o_artefact_flows_tenant_position_unique_system;
DROP INDEX o_artefact_flows_tenant_position_unique_tenant;
DROP INDEX o_artefact_flows_tenant_name_unique_system;
DROP INDEX o_artefact_flows_tenant_name_unique_tenant;
DROP INDEX idx_o_artefact_flows_tenant_system;
DROP INDEX idx_o_artefact_flows_tenant_tenant;

ALTER TABLE o_artefact_flows_tenant
    DROP COLUMN tenant_artefact_type_id;

ALTER TABLE o_artefact_flows_tenant
    RENAME COLUMN system_artefact_type_id TO artefact_type_id;

ALTER TABLE o_artefact_flows_tenant
    ADD CONSTRAINT o_artefact_flows_tenant_target_exactly_one CHECK (
        (artefact_type_id IS NOT NULL AND portfolio_item_type_id IS NULL) OR
        (artefact_type_id IS NULL     AND portfolio_item_type_id IS NOT NULL)
    );

CREATE UNIQUE INDEX o_artefact_flows_tenant_position_unique_system
    ON o_artefact_flows_tenant (subscription_id, artefact_type_id, flow_position)
    WHERE artefact_type_id IS NOT NULL;

CREATE UNIQUE INDEX o_artefact_flows_tenant_name_unique_system
    ON o_artefact_flows_tenant (subscription_id, artefact_type_id, name)
    WHERE artefact_type_id IS NOT NULL;

CREATE INDEX idx_o_artefact_flows_tenant_system
    ON o_artefact_flows_tenant (artefact_type_id) WHERE artefact_type_id IS NOT NULL;

-- ============================================================
-- 3. Drop o_artefact_types_tenant (depends on system table)
-- ============================================================
DROP TABLE IF EXISTS o_artefact_types_tenant CASCADE;

-- ============================================================
-- 4. Reverse index/constraint/trigger renames
-- ============================================================

-- o_artefact_flows_tenant
ALTER TRIGGER trg_o_artefact_flows_tenant_updated_at ON o_artefact_flows_tenant RENAME TO trg_o_saf_updated_at;
ALTER TABLE  o_artefact_flows_tenant RENAME CONSTRAINT o_artefact_flows_tenant_position_positive  TO o_saf_position_positive;
ALTER TABLE  o_artefact_flows_tenant RENAME CONSTRAINT o_artefact_flows_tenant_target_exactly_one TO o_saf_target_exactly_one;
ALTER INDEX  o_artefact_flows_tenant_name_unique_portfolio    RENAME TO o_saf_name_unique_portfolio;
ALTER INDEX  o_artefact_flows_tenant_name_unique_system       RENAME TO o_saf_name_unique_registry;
ALTER INDEX  o_artefact_flows_tenant_position_unique_portfolio RENAME TO o_saf_position_unique_portfolio;
ALTER INDEX  o_artefact_flows_tenant_position_unique_system   RENAME TO o_saf_position_unique_registry;
ALTER INDEX  idx_o_artefact_flows_tenant_portfolio   RENAME TO idx_o_saf_portfolio;
ALTER INDEX  idx_o_artefact_flows_tenant_system      RENAME TO idx_o_saf_registry;
ALTER INDEX  idx_o_artefact_flows_tenant_canonical   RENAME TO idx_o_saf_canonical;
ALTER INDEX  idx_o_artefact_flows_tenant_subscription RENAME TO idx_o_saf_subscription;
ALTER INDEX  o_artefact_flows_tenant_pkey            RENAME TO o_subscription_artefact_flow_pkey;

-- o_artefact_flows_system
ALTER TRIGGER trg_o_artefact_flows_system_updated_at ON o_artefact_flows_system RENAME TO trg_o_afd_updated_at;
ALTER TABLE  o_artefact_flows_system RENAME CONSTRAINT o_artefact_flows_system_position_positive TO o_afd_position_positive;
ALTER TABLE  o_artefact_flows_system RENAME CONSTRAINT o_artefact_flows_system_name_unique       TO o_afd_name_unique;
ALTER TABLE  o_artefact_flows_system RENAME CONSTRAINT o_artefact_flows_system_position_unique   TO o_afd_position_unique;
ALTER INDEX  idx_o_artefact_flows_system_canonical RENAME TO idx_o_afd_canonical;
ALTER INDEX  idx_o_artefact_flows_system_type      RENAME TO idx_o_afd_type;
ALTER INDEX  o_artefact_flows_system_pkey          RENAME TO o_artefact_flow_default_pkey;

-- o_artefact_types_overrides
ALTER TABLE  o_artefact_types_overrides RENAME CONSTRAINT o_artefact_types_overrides_prefix_fmt TO o_sato_prefix_fmt;
ALTER INDEX  idx_o_artefact_types_overrides_sub RENAME TO idx_o_sato_sub;
ALTER INDEX  o_artefact_types_overrides_pkey   RENAME TO o_subscription_artefact_type_overrides_pkey;

-- o_artefact_types_system
ALTER TABLE  o_artefact_types_system RENAME CONSTRAINT o_artefact_types_system_prefix_fmt    TO o_atr_prefix_fmt;
ALTER TABLE  o_artefact_types_system RENAME CONSTRAINT o_artefact_types_system_scope_key_fmt TO o_atr_scope_key_fmt;
ALTER INDEX  o_artefact_types_system_id_unique RENAME TO o_artefact_type_registry_id_unique;
ALTER INDEX  o_artefact_types_system_pkey      RENAME TO o_artefact_type_registry_pkey;

-- ============================================================
-- 5. Reverse table renames
-- ============================================================
ALTER TABLE o_artefact_flows_tenant     RENAME TO o_subscription_artefact_flow;
ALTER TABLE o_artefact_flows_system     RENAME TO o_artefact_flow_default;
ALTER TABLE o_artefact_types_overrides  RENAME TO o_subscription_artefact_type_overrides;
ALTER TABLE o_artefact_types_system     RENAME TO o_artefact_type_registry;

COMMIT;
