-- ============================================================
-- 102_strategy_layers_adopted_column_prefix_RF1_5_3.sql
--
-- RF1.5.3 — Pillar 1 wave 3, table 4/5.
--
-- Applies the §2.3 column-prefix convention to strategy_layers_adopted.
-- PK `id` becomes `strategy_layers_adopted_id`. Three FK-shaped columns:
--   subscription_id   → strategy_layers_adopted_id_subscription
--     (app-soft — subscriptions lives in mmff_vector)
--   library_layer_id  → strategy_layers_adopted_id_library_layer
--     (app-soft — library_strategy_types_layers lives in mmff_library)
--   artefact_type_id  → strategy_layers_adopted_id_artefact_type
--     (real Postgres FK to artefacts_types(artefacts_types_id))
--
-- Per §2.4 FK shape `<table>_id_<target>` (no role suffix needed —
-- single occurrence per target on this table).
--
-- `strategy_layers_adopted_pkey` already carries the table prefix —
-- left untouched.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE strategy_layers_adopted RENAME COLUMN id                 TO strategy_layers_adopted_id;
ALTER TABLE strategy_layers_adopted RENAME COLUMN subscription_id    TO strategy_layers_adopted_id_subscription;
ALTER TABLE strategy_layers_adopted RENAME COLUMN library_layer_id   TO strategy_layers_adopted_id_library_layer;
ALTER TABLE strategy_layers_adopted RENAME COLUMN artefact_type_id   TO strategy_layers_adopted_id_artefact_type;
ALTER TABLE strategy_layers_adopted RENAME COLUMN library_layer_name TO strategy_layers_adopted_library_layer_name;
ALTER TABLE strategy_layers_adopted RENAME COLUMN library_layer_tag  TO strategy_layers_adopted_library_layer_tag;
ALTER TABLE strategy_layers_adopted RENAME COLUMN library_depth      TO strategy_layers_adopted_library_depth;
ALTER TABLE strategy_layers_adopted RENAME COLUMN adopted_at         TO strategy_layers_adopted_adopted_at;

-- ---- Index renames ----

ALTER INDEX strategy_layers_adopted_by_type
    RENAME TO idx_strategy_layers_adopted_id_artefact_type;

ALTER INDEX strategy_layers_adopted_unique_per_sub
    RENAME TO strategy_layers_adopted_id_subscription_id_library_layer_uniq;

-- strategy_layers_adopted_pkey already matches the <table>_pkey
-- convention — left untouched.

-- ---- Constraint renames ----

ALTER TABLE strategy_layers_adopted
    RENAME CONSTRAINT strategy_layers_adopted_artefact_type_id_fkey
                  TO strategy_layers_adopted_id_artefact_type_fkey;

COMMIT;
