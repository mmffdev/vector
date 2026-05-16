-- ============================================================
-- 066_artefacts_types_column_prefix_RF1_4_4.sql
--
-- PLA-0048 / RF1.4.4 — TD-NAME-001 pay-down (8 of N).
--
-- Applies the §2.3 column-prefix convention to artefacts_types.
-- §2.4 FK shapes:
--   • subscription_id → artefacts_types_id_subscription
--   • workspace_id    → artefacts_types_id_workspace
--   • parent_type_id  → artefacts_types_id_parent_type (self-FK)
--   • library_layer_id → artefacts_types_id_library_layer (cross-DB
--                        invariant — no Postgres FK to mmff_library)
--
-- The FK columns ON OTHER TABLES that point to artefacts_types(id)
-- stay bare for now:
--   • artefacts.artefact_type_id       (artefacts table deferred)
--   • artefacts_types_fields.artefact_type_id (separate pay-down)
--   • artefacts_number_sequences.artefact_type_id
--   • flows.flows_id_artefact_type     (already prefixed under flows
--                                       family — mig 065)
--   • flows_defaults.flows_defaults_id_artefact_type (mig 065)
-- Those constraints reference artefacts_types(id) which is now
-- artefacts_types_id; PG resolves FK targets by internal OID so the
-- rename is transparent.
--
-- After this migration `portfoliomodels` package: 45 → 0 → OFF ledger.
-- ============================================================

BEGIN;

-- ---- Column renames (19 columns) ----

ALTER TABLE artefacts_types RENAME COLUMN id                 TO artefacts_types_id;
ALTER TABLE artefacts_types RENAME COLUMN subscription_id    TO artefacts_types_id_subscription;
ALTER TABLE artefacts_types RENAME COLUMN scope              TO artefacts_types_scope;
ALTER TABLE artefacts_types RENAME COLUMN source             TO artefacts_types_source;
ALTER TABLE artefacts_types RENAME COLUMN name               TO artefacts_types_name;
ALTER TABLE artefacts_types RENAME COLUMN prefix             TO artefacts_types_prefix;
ALTER TABLE artefacts_types RENAME COLUMN description        TO artefacts_types_description;
ALTER TABLE artefacts_types RENAME COLUMN parent_type_id     TO artefacts_types_id_parent_type;
ALTER TABLE artefacts_types RENAME COLUMN allows_children    TO artefacts_types_allows_children;
ALTER TABLE artefacts_types RENAME COLUMN layer_depth        TO artefacts_types_layer_depth;
ALTER TABLE artefacts_types RENAME COLUMN sort_order         TO artefacts_types_sort_order;
ALTER TABLE artefacts_types RENAME COLUMN created_at         TO artefacts_types_created_at;
ALTER TABLE artefacts_types RENAME COLUMN updated_at         TO artefacts_types_updated_at;
ALTER TABLE artefacts_types RENAME COLUMN archived_at        TO artefacts_types_archived_at;
ALTER TABLE artefacts_types RENAME COLUMN workspace_id       TO artefacts_types_id_workspace;
ALTER TABLE artefacts_types RENAME COLUMN library_layer_id   TO artefacts_types_id_library_layer;
ALTER TABLE artefacts_types RENAME COLUMN library_layer_tag  TO artefacts_types_library_layer_tag;
ALTER TABLE artefacts_types RENAME COLUMN is_placeholder     TO artefacts_types_is_placeholder;
ALTER TABLE artefacts_types RENAME COLUMN colour             TO artefacts_types_colour;

-- ---- Index renames ----

ALTER INDEX artefact_types_pkey                                  RENAME TO artefacts_types_pkey;
ALTER INDEX artefact_types_lookup                                RENAME TO idx_artefacts_types_lookup;
ALTER INDEX artefact_types_one_placeholder_per_workspace         RENAME TO uq_artefacts_types_one_placeholder_per_workspace;
ALTER INDEX artefact_types_parent                                RENAME TO idx_artefacts_types_id_parent_type;
ALTER INDEX artefact_types_prefix_unique_live                    RENAME TO uq_artefacts_types_prefix_live;
ALTER INDEX idx_artefact_types_ws_scope_sort                     RENAME TO idx_artefacts_types_workspace_scope_sort;
ALTER INDEX uq_artefact_types_ws_scope_prefix                    RENAME TO uq_artefacts_types_workspace_scope_prefix;

-- ---- Check constraint renames ----

ALTER TABLE artefacts_types
    RENAME CONSTRAINT artefact_types_colour_check       TO artefacts_types_colour_check;
ALTER TABLE artefacts_types
    RENAME CONSTRAINT artefact_types_layer_depth_range  TO artefacts_types_layer_depth_range;
ALTER TABLE artefacts_types
    RENAME CONSTRAINT artefact_types_scope_check        TO artefacts_types_scope_check;
ALTER TABLE artefacts_types
    RENAME CONSTRAINT artefact_types_source_check       TO artefacts_types_source_check;
ALTER TABLE artefacts_types
    RENAME CONSTRAINT artefact_types_work_no_parent     TO artefacts_types_work_no_parent;

-- ---- FK constraint rename (self-FK on parent_type_id) ----

ALTER TABLE artefacts_types
    RENAME CONSTRAINT artefact_types_parent_type_id_fkey
                   TO artefacts_types_id_parent_type_fkey;

-- ---- Trigger rewrite ----
-- artefacts_types might use the generic set_updated_at trigger; install
-- a dedicated trigger function so NEW.updated_at → NEW.artefacts_types_updated_at.

DROP TRIGGER IF EXISTS artefact_types_set_updated_at ON artefacts_types;
DROP TRIGGER IF EXISTS artefacts_types_set_updated_at ON artefacts_types;
DROP TRIGGER IF EXISTS trg_artefact_types_updated_at ON artefacts_types;

CREATE OR REPLACE FUNCTION fn_artefacts_types_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.artefacts_types_updated_at := now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_artefacts_types_touch_updated_at
BEFORE UPDATE ON artefacts_types FOR EACH ROW
EXECUTE FUNCTION fn_artefacts_types_touch_updated_at();

COMMIT;
