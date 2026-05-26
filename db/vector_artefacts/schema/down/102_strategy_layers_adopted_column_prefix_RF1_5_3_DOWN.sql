-- ============================================================
-- 102_strategy_layers_adopted_column_prefix_RF1_5_3_DOWN.sql
--
-- Reverses 102_strategy_layers_adopted_column_prefix_RF1_5_3.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE strategy_layers_adopted
    RENAME CONSTRAINT strategy_layers_adopted_id_artefact_type_fkey
                  TO strategy_layers_adopted_artefact_type_id_fkey;

-- ---- Index renames (reverse) ----

ALTER INDEX strategy_layers_adopted_id_subscription_id_library_layer_uniq
    RENAME TO strategy_layers_adopted_unique_per_sub;

ALTER INDEX idx_strategy_layers_adopted_id_artefact_type
    RENAME TO strategy_layers_adopted_by_type;

-- ---- Column renames (reverse) ----

ALTER TABLE strategy_layers_adopted RENAME COLUMN strategy_layers_adopted_adopted_at          TO adopted_at;
ALTER TABLE strategy_layers_adopted RENAME COLUMN strategy_layers_adopted_library_depth       TO library_depth;
ALTER TABLE strategy_layers_adopted RENAME COLUMN strategy_layers_adopted_library_layer_tag   TO library_layer_tag;
ALTER TABLE strategy_layers_adopted RENAME COLUMN strategy_layers_adopted_library_layer_name  TO library_layer_name;
ALTER TABLE strategy_layers_adopted RENAME COLUMN strategy_layers_adopted_id_artefact_type    TO artefact_type_id;
ALTER TABLE strategy_layers_adopted RENAME COLUMN strategy_layers_adopted_id_library_layer    TO library_layer_id;
ALTER TABLE strategy_layers_adopted RENAME COLUMN strategy_layers_adopted_id_subscription     TO subscription_id;
ALTER TABLE strategy_layers_adopted RENAME COLUMN strategy_layers_adopted_id                  TO id;

COMMIT;
