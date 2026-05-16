-- db/schema/123_rename_tables_to_obj_family.sql
--
-- Phase 2 schema cleanup (per polymorphic-swimming-journal plan).
--
-- Renames the 13 actively-used core tables to the unified `obj_*` family so
-- that a DBA opening \d sees one alphabetical block of artefact storage.
-- ALTER TABLE … RENAME TO is a catalog-only operation: zero rows are
-- rewritten and FK constraints follow the table by ID.
--
-- NO compatibility views are created. The accompanying Go + TypeScript
-- sweep updates every reference in the same change. View shims would be
-- fresh debt; per project policy we update everything in lockstep.
--
-- NOT renamed in this migration (deferred):
--   * o_artefacts_execution_{defects,tasks,test_cases}* and o_artefacts_strategic*
--       — empty, but still referenced by backend/internal/artefacts
--         and backend/internal/searchworker. Rename together with the
--         artefacts-package removal.
--   * o_search_index_outbox — search-infra concern, not artefact storage.
--   * o_artefact_visibility_levels, canonical_states — small enum-like
--     lookups; rename when their consumer columns are also retyped.
--
-- NOT updated here (deferred): index/constraint names that still embed the
-- old table name. Cosmetic only — Postgres tracks references by OID, not
-- by name. Follow-up DBA-cleanup migration can rename them.

ALTER TABLE o_artefacts_execution_work_items_field_values RENAME TO obj_work_items_field_values;
ALTER TABLE o_artefacts_execution_work_items              RENAME TO obj_work_items;

ALTER TABLE o_execution_work_item_template_fields RENAME TO obj_field_template_fields;
ALTER TABLE o_execution_work_item_templates       RENAME TO obj_field_templates;
ALTER TABLE o_execution_custom_field_library      RENAME TO obj_custom_field_lib;

ALTER TABLE o_artefact_types_overrides RENAME TO obj_execution_types_overrides;
ALTER TABLE o_artefact_types_tenant    RENAME TO obj_execution_types_tenant;
ALTER TABLE o_artefact_types_system    RENAME TO obj_execution_types;

ALTER TABLE portfolio_item_types  RENAME TO obj_strategy_types;
ALTER TABLE portfolio_items       RENAME TO obj_portfolio_items;
ALTER TABLE subscription_layers   RENAME TO obj_strategy_types_layers;

ALTER TABLE o_flow_system RENAME TO obj_flow_system;
ALTER TABLE o_flow_tenant RENAME TO obj_flow_tenant;
